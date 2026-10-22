# -*- coding: utf-8 -*-
"""Tests de la refonte de l'interface (19/10/2026).

Vitrine sur /, page de jeu sur /jouer, nouvel en-tête, redirections vers /jouer
et parties sans limite de temps (cadence 0+0).
"""

import json
import logging
import time
import unittest

from aiohttp.test_utils import AioHTTPTestCase
from mongomock_motor import AsyncMongoMockClient

import game
from clock import Clock
from const import ABORTED, FLAG, STARTED, reserved
from game import Game
from misc import time_control_str
from pychess_global_app_state_utils import get_app_state
from server import make_app
from user import User
from wsl import send_game_in_progress_if_any
from wsr import handle_abort_resign_abandon_flag

game.KEEP_TIME = 0

logging.basicConfig()
logging.getLogger().setLevel(level=logging.ERROR)


class FakeWs:
    """WebSocket factice : garde les messages envoyés."""

    def __init__(self):
        self.sent = []

    async def send_json(self, data):
        self.sent.append(data)

    async def send_str(self, data):
        self.sent.append(json.loads(data))


class PagesTestCase(AioHTTPTestCase):
    async def get_application(self):
        return make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True)

    async def tearDownAsync(self):
        app_state = get_app_state(self.app)
        for user in app_state.users.values():
            if user.anon and not reserved(user.username):
                user.remove_task.cancel()
        await self.client.close()

    async def test_vitrine(self):
        """/ est la vitrine : rapide (pas d'invité créé), crédits à jour, liens vers /jouer."""
        debut = time.monotonic()
        resp = await self.client.request("GET", "/")
        duree = time.monotonic() - debut
        self.assertEqual(resp.status, 200)
        text = await resp.text()
        self.assertLess(
            duree, 2, "la vitrine ne doit pas attendre 3 s comme les pages avec session"
        )
        self.assertIn("vitrine.css", text)
        self.assertIn('href="/jouer"', text)
        for nom, role in (
            ("Hugo Sabatier", "Auteur"),
            ("Samuel Boniface", "Illustrateur"),
            ("Olivier Jamet", "Illustrateur"),
        ):
            self.assertIn(nom, text)
        self.assertIn("Illustrateur", text)
        self.assertNotIn("[Prix", text)  # pas de texte de maquette entre crochets
        self.assertNotIn("[Date", text)
        self.assertNotIn('type="email"', text)  # pas de formulaire sans serveur derrière

    async def test_anciens_liens_du_salon(self):
        """Les anciens liens /?ai, /?auto_ai=… (tutoriel) partent vers /jouer avec leurs paramètres."""
        for query in ("ai", "friend", "any", "auto_ai=1&variant=matatakmini"):
            resp = await self.client.request("GET", "/?" + query, allow_redirects=False)
            self.assertEqual(resp.status, 302, query)
            self.assertEqual(resp.headers["Location"], "/jouer?" + query)

    async def test_page_jouer(self):
        resp = await self.client.request("GET", "/jouer")
        self.assertEqual(resp.status, 200)
        text = await resp.text()
        self.assertIn('data-view="jouer"', text)
        self.assertIn("jouer.css", text)
        self.assertIn("lobby.css", text)  # fenêtre « Plus d'options »
        self.assertIn("matatak-ui.css", text)
        self.assertIn('class="mt-haut"', text)
        self.assertIn('class="mt-tab"', text)  # barre d'onglets mobile

    async def test_salon_toujours_disponible(self):
        resp = await self.client.request("GET", "/lobby")
        self.assertEqual(resp.status, 200)
        self.assertIn('data-view="lobby"', await resp.text())

    async def test_barre_onglets_absente_des_ecrans_avec_plateau(self):
        resp = await self.client.request("GET", "/tutorial")
        self.assertEqual(resp.status, 200)
        text = await resp.text()
        self.assertIn('class="mt-haut"', text)
        self.assertNotIn('class="mt-tab"', text)

        resp = await self.client.request("GET", "/about")
        self.assertIn('class="mt-tab"', await resp.text())

    async def test_adresses_du_livret(self):
        """Les 3 QR codes du livret redirigent (302, la cible peut changer) ; l'adresse reste fixe."""
        attendu = {
            "regles": "/tutorial",
            "collection": "/collection",
            "extensions": "/collection#extensions",
            "inconnue": "/",
        }
        for cible, url in attendu.items():
            resp = await self.client.request("GET", "/livret/" + cible, allow_redirects=False)
            self.assertEqual(resp.status, 302, cible)
            self.assertEqual(resp.headers["Location"], url)

    async def test_tutoriel_etape_en_json(self):
        """Le tutoriel charge l'étape suivante sur place, sans recharger la page."""
        resp = await self.client.request("GET", "/api/tutorial/2")
        self.assertEqual(resp.status, 200)
        etape = json.loads(await resp.text())
        self.assertEqual(etape["_id"], "2")
        for champ in ("fen", "moves", "instruction", "success_msg", "title"):
            self.assertTrue(etape[champ], champ)
        resp = await self.client.request("GET", "/api/tutorial/99")
        self.assertEqual(resp.status, 404)

    async def test_tutoriel_coherent(self):
        """Chaque étape du tutoriel est jouable : coups légaux dans l'ordre, case entourée = arrivée
        du premier coup ; l'API renvoie le nombre total d'étapes."""
        import pyffish as sf
        from tutorial_data import TUTORIAL_STEPS

        for num, etape in TUTORIAL_STEPS.items():
            coups = etape["moves"].split(",")
            for i, coup in enumerate(coups):
                self.assertIn(coup, sf.legal_moves(etape["variant"], etape["fen"], coups[:i]), num)
            if etape.get("cible"):
                self.assertEqual(coups[0][2:], etape["cible"], num)
        etape = json.loads(await (await self.client.request("GET", "/api/tutorial/1")).text())
        self.assertEqual(etape["total"], len(TUTORIAL_STEPS))

    async def test_collection(self):
        """Page /collection et ses données : 42 Personnages, chacun avec ses déplacements."""
        text = await (await self.client.request("GET", "/collection")).text()
        self.assertIn('data-view="collection"', text)
        self.assertIn("collection.css", text)
        resp = await self.client.request("GET", "/static/data/collection.json")
        self.assertEqual(resp.status, 200)
        donnees = json.loads(await resp.text())
        persos = donnees["personnages"]
        self.assertEqual(len(persos), 42)
        self.assertEqual(sum(p["boite"] == "base" for p in persos), 24)
        self.assertEqual({p["saison"] for p in persos}, set(donnees["saisons"]))
        for p in persos:
            self.assertTrue(p["cases"], p["nom"])
            self.assertIn(p["rang"], ("roi", "champion", "pion"))

    async def test_feuilles_de_style_des_pages(self):
        """Chaque page refaite charge sa feuille de style, et celle-ci existe."""
        for chemin, css in (
            ("/tutorial", "tutoriel.css"),
            ("/jouer", "jouer.css"),
            ("/", "vitrine.css"),
            ("/puzzle/campaign/matatakmini", "puzzle.css"),
            ("/puzzle/matatakmini/level/1", "puzzle.css"),
            ("/apprendre", "apprendre.css"),
        ):
            text = await (await self.client.request("GET", chemin)).text()
            self.assertIn(css, text, chemin)
        for css in (
            "tutoriel.css",
            "jouer.css",
            "vitrine.css",
            "partie.css",
            "puzzle.css",
            "apprendre.css",
            "matatak-ui.css",
            "js/vitrine.js",
        ):
            resp = await self.client.request("GET", "/static/" + css)
            self.assertEqual(resp.status, 200, css)

    async def test_deconnexion_renvoie_vers_jouer(self):
        resp = await self.client.request("GET", "/logout", allow_redirects=False)
        self.assertEqual(resp.status, 302)
        self.assertEqual(resp.headers["Location"], "/jouer")

    async def test_manifest_ouvre_jouer(self):
        resp = await self.client.request("GET", "/manifest.json")
        manifest = json.loads(await resp.text())
        self.assertEqual(manifest["start_url"], "/jouer")
        self.assertEqual(
            manifest["id"], "/"
        )  # inchangé : les PWA déjà installées restent la même appli


class SansLimiteTestCase(AioHTTPTestCase):
    async def startup(self, app):
        app_state = get_app_state(self.app)
        self.wplayer = User(app_state, username="wplayer")
        self.bplayer = User(app_state, username="bplayer")

    async def get_application(self):
        app = make_app(db_client=AsyncMongoMockClient())
        app.on_startup.append(self.startup)
        return app

    async def tearDownAsync(self):
        await self.client.close()

    def nouvelle_partie(self, base, inc, corr=False):
        return Game(
            get_app_state(self.app),
            "12345678",
            "matatak",
            "",
            self.wplayer,
            self.bplayer,
            base=base,
            inc=inc,
            corr=corr,
        )

    async def jouer_coups(self, partie, n):
        for _ in range(n):
            await partie.play_move(partie.board.legal_moves()[0], clocks=[0, 0])

    async def test_unlimited(self):
        self.assertTrue(self.nouvelle_partie(0, 0).unlimited)
        self.assertFalse(self.nouvelle_partie(5, 3).unlimited)
        self.assertFalse(self.nouvelle_partie(0, 2).unlimited)
        self.assertFalse(self.nouvelle_partie(0, 0, corr=True).unlimited)

    async def test_pendule_arretee_apres_les_premiers_coups(self):
        """Avant la correction, la pendule du serveur partait de 0 et la partie était perdue au temps."""
        partie = self.nouvelle_partie(0, 0)
        await self.jouer_coups(partie, 4)
        self.assertEqual(partie.status, STARTED)
        self.assertIsInstance(partie.stopwatch, Clock)
        self.assertFalse(partie.stopwatch.running)

    async def test_pendule_normale_tourne(self):
        partie = self.nouvelle_partie(5, 3)
        await self.jouer_coups(partie, 3)
        self.assertTrue(partie.stopwatch.running)

    async def test_perte_au_temps_ignoree_sans_limite(self):
        """Le client (ou un tricheur) ne peut pas faire perdre une partie sans pendule au temps."""
        partie = self.nouvelle_partie(0, 0)
        await self.jouer_coups(partie, 2)
        ws = FakeWs()
        users = get_app_state(self.app).users
        await handle_abort_resign_abandon_flag(
            ws, users, self.wplayer, {"type": "flag", "gameId": partie.id}, partie
        )
        self.assertEqual(partie.status, STARTED)
        self.assertEqual(ws.sent, [])

    async def test_perte_au_temps_acceptee_avec_pendule(self):
        partie = self.nouvelle_partie(5, 3)
        await self.jouer_coups(partie, 2)
        await handle_abort_resign_abandon_flag(
            FakeWs(),
            get_app_state(self.app).users,
            self.wplayer,
            {"type": "flag", "gameId": partie.id},
            partie,
        )
        self.assertEqual(partie.status, FLAG)


class PartieNonCommenceeTestCase(AioHTTPTestCase):
    """Revenir sur /jouer après avoir lancé une partie par erreur ne doit pas bloquer le joueur."""

    async def startup(self, app):
        app_state = get_app_state(self.app)
        self.wplayer = User(app_state, username="wplayer")
        self.bplayer = User(app_state, username="bplayer")

    async def get_application(self):
        app = make_app(db_client=AsyncMongoMockClient())
        app.on_startup.append(self.startup)
        return app

    async def tearDownAsync(self):
        await self.client.close()

    def partie(self):
        app_state = get_app_state(self.app)
        g = Game(app_state, "12345678", "matatak", "", self.wplayer, self.bplayer, base=5, inc=3)
        app_state.games[g.id] = g
        return g

    async def test_ecran_de_partie_aussi_sur_invitation(self):
        """Une partie entre amis s'affiche à /invite/{id} : même écran de partie que /{id}.

        Avant la correction, la vue invite n'ajoutait pas partie.css : l'invité n'avait ni la mise
        en page mobile ni le cadre de fin de partie.
        """
        partie = self.partie()
        for chemin in ("/" + partie.id, "/invite/" + partie.id):
            text = await (await self.client.request("GET", chemin)).text()
            self.assertIn("partie.css", text, chemin)

    async def test_partie_pas_commencee_annulee(self):
        partie = self.partie()
        self.assertEqual(self.wplayer.game_in_progress, partie.id)
        ws = FakeWs()
        bloque = await send_game_in_progress_if_any(get_app_state(self.app), self.wplayer, ws)
        self.assertFalse(bloque)
        self.assertEqual(partie.status, ABORTED)
        self.assertIsNone(self.wplayer.game_in_progress)
        self.assertIsNone(self.bplayer.game_in_progress)
        self.assertFalse(any(m.get("type") == "game_in_progress" for m in ws.sent))

    async def test_partie_commencee_conservee(self):
        partie = self.partie()
        for _ in range(2):
            await partie.play_move(partie.board.legal_moves()[0], clocks=[300000, 300000])
        ws = FakeWs()
        bloque = await send_game_in_progress_if_any(get_app_state(self.app), self.wplayer, ws)
        self.assertTrue(bloque)
        self.assertEqual(partie.status, STARTED)
        self.assertEqual(ws.sent, [{"type": "game_in_progress", "gameId": partie.id}])


class CadenceTexteTestCase(unittest.TestCase):
    def test_time_control_str(self):
        self.assertEqual(time_control_str(0, 0, 0), "Sans limite")
        self.assertEqual(time_control_str(5, 3, 0), "5+3")
        self.assertEqual(time_control_str(0, 2, 0), "0+2")
        self.assertEqual(time_control_str(0, 0, 0, day=2), "2 days")


if __name__ == "__main__":
    unittest.main(verbosity=2)
