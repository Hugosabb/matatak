"""Adversaires d'entraînement des parties classées.

Quand personne de son niveau n'est en ligne, le joueur affronte l'un d'eux (règle écrite une fois
dans l'onglet « Classée » de /jouer). Ils ont un pseudo comme ceux des invités (« Silly-Goose ») et
jouent dans le navigateur de leur adversaire, comme le Solo : titre « LIA », niveau Fairy-Stockfish
fixe, déduit de leur classement d'ancrage.

Ce sont de vrais comptes en base (collection `user`, créés à leur première partie) : leurs parties
sont enregistrées et leur classement bouge un peu, comme celui d'un joueur. Pour éviter que
l'échelle ne dérive (inflation), il reste à DERIVE_MAX points au plus de leur ancrage, avec une
incertitude Glicko-2 basse (PHI_BOT) : ils servent de repères. Ils n'entrent pas au palmarès.

La réserve est tirée une fois pour toutes (graine fixe) : mêmes noms et mêmes ancrages à chaque
démarrage.
"""

from __future__ import annotations
from datetime import datetime, timezone
import random

from const import ADJECTIVES, ANIMALS
from glicko2.glicko2 import gl2
from user import User

# Classement d'ancrage des bots : de quoi couvrir les débutants comme les meilleurs
CLASSEMENT_MIN = 700
CLASSEMENT_MAX = 3000  # Hugo : « au moins 3000, on verra jusqu'où vont les joueurs »
# Échelle des niveaux : un niveau tous les 100 points jusqu'à PALIER (niveau 12), puis plus espacés
# jusqu'au niveau 20 à CLASSEMENT_MAX. Les joueurs, eux, n'ont pas de plafond.
PALIER = 1900
# Écart maximal entre le classement d'un bot et son ancrage
DERIVE_MAX = 150
# Incertitude Glicko-2 basse : classement « établi » (pas de « ? »), qui bouge peu à chaque partie
PHI_BOT = 60
VARIANTES = ("matatak", "matatakmini")

NOMBRE = 240
GRAINE = 20261023


def _reserve() -> dict[str, int]:
    r = random.Random(GRAINE)
    noms = r.sample(["%s-%s" % (adj, animal) for adj in ADJECTIVES for animal in ANIMALS], NOMBRE)
    pas = (CLASSEMENT_MAX - CLASSEMENT_MIN) / NOMBRE
    # Réparti régulièrement, avec un peu de bruit : des classements « précis » (1447)
    return {nom: int(CLASSEMENT_MIN + pas * i + r.uniform(0, pas)) for i, nom in enumerate(noms)}


# {pseudo: classement d'ancrage}
BOTS: dict[str, int] = _reserve()
_BOTS_MIN = {nom.lower() for nom in BOTS}


def est_bot_classe(username: str | None) -> bool:
    return (username or "").lower() in _BOTS_MIN


def niveau(classement: int) -> int:
    """Niveau Fairy-Stockfish (1 à 20) d'un classement : 800 → 1, 1500 → 8, 1900 → 12, 3000 → 20.
    Correspondance de départ, à recaler avec les résultats réels (le classement des bots bouge)."""
    if classement <= PALIER:
        n = 1 + (classement - 800) / 100
    else:
        n = 12 + (classement - PALIER) * 8 / (CLASSEMENT_MAX - PALIER)
    return min(20, max(1, round(n)))


def niveau_du_bot(username: str) -> int:
    """Fixe (celui de l'ancrage) : si le niveau suivait le classement, un bot qui perd deviendrait
    plus faible et perdrait encore plus."""
    return niveau(BOTS[username])


def borner(username: str, rating):
    """Nouveau classement d'un bot après une partie, ramené dans sa marge autour de l'ancrage."""
    ancrage = BOTS[username]
    mu = min(ancrage + DERIVE_MAX, max(ancrage - DERIVE_MAX, rating.mu))
    return gl2.create_rating(mu, PHI_BOT, rating.sigma, rating.ltime)


def _perfs_neuves(username: str) -> dict:
    perf = {
        "gl": {"r": BOTS[username], "d": PHI_BOT, "v": 0.06},
        "la": datetime.now(timezone.utc),
        "nb": 0,
    }
    return {variant: dict(perf) for variant in VARIANTES}


def utilisateur(app_state, doc: dict) -> User:
    """Le bot en mémoire à partir de son document en base."""
    user = User(app_state, username=doc["_id"], title="LIA", perfs=doc.get("perfs"))
    user.entrainement = True
    app_state.users[user.username] = user
    return user


async def creer_bot(app_state, username: str) -> User:
    """Le bot `username` (le même objet pour toutes ses parties), créé en base à sa 1re partie."""
    if username in app_state.users.data:
        return app_state.users.data[username]
    db = app_state.db
    doc = None if db is None else await db.user.find_one({"_id": username})
    if doc is None:
        doc = {"_id": username, "title": "LIA", "perfs": _perfs_neuves(username), "enabled": True}
        if db is not None:
            await db.user.insert_one(doc)
    return utilisateur(app_state, doc)


async def classements(app_state, variant: str) -> dict[str, int]:
    """Classement actuel de chaque bot sur ce plateau (lu en base une fois, puis en mémoire)."""
    cache = getattr(app_state, "classements_bots", None)
    if cache is None:
        cache = {}
        if app_state.db is not None:
            async for doc in app_state.db.user.find({"_id": {"$in": list(BOTS)}}):
                cache[doc["_id"]] = {
                    v: int(round(p["gl"]["r"])) for v, p in doc.get("perfs", {}).items()
                }
        app_state.classements_bots = cache
    actuels = {}
    for nom, ancrage in BOTS.items():
        if nom in app_state.users.data:
            actuels[nom] = app_state.users.data[nom].get_rating_value(variant, False)
        else:
            actuels[nom] = cache.get(nom, {}).get(variant, ancrage)
    return actuels


async def choisir_bot(app_state, variant: str, classement: int, eviter=frozenset()) -> str:
    """Un bot au hasard parmi ceux de classement proche (±100, puis plus large s'il le faut)."""
    actuels = await classements(app_state, variant)
    for ecart in (100, 200, 400, 10000):
        candidats = [
            n for n, c in actuels.items() if abs(c - classement) <= ecart and n not in eviter
        ]
        if candidats:
            return random.choice(candidats)
    return random.choice(list(BOTS))
