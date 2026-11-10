from __future__ import annotations

from aiohttp import web

from settings import URI

# Référencement (10/11/2026) : seules les pages publiques sont à explorer ; les parties, profils,
# invitations et l'éditeur ont en plus <meta name="robots" content="noindex"> (templates/base.html)
ROBOTS_TXT = """User-agent: PetalBot
Disallow: /
User-agent: *
Disallow: /@/
Disallow: /api/
Disallow: /editor/
Disallow: /invite/
Disallow: /analysis/
Disallow: /login/
Disallow: /logout/
Disallow: /oauth/
Disallow: /connexion
Disallow: /tv/
Crawl-delay: 10
Sitemap: %s/sitemap.xml
"""

# Pages publiques, de la plus importante à la moins importante
PAGES = [
    "/",
    "/jouer",
    "/collection",
    "/tutorial",
    "/puzzle/campaign/matatakmini",
    "/palmares",
    "/confidentialite",
]


async def robots(request):
    return web.Response(text=ROBOTS_TXT % URI, content_type="text/plain")


async def sitemap(request):
    urls = "".join("<url><loc>%s%s</loc></url>" % (URI, page) for page in PAGES)
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">%s</urlset>' % urls
    )
    return web.Response(text=xml, content_type="application/xml")
