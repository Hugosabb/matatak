# -*- coding: utf-8 -*-
"""Aventure gardée sur le compte (server/aventure_compte.py, bug d'Hugo du 03/11/2026 : l'appli
installée sur iPhone n'a pas le stockage de Safari et repartait du niveau 0)."""
import json
import time
from http.cookies import SimpleCookie

from aiohttp.test_utils import AioHTTPTestCase
from mongomock_motor import AsyncMongoMockClient

from pychess_global_app_state_utils import get_app_state
from server import make_app


def progression(etape, victoires=0, parties=0, roi="MOJO"):
    return {
        "version": 1,
        "roi": roi,
        "recrues": ["DYSKO", "TAMTAM", "SHASHA"],
        "equipe": {"champions": ["DYSKO"], "pions": ["TAMTAM", "SHASHA"]},
        "etape": etape,
        "victoires": victoires,
        "niveauOrdi": 3,
        "parties": parties,
        "flamme": {"jours": 0, "dernier": ""},
        "plateau": "matatakmini",
    }


class AventureCompteTestCase(AioHTTPTestCase):
    async def get_application(self):
        return make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True)

    async def connecter(self, nom="alice"):
        await get_app_state(self.app).db.user.insert_one({"_id": nom, "title": "", "enabled": True})
        cookie = SimpleCookie()
        cookie["AIOHTTP_SESSION"] = json.dumps(
            {"session": {"user_name": nom}, "created": int(time.time())}
        )
        self.client.session.cookie_jar.update_cookies(cookie)

    async def envoyer(self, corps):
        return await self.client.post("/api/aventure", json=corps)

    async def test_un_invite_n_a_pas_d_aventure_sur_le_serveur(self):
        self.assertEqual(await (await self.client.get("/api/aventure")).json(), {"connecte": False})
        self.assertEqual((await self.envoyer({"aventure": progression(3)})).status, 401)

    async def test_la_progression_la_plus_avancee_gagne(self):
        await self.connecter()
        reponse = await (await self.envoyer({"aventure": progression(14), "tutoriel": "fini"})).json()
        self.assertEqual(reponse["aventure"]["etape"], 14)
        # L'appli neuve (niveau 0) ne peut pas écraser le niveau 14 : on lui rend celui du compte
        reponse = await (await self.envoyer({"aventure": progression(0), "tutoriel": None})).json()
        self.assertEqual(reponse["aventure"]["etape"], 14)
        self.assertEqual(reponse["tutoriel"], "fini")  # le tutoriel ne se « désapprend » pas
        # Plus loin : enregistré ; même étape avec une victoire de plus : enregistré aussi
        await self.envoyer({"aventure": progression(15)})
        await self.envoyer({"aventure": progression(15, victoires=1)})
        lu = await (await self.client.get("/api/aventure")).json()
        self.assertEqual((lu["aventure"]["etape"], lu["aventure"]["victoires"]), (15, 1))
        doc = await get_app_state(self.app).db.user.find_one({"_id": "alice"})
        self.assertEqual(doc["aventure"]["p"]["etape"], 15)

    async def test_recommencer_efface_l_aventure_du_compte(self):
        await self.connecter()
        await self.envoyer({"aventure": progression(9), "tutoriel": "connu"})
        reponse = await (await self.envoyer({"reinitialiser": True})).json()
        self.assertIsNone(reponse["aventure"])
        self.assertEqual(reponse["tutoriel"], "connu")
        reponse = await (await self.envoyer({"aventure": progression(0)})).json()
        self.assertEqual(reponse["aventure"]["etape"], 0)

    async def test_envois_refuses(self):
        await self.connecter()
        self.assertEqual((await self.envoyer({"aventure": {"version": 2}})).status, 400)
        self.assertEqual((await self.envoyer({"aventure": progression(1, roi="BLUFF")})).status, 400)
        trop = {"aventure": dict(progression(1), recrues=["X" * 100] * 300)}
        self.assertEqual((await self.envoyer(trop)).status, 413)
        # Pas de JSON (formulaire d'un autre site)
        resp = await self.client.post("/api/aventure", data={"aventure": "x"})
        self.assertEqual(resp.status, 415)
        self.assertIsNone((await (await self.client.get("/api/aventure")).json())["aventure"])
