# -*- coding: utf-8 -*-
"""Référencement (10/11/2026) : robots.txt, sitemap.xml, une description par page, canonique ou noindex."""

import json
import re

from aiohttp.test_utils import AioHTTPTestCase
from mongomock_motor import AsyncMongoMockClient

from const import reserved
from pychess_global_app_state_utils import get_app_state
from server import make_app


class ReferencementTestCase(AioHTTPTestCase):
    async def get_application(self):
        return make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True)

    async def tearDownAsync(self):
        app_state = get_app_state(self.app)
        for user in app_state.users.values():
            if user.anon and not reserved(user.username) and getattr(user, "remove_task", None):
                user.remove_task.cancel()
        await self.client.close()

    async def page(self, adresse):
        resp = await self.client.get(adresse)
        self.assertEqual(resp.status, 200, adresse)
        return await resp.text()

    async def test_robots_et_plan_du_site(self):
        robots = await self.page("/robots.txt")
        self.assertIn("Sitemap: ", robots)
        self.assertIn("Disallow: /@/", robots)
        self.assertNotIn("/tournament/", robots)  # plus les règles de pychess
        resp = await self.client.get("/sitemap.xml")
        self.assertEqual(resp.headers["Content-Type"].split(";")[0], "application/xml")
        plan = await resp.text()
        for adresse in ("/jouer", "/collection", "/palmares"):
            self.assertIn("%s</loc>" % adresse, plan)
        self.assertNotIn("/apprendre</loc>", plan)  # page supprimée le 10/11/2026

    async def test_pages_publiques_indexees_avec_description(self):
        for adresse in ("/jouer", "/collection", "/palmares"):
            texte = await self.page(adresse)
            self.assertIn('rel="canonical"', texte, adresse)
            self.assertNotIn('name="robots" content="noindex"', texte, adresse)
            description = re.search(r'<meta name="description" content="([^"]+)"', texte).group(1)
            self.assertIn("MATATAK", description, adresse)
            self.assertNotIn("Chess Variants", texte, adresse)

    async def test_pages_privees_non_indexees(self):
        for adresse in ("/editor/matatakmini", "/connexion", "/analysis/matatakmini"):
            texte = await self.page(adresse)
            self.assertIn('name="robots" content="noindex"', texte, adresse)
            self.assertNotIn('rel="canonical"', texte, adresse)

    async def test_vitrine_donnees_structurees_et_nom_sans_point_d_exclamation(self):
        texte = await self.page("/")
        bloc = re.search(r'<script type="application/ld\+json">(.*?)</script>', texte, re.S).group(1)
        donnees = json.loads(bloc)
        self.assertEqual((donnees["@type"], donnees["name"]), ("Game", "MATATAK"))
        self.assertNotIn("price", bloc)  # rien de privé ni de prix sur le site
        titre = re.search(r"<title>([^<]+)</title>", texte).group(1)
        self.assertNotIn("MATATAK!", titre)
