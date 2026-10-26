import aiohttp_jinja2
from aiohttp import web

from oauth_config import fournisseurs_actifs
from views import get_user_context


@aiohttp_jinja2.template("connexion.html")
async def connexion(request):
    """Se connecter : Google (s'il est configuré) ou Lichess. Pages sans JavaScript."""
    user, context = await get_user_context(request)
    if not user.anon:
        raise web.HTTPFound("/@/%s" % user.username)
    context["view"] = "connexion"
    context["view_css"] = "connexion.css"
    context["title"] = "Se connecter · MATATAK!"
    context["fournisseurs"] = fournisseurs_actifs()
    return context
