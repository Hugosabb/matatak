# -*- coding: utf-8 -*-
"""Mise à jour de la PWA : versions des fichiers, service worker, en-têtes de cache."""

import logging
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase
from mongomock_motor import AsyncMongoMockClient

from const import reserved
from pychess_global_app_state_utils import get_app_state
from server import make_app
from settings import ASSET_VERSION, compute_asset_version, static_url

from test_matatak_regressions import session_cookie

logging.basicConfig()
logging.getLogger().setLevel(level=logging.ERROR)


class AssetVersionTestCase(unittest.TestCase):
    def test_static_url_versions_only_css_and_js(self):
        self.assertTrue(static_url("site.css").endswith("?v=" + ASSET_VERSION))
        self.assertTrue(static_url("./js/pwa-update.js").endswith("?v=" + ASSET_VERSION))
        self.assertEqual(static_url("images/pieces/x.png"), "/static/images/pieces/x.png")

    def test_version_follows_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "site.css").write_text("a{}")
            (root / "service-worker.js").write_text("// v1")
            first = compute_asset_version(root)
            self.assertEqual(first, compute_asset_version(root))  # stable

            (root / "service-worker.js").write_text("// v2")  # servi à part : sans effet
            self.assertEqual(first, compute_asset_version(root))

            (root / "site.css").write_text("a{color:red}")
            self.assertNotEqual(first, compute_asset_version(root))


class PwaAssetsTestCase(AioHTTPTestCase):
    async def get_application(self):
        return make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True)

    async def tearDownAsync(self):
        app_state = get_app_state(self.app)
        for user in app_state.users.values():
            if user.anon and not reserved(user.username):
                user.remove_task.cancel()
        await self.client.close()

    async def test_pages_reference_versioned_files(self):
        resp = await self.client.request(
            "GET", "/about", cookies=session_cookie("Fake-Tiger#123456")
        )
        self.assertEqual(resp.status, 200)
        html = await resp.text()
        for name in ("site.css", "style.css", "pychess-variants.js", "pwa-update.js"):
            self.assertIn("%s?v=%s" % (name, ASSET_VERSION), html, name)

    async def test_service_worker_has_version_and_is_never_cached(self):
        resp = await self.client.request("GET", "/service-worker.js")
        self.assertEqual(resp.status, 200)
        self.assertIn("javascript", resp.headers["Content-Type"])
        self.assertIn("no-store", resp.headers["Cache-Control"])
        source = await resp.text()
        self.assertIn("'%s'" % ASSET_VERSION, source)
        self.assertNotIn("__VERSION__", source)

    async def test_static_cache_headers(self):
        versioned = await self.client.request("GET", "/static/site.css?v=%s" % ASSET_VERSION)
        self.assertEqual(versioned.status, 200)
        self.assertEqual(versioned.headers["Cache-Control"], "public, max-age=31536000, immutable")

        unversioned = await self.client.request("GET", "/static/site.css")
        self.assertEqual(unversioned.headers["Cache-Control"], "no-cache")

        image = await self.client.request("GET", "/static/favicon/og-image.png")
        self.assertEqual(image.status, 200)
        self.assertEqual(image.headers["Cache-Control"], "public, max-age=86400")
