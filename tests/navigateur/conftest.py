"""Tests de navigateur de Matatak (Chromium, ordinateur et téléphone) : outils communs.

Lancer : `PYTHONPATH=server python -m pytest -q tests/navigateur` (après `node esbuild.mjs dev`).
Chaque test démarre son propre serveur, base MongoDB simulée en mémoire.
"""

import os

# Avant d'importer le serveur : avec l'adresse par défaut, il se croit en développement pychess
# et oublie les invités et l'ordinateur (Level N) au bout d'une seconde (user.py).
os.environ.setdefault("URI", "http://matatak.test")

import json  # noqa: E402

import pyffish as sf  # noqa: E402
import pytest_asyncio  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

from server import make_app  # noqa: E402

RACINE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(RACINE)  # le serveur lit static/ et templates/ depuis le dossier courant
sf.load_variant_config(open(os.path.join(RACINE, "variants.ini")).read())

TELEPHONE = "iPhone 13"


@pytest_asyncio.fixture
async def site(aiohttp_server):
    """Adresse d'un serveur Matatak tout neuf."""
    serveur = await aiohttp_server(make_app(db_client=AsyncMongoMockClient()))
    return f"http://{serveur.host}:{serveur.port}"


@pytest_asyncio.fixture
async def chromium():
    async with async_playwright() as p:
        navigateur = await p.chromium.launch(headless=True)
        navigateur.appareils = p.devices
        yield navigateur
        await navigateur.close()


async def ouvrir(chromium, site, telephone=False, premiere_page="/apprendre"):
    """Une page, comme un visiteur qui connaît déjà les règles. Les erreurs JavaScript sont
    gardées dans page.erreurs. La première visite attend 3 s côté serveur : on la fait ici, pour
    que la connexion du salon ne tombe pas plus tard au milieu d'un test."""
    options = dict(chromium.appareils[TELEPHONE]) if telephone else {"viewport": {"width": 1280, "height": 800}}
    page = await (await chromium.new_context(**options)).new_page()
    page.erreurs = []
    page.on("pageerror", lambda e: page.erreurs.append(str(e)))
    await page.goto(site + premiere_page)
    await page.evaluate(
        "localStorage.setItem('matatak_tutoriel', 'connu'); localStorage.setItem('matatak_conseils', 'vus')"
    )
    return page


async def ecouter_partie(page, game_id):
    """Ouvre une seconde WebSocket de la partie dans la page (même joueur) et garde les messages
    reçus dans window.__msgs. Sert à jouer des coups et à lire l'état sans viser des cases."""
    await page.evaluate(
        """gid => new Promise(ok => {
            window.__msgs = [];
            const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/wsr/' + gid);
            window.__ws = ws;
            ws.onmessage = e => { try { window.__msgs.push(JSON.parse(e.data)); } catch (err) {} };
            ws.onopen = () => { ws.send(JSON.stringify({type: 'board', gameId: gid})); setTimeout(ok, 300); };
        })""",
        game_id,
    )


async def dernier_plateau(page):
    return await page.evaluate("[...window.__msgs].reverse().find(m => m.type === 'board') || null")


async def envoyer(page, message):
    await page.evaluate("m => window.__ws.send(JSON.stringify(m))", message)


async def jouer_un_coup(page, game_id, variant="matatakmini"):
    """Joue le premier coup légal du joueur au trait (lu dans le dernier message board)."""
    plateau = await dernier_plateau(page)
    coups = sf.legal_moves(variant, plateau["fen"], [])
    await envoyer(page, {"type": "move", "gameId": game_id, "move": coups[0], "clocks": [0, 0], "ply": plateau["ply"] + 1})
    return plateau


async def attendre(page, condition_js, delai_ms=15000, argument=None):
    """Attend qu'une expression JavaScript soit vraie ; renvoie False si le délai passe."""
    try:
        await page.wait_for_function(condition_js, arg=argument, timeout=delai_ms)
        return True
    except Exception:
        return False


async def couleur_du_joueur(page):
    return "b" if await page.evaluate("[...document.querySelector('.cg-wrap').classList].includes('orientation-black')") else "w"


def id_partie(page):
    return page.url.rstrip("/").split("/")[-1].split("?")[0]


def debug(objet):
    return json.dumps(objet, ensure_ascii=False)[:400]
