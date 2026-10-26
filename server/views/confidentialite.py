import aiohttp_jinja2

from views import get_user_context

# Boîte à créer chez IONOS avant le déploiement (sinon : synfaunia@gmail.com). Voir docs/RGPD.md.
CONTACT = "contact@matatak.org"


@aiohttp_jinja2.template("confidentialite.html")
async def confidentialite(request):
    """Confidentialité : ce que le site garde, pourquoi, combien de temps (docs/RGPD.md)."""
    user, context = await get_user_context(request)
    context["view"] = "confidentialite"
    context["view_css"] = "confidentialite.css"
    context["title"] = "Confidentialité · MATATAK!"
    context["contact"] = CONTACT
    return context
