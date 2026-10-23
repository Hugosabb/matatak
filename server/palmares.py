"""Palmarès de la semaine (décisions d'Hugo du 23/10/2026, docs/AVENTURE.md, « Classé »).

Récompense ceux qui jouent, pas seulement les plus forts : chaque partie classée rapporte des
points, même perdue, avec un bonus pour une victoire contre plus fort. Un seul palmarès pour les
deux plateaux, remis à zéro chaque lundi (0 h UTC) ; le premier de la semaine passée porte une
couronne. Les adversaires d'entraînement (bots) n'y entrent pas, mais une partie contre eux
rapporte des points au joueur.

Collection `palmares` : un document par joueur et par semaine
{_id: "2026-10-19|alice", s: "2026-10-19", u: "alice", p: points, n: parties, v: victoires}.
"""

from __future__ import annotations
from datetime import datetime, timedelta, timezone

from logger import log

BASE = {"defaite": 10, "nulle": 25, "victoire": 50}
# Une partie plus courte ne rapporte rien : sinon on enchaînerait les abandons pour les points de
# défaite. Elle compte quand même au classement.
DEMI_COUPS_MIN = 10
VARIANTES_CLASSEES = ("matatak", "matatakmini")


def points(resultat: str, classement: float, classement_adverse: float) -> int:
    """Points de la semaine pour une partie : base × niveau × écart, arrondi.

    Niveau : ×1,5 tous les 1000 points au-dessus de 1500 (1000 → ×0,82, 3000 → ×1,84).
    Écart, sur une victoire seulement : 1 + (adverse − soi) / 400, borné entre 0,75 et 2 (une
    victoire rapporte donc toujours plus qu'une nulle). 1500 bat 1700 : 75 ; maximum : 184.
    """
    niveau = 1.5 ** ((classement - 1500) / 1000)
    ecart = 1.0
    if resultat == "victoire":
        ecart = min(2.0, max(0.75, 1 + (classement_adverse - classement) / 400))
    return round(BASE[resultat] * niveau * ecart)


def semaine(maintenant: datetime | None = None) -> str:
    """La semaine en cours, nommée par son lundi (UTC) : « 2026-10-19 »."""
    maintenant = maintenant or datetime.now(timezone.utc)
    lundi = maintenant.date() - timedelta(days=maintenant.weekday())
    return lundi.isoformat()


def semaine_precedente(maintenant: datetime | None = None) -> str:
    maintenant = maintenant or datetime.now(timezone.utc)
    return semaine(maintenant - timedelta(days=7))


def fin_de_semaine(maintenant: datetime | None = None) -> datetime:
    """Prochaine remise à zéro : lundi suivant, 0 h UTC."""
    maintenant = maintenant or datetime.now(timezone.utc)
    lundi = datetime.fromisoformat(semaine(maintenant)).replace(tzinfo=timezone.utc)
    return lundi + timedelta(days=7)


async def compter_partie(game) -> dict[str, int] | None:
    """Ajoute les points de la semaine des deux joueurs d'une partie classée terminée.
    Renvoie {"w": points, "b": points} (None pour un bot ou une partie trop courte)."""
    if game.variant not in VARIANTES_CLASSEES or game.result not in ("1-0", "0-1", "1/2-1/2"):
        return None
    if game.board.ply < DEMI_COUPS_MIN:
        return {"w": None, "b": None}
    gagnes = {"1-0": ("victoire", "defaite"), "0-1": ("defaite", "victoire")}
    res_w, res_b = gagnes.get(game.result, ("nulle", "nulle"))
    r_w = int(str(game.wrating).rstrip("?"))
    r_b = int(str(game.brating).rstrip("?"))
    gains = {}
    for cle, joueur, resultat, r, r_adv in (
        ("w", game.wplayer, res_w, r_w, r_b),
        ("b", game.bplayer, res_b, r_b, r_w),
    ):
        if joueur.anon or joueur.entrainement:
            gains[cle] = None
            continue
        gains[cle] = points(resultat, r, r_adv)
        await ajouter(game.app_state, joueur.username, gains[cle], resultat == "victoire")
    return gains


async def ajouter(app_state, username: str, gain: int, victoire: bool):
    if app_state.db is None:
        return
    s = semaine()
    try:
        await app_state.db.palmares.update_one(
            {"_id": "%s|%s" % (s, username)},
            {
                "$inc": {"p": gain, "n": 1, "v": 1 if victoire else 0},
                "$set": {"s": s, "u": username},
            },
            upsert=True,
        )
    except Exception:
        log.exception("Palmarès : échec de l'ajout de %s points à %s", gain, username)


async def classement_semaine(app_state, s: str, limite: int = 50) -> list[dict]:
    if app_state.db is None:
        return []
    curseur = app_state.db.palmares.find({"s": s}).sort([("p", -1), ("v", -1)]).limit(limite)
    return [
        {"u": d["u"], "p": d["p"], "n": d.get("n", 0), "v": d.get("v", 0)} async for d in curseur
    ]


async def couronne(app_state) -> str | None:
    """Le premier de la semaine passée : il porte la couronne cette semaine."""
    premiers = await classement_semaine(app_state, semaine_precedente(), limite=1)
    return premiers[0]["u"] if premiers else None


async def classement_general(app_state, variant: str, limite: int = 50) -> list[dict]:
    """Classement de tous les temps sur un plateau : les comptes qui y ont joué au moins une partie
    classée, sans les bots (titre LIA)."""
    if app_state.db is None:
        return []
    cle = "perfs.%s" % variant
    curseur = (
        app_state.db.user.find({cle + ".nb": {"$gte": 1}, "title": {"$ne": "LIA"}})
        .sort(cle + ".gl.r", -1)
        .limit(limite)
    )
    lignes = []
    async for doc in curseur:
        perf = doc["perfs"][variant]
        lignes.append(
            {
                "u": doc["_id"],
                "r": round(perf["gl"]["r"]),
                "prov": perf["gl"]["d"] > 110,
                "nb": perf["nb"],
            }
        )
    return lignes


async def infos(request):
    """GET /api/palmares : la semaine (classement, sa place, fin), la couronne, et les classements
    de tous les temps des deux plateaux."""
    from aiohttp import web
    import aiohttp_session
    from pychess_global_app_state_utils import get_app_state

    app_state = get_app_state(request.app)
    session = await aiohttp_session.get_session(request)
    moi = session.get("user_name")
    s = semaine()
    top = await classement_semaine(app_state, s, limite=1000)
    ma_place = next(
        ({"rang": i + 1, **ligne} for i, ligne in enumerate(top) if ligne["u"] == moi), None
    )
    return web.json_response(
        {
            "semaine": s,
            "fin": fin_de_semaine().isoformat(),
            "top": top[:50],
            "joueurs": len(top),
            "moi": ma_place,
            "couronne": await couronne(app_state),
            "general": {v: await classement_general(app_state, v) for v in VARIANTES_CLASSEES},
        }
    )
