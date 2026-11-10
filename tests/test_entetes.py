# -*- coding: utf-8 -*-
"""En-têtes de sécurité HTTP (AUDIT P2-7, 10/11/2026)."""

from aiohttp.test_utils import AioHTTPTestCase
from mongomock_motor import AsyncMongoMockClient

from const import reserved
from pychess_global_app_state_utils import get_app_state
from server import make_app


class EntetesTestCase(AioHTTPTestCase):
    async def get_application(self):
        return make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True)

    async def tearDownAsync(self):
        app_state = get_app_state(self.app)
        for user in app_state.users.values():
            if user.anon and not reserved(user.username) and getattr(user, "remove_task", None):
                user.remove_task.cancel()
        await self.client.close()

    async def test_pages_et_fichiers(self):
        for adresse in ("/", "/jouer", "/robots.txt", "/static/matatak-ui.css"):
            resp = await self.client.get(adresse)
            self.assertEqual(resp.headers.get("X-Content-Type-Options"), "nosniff", adresse)
            self.assertEqual(resp.headers.get("X-Frame-Options"), "SAMEORIGIN", adresse)
            self.assertEqual(
                resp.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin", adresse
            )
