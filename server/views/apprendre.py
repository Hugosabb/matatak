from aiohttp import web


async def apprendre(request):
    """L'ancienne page Apprendre (tutoriel, puzzles, Collection, outils) : supprimée le 10/11/2026,
    toutes ces pages sont dans le menu « Plus » (Hugo). Les anciens liens mènent à /jouer."""
    raise web.HTTPFound("/jouer")


async def ancienne_page_variantes(request):
    """/variants était la page « Learn » de pychess (règles d'échecs, AUDIT P2-13) : les Personnages
    de Matatak sont dans la Collection."""
    raise web.HTTPFound("/collection")
