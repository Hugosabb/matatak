import aiohttp_jinja2
from aiohttp import web

from views import get_user_context


@aiohttp_jinja2.template("index.html")
async def apprendre(request):
    """Apprendre : tutoriel, Personnages, campagne de puzzles, outils (client/apprendre.ts)."""
    user, context = await get_user_context(request)
    context["view"] = "apprendre"
    context["view_css"] = "apprendre.css"
    context["title"] = "Apprendre · MATATAK!"
    return context


async def ancienne_page_variantes(request):
    """/variants était la page « Learn » de pychess (règles d'échecs, AUDIT P2-13) : on apprend
    Matatak sur /apprendre."""
    raise web.HTTPFound("/apprendre")
