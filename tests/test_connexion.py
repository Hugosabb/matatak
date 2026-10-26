# -*- coding: utf-8 -*-
"""Connexion par Google ou Lichess (26/10/2026) : page /connexion, state OAuth aléatoire (avant : le
client_secret, visible dans l'adresse), compte Google sans nom ni e-mail."""

import json
import logging
import unittest
from unittest import mock
from urllib.parse import parse_qs, urlparse

from aiohttp.test_utils import AioHTTPTestCase
from mongomock_motor import AsyncMongoMockClient

import login
from const import reserved
from oauth_config import oauth_config
from pychess_global_app_state_utils import get_app_state
from server import make_app

logging.basicConfig()
logging.getLogger().setLevel(level=logging.ERROR)

GOOGLE_TEST = {"client_id": "id-de-test", "client_secret": "secret-de-test"}


class FausseReponse:
    def __init__(self, data):
        self.data = data

    async def json(self):
        return self.data

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


class FausseSessionHttp:
    """Remplace aiohttp.ClientSession dans login.py : Google rend un jeton d'accès."""

    demandes = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    def post(self, url, data=None, headers=None):
        FausseSessionHttp.demandes.append((url, data))
        return FausseReponse({"access_token": "jeton"})


class ConnexionTestCase(AioHTTPTestCase):
    async def get_application(self):
        return make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True)

    async def tearDownAsync(self):
        app_state = get_app_state(self.app)
        for user in app_state.users.values():
            if user.anon and not reserved(user.username):
                user.remove_task.cancel()
        await self.client.close()

    def session(self):
        for cookie in self.client.session.cookie_jar:
            if cookie.key == "AIOHTTP_SESSION":
                return json.loads(cookie.value)["session"]
        return {}

    async def test_page_sans_google(self):
        """Sans GOOGLE_CLIENT_ID : seul Lichess est proposé, /oauth/google renvoie vers /connexion."""
        resp = await self.client.get("/connexion")
        self.assertEqual(resp.status, 200)
        texte = await resp.text()
        self.assertIn('href="/login/lichess"', texte)
        self.assertNotIn("/login/google", texte)
        resp = await self.client.get("/oauth/google", allow_redirects=False)
        self.assertEqual(resp.headers["Location"], "/connexion")

    async def test_fournisseur_inconnu(self):
        resp = await self.client.get("/oauth/facebook", allow_redirects=False)
        self.assertEqual(resp.headers["Location"], "/connexion")
        resp = await self.client.get("/login/facebook", allow_redirects=False)
        self.assertEqual(resp.headers["Location"], "/connexion")

    async def test_state_aleatoire_lichess(self):
        """Le state n'est plus le client_secret, et un state faux est refusé."""
        resp = await self.client.get("/oauth/lichess", allow_redirects=False)
        params = parse_qs(urlparse(resp.headers["Location"]).query)
        state = params["state"][0]
        self.assertNotEqual(state, oauth_config["lichess"]["client_secret"])
        self.assertGreaterEqual(len(state), 24)
        self.assertEqual(self.session()["oauth_state"], state)

        FausseSessionHttp.demandes = []
        with mock.patch.object(login.aiohttp, "ClientSession", FausseSessionHttp):
            resp = await self.client.get(
                "/oauth/lichess?code=abc&state=mauvais", allow_redirects=False
            )
        self.assertEqual(resp.headers["Location"], "/jouer")
        self.assertEqual(FausseSessionHttp.demandes, [])

    @mock.patch.dict(oauth_config["google"], GOOGLE_TEST)
    async def test_google_de_bout_en_bout(self):
        resp = await self.client.get("/connexion")
        self.assertIn('href="/login/google"', await resp.text())

        # 1. Départ vers Google : openid seul, choix du compte, secret jamais dans l'adresse
        resp = await self.client.get("/oauth/google", allow_redirects=False)
        adresse = resp.headers["Location"]
        self.assertTrue(adresse.startswith("https://accounts.google.com/"))
        self.assertNotIn("secret-de-test", adresse)
        params = parse_qs(urlparse(adresse).query)
        self.assertEqual(params["scope"], ["openid"])
        self.assertEqual(params["prompt"], ["select_account"])
        self.assertEqual(params["redirect_uri"][0][-len("/oauth/google") :], "/oauth/google")
        state = params["state"][0]

        # 2. Retour de Google : jeton échangé avec le secret (côté serveur seulement)
        FausseSessionHttp.demandes = []
        with mock.patch.object(login.aiohttp, "ClientSession", FausseSessionHttp):
            resp = await self.client.get(
                "/oauth/google?code=abc&state=%s" % state, allow_redirects=False
            )
        self.assertEqual(resp.headers["Location"], "/login/google")
        url, data = FausseSessionHttp.demandes[0]
        self.assertEqual(url, "https://oauth2.googleapis.com/token")
        self.assertEqual(data["client_secret"], "secret-de-test")
        self.assertNotIn("oauth_state", self.session())

        # 3. Compte : identifiant « sub » seulement, pseudo à choisir (rien de pré-rempli)
        infos = mock.AsyncMock(return_value={"sub": "1234567890", "name": "Prénom Nom"})
        with mock.patch.object(login, "get_user_data", infos):
            resp = await self.client.get("/login/google", allow_redirects=False)
        self.assertEqual(resp.headers["Location"], "/select-username")
        session = self.session()
        self.assertEqual(session["oauth_provider"], "google")
        self.assertEqual(session["oauth_id"], "1234567890")
        self.assertEqual(session["oauth_username"], "")

        resp = await self.client.post("/api/confirm-username", json={"username": "Testeur"})
        self.assertEqual((await resp.json()).get("success"), True)
        doc = await get_app_state(self.app).db.user.find_one({"_id": "Testeur"})
        self.assertEqual((doc["oauth_provider"], doc["oauth_id"]), ("google", "1234567890"))
        self.assertNotIn("Prénom", json.dumps(doc, default=str))

        # 4. Connexion suivante : on retrouve le même compte
        self.client.session.cookie_jar.clear()
        await self.client.get("/oauth/google", allow_redirects=False)
        state = self.session()["oauth_state"]
        with mock.patch.object(login.aiohttp, "ClientSession", FausseSessionHttp):
            await self.client.get("/oauth/google?code=abc&state=%s" % state, allow_redirects=False)
        with mock.patch.object(login, "get_user_data", infos):
            resp = await self.client.get("/login/google", allow_redirects=False)
        self.assertEqual(resp.headers["Location"], "/jouer")
        self.assertEqual(self.session()["user_name"], "Testeur")

    async def test_pseudo_en_francais(self):
        resp = await self.client.post("/api/check-username", json={"username": "ab"})
        self.assertEqual((await resp.json())["error"], "Au moins 3 caractères")

    async def test_page_confidentialite(self):
        """Page exigée par Google pour passer en production ; liée depuis /connexion et la vitrine."""
        resp = await self.client.get("/confidentialite")
        self.assertEqual(resp.status, 200)
        texte = await resp.text()
        self.assertIn("Synfaunia", texte)
        self.assertIn("mailto:contact@matatak.org", texte)
        self.assertIn('href="/confidentialite"', await (await self.client.get("/connexion")).text())
        self.assertIn('href="/confidentialite"', await (await self.client.get("/")).text())

    async def test_rien_chez_google_fonts(self):
        """Polices hébergées sur le site : aucune page ne contacte Google Fonts."""
        for page in ("/", "/jouer", "/connexion", "/confidentialite"):
            texte = await (await self.client.get(page)).text()
            self.assertNotIn("fonts.googleapis.com", texte, page)
            self.assertNotIn("fonts.gstatic.com", texte, page)
        resp = await self.client.get("/static/fonts/polices.css")
        self.assertEqual(resp.status, 200)
        self.assertIn("nunito-normal-latin.woff2", await resp.text())
        resp = await self.client.get("/static/fonts/nunito-normal-latin.woff2")
        self.assertEqual(resp.status, 200)
        self.assertEqual(resp.headers["Content-Type"], "font/woff2")


if __name__ == "__main__":
    unittest.main(verbosity=2)
