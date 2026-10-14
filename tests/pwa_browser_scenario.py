"""Scénario navigateur de la mise à jour de la PWA (à lancer à la main, pas collecté par pytest).

Simule trois déploiements successifs et vérifie, dans un vrai Chromium :
  - page calme (À propos) : la mise à jour s'applique toute seule (rechargement) ;
  - page occupée (tutoriel) : bannière « Nouvelle version disponible », rechargement au clic seulement ;
  - première visite : le service worker prend la main sans recharger la page.

Prérequis : `playwright install chromium` dans l'environnement de test, puis, depuis la racine du dépôt :
    PYTHONPATH=server python tests/pwa_browser_scenario.py
"""

import os
import subprocess
import sys
import time
import urllib.request
from playwright.sync_api import sync_playwright

PY = sys.executable
SERVER_CODE = """
import sys, logging
sys.path.insert(0, 'server')
from aiohttp import web
from mongomock_motor import AsyncMongoMockClient
from server import make_app
logging.getLogger().setLevel(logging.ERROR)
web.run_app(make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True), host='127.0.0.1', port=8099, print=None)
"""

BASE = "http://127.0.0.1:8099"
procs = []


def start_server(version):
    for p in procs:
        p.kill()
        p.wait()
    procs.clear()
    env = dict(
        os.environ, SOURCE_VERSION=version, PYTHONPATH="server", MONGO_HOST="mongodb://127.0.0.1:1"
    )
    p = subprocess.Popen(
        [PY, "-c", SERVER_CODE], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    procs.append(p)
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/service-worker.js", timeout=1)
            return
        except Exception:
            time.sleep(0.25)
    raise RuntimeError("serveur non démarré")


def check(label, ok):
    print(("OK   " if ok else "ECHEC"), label)
    if not ok:
        check.failed += 1


check.failed = 0

try:
    start_server("v1")
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context()
        page = ctx.new_page()
        reloads = {"n": 0}
        page.on(
            "framenavigated",
            lambda f: reloads.__setitem__("n", reloads["n"] + 1) if f == page.main_frame else None,
        )

        # 1) première visite sur une page calme
        page.goto(BASE + "/about", wait_until="load")
        page.wait_for_function("navigator.serviceWorker.controller !== null", timeout=15000)
        check("1re visite : le service worker prend la main", True)
        page.evaluate("window.__marqueur = 1")
        time.sleep(1.5)
        check("1re visite : la page n'a PAS été rechargée", page.evaluate("window.__marqueur") == 1)
        html = page.content()
        check(
            "fichiers versionnés ?v=v1 dans la page",
            "site.css?v=v1" in html and "pwa-update.js?v=v1" in html,
        )
        check(
            "service worker v1 actif",
            "v1" in page.evaluate("fetch('/service-worker.js').then(r=>r.text())"),
        )

        # 2) nouveau déploiement (v2), page calme -> mise à jour automatique
        start_server("v2")
        page.evaluate("navigator.serviceWorker.getRegistration().then(r => r.update())")
        try:
            page.wait_for_function("window.__marqueur === undefined", timeout=15000)
            reloaded = True
        except Exception:
            reloaded = False
        check("page calme : rechargement automatique vers la v2", reloaded)
        page.wait_for_load_state("load")
        check("après rechargement : fichiers ?v=v2", "site.css?v=v2" in page.content())
        check("page calme : aucune bannière", page.query_selector("#update-banner") is None)

        # 3) nouveau déploiement (v3), page occupée (tutoriel) -> bannière, pas de rechargement
        page.goto(BASE + "/tutorial/1", wait_until="load")
        page.wait_for_function("navigator.serviceWorker.controller !== null", timeout=15000)
        page.evaluate("window.__marqueur = 1")
        start_server("v3")
        page.evaluate("navigator.serviceWorker.getRegistration().then(r => r.update())")
        try:
            page.wait_for_selector("#update-banner", timeout=15000)
            banner = True
        except Exception:
            banner = False
        check("page occupée : la bannière apparaît", banner)
        time.sleep(1.5)
        check(
            "page occupée : PAS de rechargement tant qu'on ne clique pas",
            page.evaluate("window.__marqueur") == 1,
        )
        if banner:
            text = page.inner_text("#update-banner")
            print("      texte de la bannière :", text.replace("\n", " | "))
            page.click("#update-banner button")
            try:
                page.wait_for_function("window.__marqueur === undefined", timeout=15000)
                reloaded = True
            except Exception:
                reloaded = False
            check("clic sur « Mettre à jour » : la page se recharge", reloaded)
            page.wait_for_load_state("load")
            check("après clic : fichiers ?v=v3", "site.css?v=v3" in page.content())
        browser.close()
finally:
    for p in procs:
        p.kill()
print("\nRÉSULTAT :", "tout est bon" if check.failed == 0 else "%d échec(s)" % check.failed)
