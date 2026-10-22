from aiohttp import web

# Adresses imprimées dans le livret de règles (QR codes) : elles ne doivent JAMAIS changer.
# Seule la cible change : modifier ce dictionnaire suffit. Redirection temporaire (302) exprès,
# pour que les navigateurs ne mémorisent pas la cible.
CIBLES = {
    "regles": "/tutorial",  # en attendant la vidéo des règles
    "collection": "/collection",
    "extensions": "/collection#extensions",
}


async def livret(request):
    cible = CIBLES.get(request.match_info.get("cible", ""), "/")
    raise web.HTTPFound(cible)
