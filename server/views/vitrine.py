import aiohttp_jinja2
from aiohttp import web

from lang import LOCALE


@aiohttp_jinja2.template("vitrine.html")
async def vitrine(request):
    """Page d'accueil publique (le jeu de société).

    Page statique : pas de session ni d'utilisateur invité, donc pas d'attente à la première visite.
    Les anciens liens du salon (/?ai, /?auto_ai=…, /?fen=…) sont renvoyés vers /jouer.
    """
    if request.query_string:
        raise web.HTTPFound("/jouer?" + request.query_string)
    return {"lang": LOCALE.get(), "title": "MATATAK! · Le jeu de société"}
