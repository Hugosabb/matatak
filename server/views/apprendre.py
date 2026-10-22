import aiohttp_jinja2

from views import get_user_context


@aiohttp_jinja2.template("index.html")
async def apprendre(request):
    """Apprendre : tutoriel, Personnages, campagne de puzzles, outils (client/apprendre.ts)."""
    user, context = await get_user_context(request)
    context["view"] = "apprendre"
    context["view_css"] = "apprendre.css"
    context["title"] = "Apprendre · MATATAK!"
    return context
