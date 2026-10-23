"""Parcours de l'onglet « Classée » de /jouer (server/classee.py, server/bots_classes.py)."""

from http.cookies import SimpleCookie
import json
import time

import pytest
import pytest_asyncio
from mongomock_motor import AsyncMongoMockClient

from conftest import (
    attendre,
    couleur_du_joueur,
    dernier_plateau,
    ecouter_partie,
    id_partie,
    jouer_un_coup,
    ouvrir,
)
from pychess_global_app_state_utils import get_app_state
from server import make_app
from test_parcours import en_draft, une_etape_de_draft

pytestmark = pytest.mark.asyncio

JOUEUR = "alice_test"
AUTRE = "bruno_test"


@pytest_asyncio.fixture
async def site_connecte(aiohttp_server, monkeypatch):
    """Un serveur neuf où le compte JOUEUR existe (comme après une connexion Lichess), et un
    adversaire d'entraînement donné au bout d'une seconde au lieu de 15."""
    import classee

    monkeypatch.setattr(classee, "DELAI_BOT", 1)
    app = make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True)
    serveur = await aiohttp_server(app)
    for nom in (JOUEUR, AUTRE):
        await get_app_state(app).db.user.insert_one({"_id": nom, "title": "", "enabled": True})
    return f"http://{serveur.host}:{serveur.port}"


async def connecter(page, site, nom=JOUEUR):
    # Valeur encodée comme la pose aiohttp (guillemets échappés), sinon le serveur l'ignore
    cookie = SimpleCookie()
    cookie["s"] = json.dumps({"session": {"user_name": nom}, "created": int(time.time())})
    await page.context.add_cookies(
        [{"name": "AIOHTTP_SESSION", "value": cookie["s"].coded_value, "url": site}]
    )


@pytest.mark.parametrize("telephone", [False, True], ids=["ordinateur", "telephone"])
async def test_un_invite_doit_se_connecter(site, chromium, telephone):
    page = await ouvrir(chromium, site, telephone)
    await page.evaluate("localStorage.setItem('jouer_choix', JSON.stringify({adv: 'classee'}))")
    await page.goto(site + "/jouer")
    await page.wait_for_selector(".classee-accueil")
    assert await page.locator(".choix-adv button").count() == 3
    lien = page.locator("a.lancer")
    assert await lien.inner_text() == "Se connecter avec Lichess"
    assert await lien.get_attribute("href") == "/login/lichess"
    assert await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    assert not page.erreurs, page.erreurs


async def test_partie_classee_contre_un_adversaire_d_entrainement(site_connecte, chromium):
    site = site_connecte
    page = await ouvrir(chromium, site, telephone=True)
    page.on("dialog", lambda d: d.accept())
    await connecter(page, site)
    await page.evaluate(
        "localStorage.setItem('jouer_choix', JSON.stringify({adv: 'classee', variant: 'matatakmini'}))"
    )
    await page.goto(site + "/jouer")
    await page.wait_for_selector(".classee-regles")
    await page.wait_for_selector('.plat.on:has-text("Classement 1500 ?")')
    await page.locator("button.lancer").click()
    bouton = page.locator("button.lancer")
    assert "Recherche" in await bouton.inner_text()
    # Le texte tient dans le bouton (il débordait avec « Recherche d'un adversaire… 0:07 »)
    assert await bouton.evaluate("b => b.scrollWidth <= b.clientWidth")
    await page.wait_for_selector("#draft-ecran .draft", timeout=15000)

    # Toujours en Draft ; l'adversaire joue ses étapes tout seul
    for _ in range(40):
        if not await en_draft(page):
            break
        await une_etape_de_draft(page)
        await page.wait_for_timeout(500)
    assert not await en_draft(page)

    # L'adversaire s'affiche comme un joueur : pseudo et classement, ni Roi ni niveau
    noms = await page.locator("round-player0, round-player1").all_inner_texts()
    assert JOUEUR in " ".join(noms), noms
    assert not any("Niv." in n for n in noms), noms

    # Quatre demi-coups (une partie plus courte n'est pas comptée), puis abandon : des points en
    # moins, et pas de revanche
    game_id = id_partie(page)
    await ecouter_partie(page, game_id)
    moi = await couleur_du_joueur(page)
    for ply in range(1, 5):
        if (await dernier_plateau(page))["fen"].split(" ")[1] == moi:
            await jouer_un_coup(page, game_id, pendule=170000)
        await attendre(
            page, "p => window.__msgs.some(m => m.type === 'board' && m.ply >= p)", 15000, ply
        )
    await page.locator("#barre-partie .barre-btn").first.click()
    await page.locator(".barre-action", has_text="Abandonner").click()
    # Confirmation dans le menu (ou, avant elle, une fenêtre du navigateur)
    oui = page.locator(".barre-action", has_text="Oui, abandonner")
    if await oui.count():
        await oui.click()
    await page.wait_for_selector(".fin-points", timeout=10000)
    points = await page.locator(".fin-points").inner_text()
    assert "−" in points and "Classement" in points, points
    fin = await page.locator(".fin-partie").inner_text()
    assert "Nouvelle partie" in fin and "Revanche" not in fin and "Rejouer" not in fin, fin
    assert not page.erreurs, page.erreurs


async def test_defier_un_joueur_en_ligne(site_connecte, chromium):
    """Alice (ordinateur) voit Bruno (téléphone) dans « Joueurs en ligne », le défie ; Bruno
    accepte depuis le bandeau : les deux arrivent sur la même partie classée, en Draft."""
    site = site_connecte
    pages = {}
    for nom, telephone in ((JOUEUR, False), (AUTRE, True)):
        page = await ouvrir(chromium, site, telephone)
        await connecter(page, site, nom)
        await page.evaluate(
            "localStorage.setItem('jouer_choix', JSON.stringify({adv: 'classee', variant: 'matatakmini'}))"
        )
        await page.goto(site + "/jouer")
        await page.wait_for_selector(".classee-regles")
        pages[nom] = page
    alice, bruno = pages[JOUEUR], pages[AUTRE]
    # La liste se rafraîchit toutes les 10 s : Bruno est arrivé après Alice
    await alice.wait_for_selector(".en-ligne li:has-text('bruno_test')", timeout=15000)
    await alice.locator(".en-ligne li", has_text=AUTRE).locator("button.defi").click()
    await alice.wait_for_selector("button.defi.envoye")
    await bruno.wait_for_selector(".defi-recu", timeout=5000)
    assert "alice_test vous défie" in await bruno.locator(".defi-recu").inner_text()
    await alice.screenshot(
        path="/tmp/claude-1000/-home-hugo-github-matatak/be2d8a16-9cef-4745-8473-a0ce071d48fb/scratchpad/en-ligne.png"
    )
    await bruno.screenshot(
        path="/tmp/claude-1000/-home-hugo-github-matatak/be2d8a16-9cef-4745-8473-a0ce071d48fb/scratchpad/defi-recu.png"
    )
    await bruno.locator(".defi-recu button", has_text="Accepter").click()
    for page in (alice, bruno):
        await page.wait_for_selector("#draft-ecran .draft", timeout=15000)
    assert alice.url == bruno.url
    for page in (alice, bruno):
        assert not page.erreurs, page.erreurs
