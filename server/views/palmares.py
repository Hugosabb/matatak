import aiohttp_jinja2

from views import get_user_context


@aiohttp_jinja2.template("index.html")
async def palmares(request):
    """Palmarès : la semaine et les classements de tous les temps (client/palmares.ts)."""
    user, context = await get_user_context(request)
    context["view"] = "palmares"
    context["view_css"] = "palmares.css"
    context["title"] = "Palmarès · MATATAK!"
    return context
