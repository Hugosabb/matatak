import aiohttp_jinja2

from const import VARIANT_GROUPS
from views import get_user_context
from variants import VARIANTS, VARIANT_ICONS


@aiohttp_jinja2.template("games.html")
async def games(request):
    user, context = await get_user_context(request)

    variant = request.match_info.get("variant")

    matatak_variants = {
        "matatak": VARIANTS["matatak"]
    }
    context["variant"] = variant if variant is not None else ""
    context["variants"] = matatak_variants
    context["icons"] = {"matatak": VARIANT_ICONS["matatak"]}
    context["groups"] = [{"name": "Matatak Variants", "variants": ["matatak"]}]

    return context
