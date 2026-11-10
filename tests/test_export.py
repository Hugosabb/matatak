# -*- coding: utf-8 -*-
"""Export PGN public : jamais une partie en cours (AUDIT P2-5, 10/11/2026)."""

from unittest.mock import patch

from aiohttp.test_utils import AioHTTPTestCase
from mongomock_motor import AsyncMongoMockClient

from const import STARTED, reserved
from pychess_global_app_state_utils import get_app_state
from server import make_app
from user import User


class ExportTestCase(AioHTTPTestCase):
    async def get_application(self):
        return make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True)

    async def tearDownAsync(self):
        app_state = get_app_state(self.app)
        for user in app_state.users.values():
            if user.anon and not reserved(user.username) and getattr(user, "remove_task", None):
                user.remove_task.cancel()
        await self.client.close()

    async def test_export_sans_les_parties_en_cours(self):
        app_state = get_app_state(self.app)
        app_state.users["alice"] = User(app_state, username="alice")
        await app_state.db.game.insert_many(
            [
                {"_id": "enCours1", "us": ["alice", "bruno"], "s": STARTED},
                {"_id": "finie001", "us": ["alice", "bruno"], "s": STARTED + 1},
            ]
        )
        with patch("game_api.pgn", side_effect=lambda doc: "[Game %s]\n" % doc["_id"]):
            texte = await (await self.client.get("/games/export/alice")).text()
        self.assertIn("finie001", texte)
        self.assertNotIn("enCours1", texte)
