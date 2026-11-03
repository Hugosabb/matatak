"""Aventure retrouvée sur un autre appareil connecté au même compte (bug d'Hugo du 03/11/2026 :
l'appli installée sur iPhone n'a pas le stockage de Safari et repartait du niveau 0)."""

import pytest
import pytest_asyncio
from mongomock_motor import AsyncMongoMockClient

from conftest import attendre, ouvrir
from pychess_global_app_state_utils import get_app_state
from server import make_app
from test_aventure import PHASE_2
from test_classee import connecter

JOUEUR = "Hugosabb"
pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def site_compte(aiohttp_server):
    app = make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True)
    serveur = await aiohttp_server(app)
    await get_app_state(app).db.user.insert_one({"_id": JOUEUR, "title": "", "enabled": True})
    return f"http://{serveur.host}:{serveur.port}"


async def test_l_aventure_suit_le_compte_d_un_appareil_a_l_autre(site_compte, chromium):
    site = site_compte
    # Safari : l'Aventure jouée jusqu'à l'étape 6, puis le joueur se connecte et ouvre /jouer
    safari = await ouvrir(chromium, site, telephone=True)
    await connecter(safari, site, JOUEUR)
    await safari.evaluate(PHASE_2)
    async with safari.expect_response(lambda r: r.url.endswith("/api/aventure") and r.request.method == "POST"):
        await safari.goto(site + "/jouer")
    niveau = await safari.locator("button.lancer").inner_text()

    # L'appli installée : stockage vide (ni Aventure, ni tutoriel), même compte
    appli = await ouvrir(chromium, site, telephone=True)
    await connecter(appli, site, JOUEUR)
    await appli.evaluate("localStorage.clear(); localStorage.setItem('matatak_intro_vue', '1')")
    await appli.goto(site + "/jouer")
    assert await attendre(appli, "JSON.parse(localStorage.getItem('matatak_aventure') || 'null')?.etape === 6")
    assert await appli.evaluate("localStorage.getItem('matatak_tutoriel')") == "connu"
    await appli.wait_for_function("t => document.querySelector('button.lancer')?.innerText === t", arg=niveau)

    assert not safari.erreurs and not appli.erreurs, (safari.erreurs, appli.erreurs)


async def test_un_invite_voit_comment_retrouver_son_aventure(site_compte, chromium):
    page = await ouvrir(chromium, site_compte, telephone=True)
    await page.evaluate(
        "localStorage.setItem('matatak_intro_vue', '1');"
        " localStorage.setItem('jouer_choix', JSON.stringify({adv: 'ia'}))"
    )
    await page.goto(site_compte + "/jouer")
    lien = page.locator("a.av-retrouver")
    await lien.wait_for()
    assert await lien.get_attribute("href") == "/connexion"
    assert not page.erreurs, page.erreurs
