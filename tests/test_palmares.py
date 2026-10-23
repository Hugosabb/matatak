# -*- coding: utf-8 -*-
"""Palmarès de la semaine (server/palmares.py) : barème, parties comptées, couronne, API."""

import asyncio
from datetime import datetime, timezone
import unittest
from unittest.mock import AsyncMock, patch

from palmares import fin_de_semaine, points, semaine, semaine_precedente
from test_classee import BaseClassee
from pychess_global_app_state_utils import get_app_state


class BaremeTestCase(unittest.TestCase):
    def test_exemples_du_bareme(self):
        """Exemples de docs/AVENTURE.md (Hugo, 23/10/2026)."""
        self.assertEqual(points("victoire", 1500, 1700), 75)
        self.assertEqual(points("victoire", 2500, 2700), 112)
        self.assertEqual(points("defaite", 2000, 1500), 12)
        self.assertEqual(points("victoire", 3000, 5000), 184)  # maximum
        self.assertEqual(points("nulle", 1500, 2500), 25)  # l'écart ne compte qu'en victoire
        # Une victoire contre bien plus faible rapporte encore plus qu'une nulle
        self.assertGreater(points("victoire", 1500, 500), points("nulle", 1500, 500))

    def test_semaine_du_lundi(self):
        jeudi = datetime(2026, 10, 22, 15, tzinfo=timezone.utc)
        self.assertEqual(semaine(jeudi), "2026-10-19")
        self.assertEqual(semaine_precedente(jeudi), "2026-10-12")
        self.assertEqual(fin_de_semaine(jeudi), datetime(2026, 10, 26, tzinfo=timezone.utc))


class PalmaresTestCase(BaseClassee):
    async def partie_contre_bot(self, nom, demi_coups):
        import classee

        app_state = get_app_state(self.app)
        a = self.joueur(nom, 1500)
        with patch("classee.DELAI_BOT", 0), patch("classee.ws_send_json", new=AsyncMock()) as envoi:
            await classee.chercher(app_state, a, {"variant": "matatakmini"})
            await asyncio.sleep(1.2)
        game = app_state.games[envoi.await_args.args[1]["gameId"]]
        game.draft = None
        for _ in range(demi_coups):
            game.board.push(game.board.legal_moves()[0])
        await game.game_ended(a, "resign")
        return a, game

    async def test_defaite_contre_un_bot_rapporte_des_points_au_joueur_seulement(self):
        app_state = get_app_state(self.app)
        a, game = await self.partie_contre_bot("alice", 12)
        moi = "w" if game.wplayer is a else "b"
        self.assertEqual(game.semaine_pts[moi], 10)  # défaite à 1500
        self.assertIsNone(game.semaine_pts["b" if moi == "w" else "w"])  # le bot : rien
        self.assertEqual(game.get_board(full=True)["semaine"][moi], 10)
        doc = await app_state.db.palmares.find_one({"_id": "%s|alice" % semaine()})
        self.assertEqual((doc["p"], doc["n"], doc["v"]), (10, 1, 0))

    async def test_partie_trop_courte_ne_rapporte_rien(self):
        app_state = get_app_state(self.app)
        a, game = await self.partie_contre_bot("alice", 4)
        self.assertEqual(game.semaine_pts, {"w": None, "b": None})
        self.assertIsNone(await app_state.db.palmares.find_one({"u": "alice"}))
        self.assertLess(a.get_rating_value("matatakmini", False), 1500)  # le classement, si

    async def test_api_semaine_couronne_et_classement_general(self):
        app_state = get_app_state(self.app)
        db = app_state.db
        s, avant = semaine(), semaine_precedente()
        await db.palmares.insert_many(
            [
                {"_id": s + "|alice", "s": s, "u": "alice", "p": 120, "n": 3, "v": 2},
                {"_id": s + "|bruno", "s": s, "u": "bruno", "p": 300, "n": 9, "v": 4},
                {"_id": avant + "|carla", "s": avant, "u": "carla", "p": 500, "n": 9, "v": 9},
            ]
        )
        perf = lambda r, nb: {"gl": {"r": r, "d": 60, "v": 0.06}, "nb": nb}  # noqa: E731
        await db.user.insert_many(
            [
                {"_id": "alice", "perfs": {"matatakmini": perf(1620, 3)}},
                {"_id": "bruno", "perfs": {"matatakmini": perf(1810, 9)}},
                {"_id": "Tall-Pig", "title": "LIA", "perfs": {"matatakmini": perf(2900, 50)}},
            ]
        )
        reponse = await (await self.client.get("/api/palmares")).json()
        self.assertEqual(
            [(t["u"], t["p"]) for t in reponse["top"]], [("bruno", 300), ("alice", 120)]
        )
        self.assertEqual(reponse["couronne"], "carla")
        self.assertEqual([g["u"] for g in reponse["general"]["matatakmini"]], ["bruno", "alice"])
        self.assertEqual(reponse["general"]["matatak"], [])
        page = await self.client.get("/palmares")
        self.assertEqual(page.status, 200)
        # La couronne sur le profil du premier de la semaine passée, pas sur les autres
        await db.user.insert_one({"_id": "carla", "perfs": {"matatakmini": perf(1700, 9)}})
        self.assertIn('class="couronne"', await (await self.client.get("/@/carla")).text())
        self.assertNotIn('class="couronne"', await (await self.client.get("/@/bruno")).text())
