import aiohttp_jinja2

from views import get_user_context


@aiohttp_jinja2.template("index.html")
async def collection(request):
    """Collection : tous les Personnages, leur carte et leurs déplacements (client/collection.ts)."""
    user, context = await get_user_context(request)
    context["view"] = "collection"
    context["view_css"] = "collection.css"
    context["title"] = "Collection · MATATAK!"
    return context
