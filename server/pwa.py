import os

from aiohttp import web

from settings import ASSET_VERSION


async def service_worker(request):
    """Sert le service worker avec la version du déploiement injectée.

    Le contenu du fichier change à chaque déploiement : c'est ce qui permet au navigateur de détecter
    une nouvelle version et de mettre à jour la PWA sans intervention manuelle.
    """
    with open(os.path.join("static", "service-worker.js"), encoding="utf-8") as f:
        source = f.read().replace("__VERSION__", ASSET_VERSION)
    response = web.Response(text=source, content_type="application/javascript", charset="utf-8")
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response


async def manifest(request):
    return web.FileResponse(os.path.join("static", "manifest.json"))
