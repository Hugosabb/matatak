"""Pages légales : conditions générales de vente (/cgv) et mentions légales (/mentions-legales).

Leur texte vient du dépôt privé (static/data/{cgv,mentions-legales}.html, écrits par site-prive/outils/cgv_html.py
et copiés par outils/assets-depuis-jeu.sh). Tant qu'il reste des passages « à compléter », un avertissement le dit
en haut de la page.
"""

from pathlib import Path

import aiohttp_jinja2
from aiohttp import web

from views import get_user_context

DONNEES = Path(__file__).resolve().parents[2] / "static" / "data"
TITRES = {"cgv": "Conditions générales de vente", "mentions-legales": "Mentions légales"}


async def _page(request, nom):
    try:
        texte = (DONNEES / ("%s.html" % nom)).read_text(encoding="utf-8")
    except OSError:
        raise web.HTTPNotFound()
    user, context = await get_user_context(request)
    context["view"] = nom
    context["view_css"] = "confidentialite.css"
    context["title"] = "%s · MATATAK" % TITRES[nom]
    context["texte"] = texte
    context["brouillon"] = "a-completer" in texte
    return context


@aiohttp_jinja2.template("page_legale.html")
async def cgv(request):
    return await _page(request, "cgv")


@aiohttp_jinja2.template("page_legale.html")
async def mentions(request):
    return await _page(request, "mentions-legales")
