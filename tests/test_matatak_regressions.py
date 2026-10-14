# -*- coding: utf-8 -*-
"""Tests de non-régression des bugs propres à Matatak (voir issues corrigées dans l'historique git)."""

import json
import logging
import time
from unittest.mock import AsyncMock, patch

from aiohttp.test_utils import AioHTTPTestCase
from mongomock_motor import AsyncMongoMockClient

from const import reserved
from pychess_global_app_state_utils import get_app_state
from puzzle import empty_puzzle
from server import make_app

logging.basicConfig()
logging.getLogger().setLevel(level=logging.ERROR)


def session_cookie(username):
    """Cookie de session au format de SimpleCookieStorage (make_app(simple_cookie_storage=True))."""
    return {"AIOHTTP_SESSION": json.dumps({"session": {"user_name": username}, "created": int(time.time())})}


class MatatakViewsTestCase(AioHTTPTestCase):
    async def get_application(self):
        return make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True)

    async def tearDownAsync(self):
        app_state = get_app_state(self.app)
        for user in app_state.users.values():
            if user.anon and not reserved(user.username):
                user.remove_task.cancel()
        await self.client.close()

    async def test_registered_user_not_in_memory(self):
        """Un joueur enregistré dont la session survit à un redémarrage du serveur ne doit pas avoir de 500.

        Avant la correction, `from const import NONE_USER` placé dans le corps du `if` rendait
        `NONE_USER` local à la fonction : UnboundLocalError (HTTP 500) à la première page.
        """
        app_state = get_app_state(self.app)
        await app_state.db.user.insert_one({"_id": "ChipsouChess", "title": ""})
        self.assertNotIn("ChipsouChess", app_state.users)  # comme après un redémarrage

        resp = await self.client.request("GET", "/about", cookies=session_cookie("ChipsouChess"))
        self.assertEqual(resp.status, 200)
        self.assertIn("ChipsouChess", await resp.text())  # reconnu, pas remplacé par un invité

    async def test_unknown_session_user_becomes_guest(self):
        """Un pseudo absent de la base (invité d'avant le redémarrage) reçoit un nouvel invité, sans 500."""
        resp = await self.client.request("GET", "/about", cookies=session_cookie("Fake-Tiger#123456"))
        self.assertEqual(resp.status, 200)

    async def test_puzzle_pages_do_not_crash(self):
        """/puzzle, /puzzle/{variante} et /puzzle/{id} utilisaient VARIANTS sans l'importer (NameError).

        L'accès à la base est remplacé : la prod utilise pymongo (`await collection.aggregate()`),
        alors que mongomock_motor imite l'ancien pilote motor et ne le supporte pas.
        """
        fake = empty_puzzle("matatak")
        with patch("views.puzzle.next_puzzle", AsyncMock(return_value=fake)), patch(
            "views.puzzle.get_puzzle", AsyncMock(return_value=fake)
        ):
            for path in ("/puzzle", "/puzzle/matatak", "/puzzle/matatakmini", "/puzzle/abcde"):
                resp = await self.client.request("GET", path)
                self.assertEqual(resp.status, 200, path)
