"""Progression de l'Aventure gardée sur le compte (bug d'Hugo du 03/11/2026).

L'Aventure vit dans le navigateur (localStorage, client/aventure/progression.ts). Sur iPhone, l'appli
installée sur l'écran d'accueil n'a pas le même stockage que Safari : elle repartait du niveau 0. Le
navigateur d'un joueur connecté envoie donc sa progression ici à chaque changement, et la relit à
l'ouverture de /jouer ; on garde toujours la plus avancée (décision d'Hugo).

    GET  /api/aventure   {"connecte": bool, "aventure": {...} | None, "tutoriel": str | None}
    POST /api/aventure   {"aventure": {...}, "tutoriel": str | None}  ou  {"reinitialiser": true}

Le serveur refuse une progression moins avancée que celle qu'il a (un appareil neuf ne peut pas
écraser le niveau 14), sauf « reinitialiser » (le joueur a choisi de recommencer). La réponse du POST
est la progression gardée : le navigateur la reprend si elle est plus loin que la sienne.
"""

from __future__ import annotations
from datetime import datetime, timezone
import json

import aiohttp_session
from aiohttp import web

from pychess_global_app_state_utils import get_app_state
from users import NotInDbUsers

TAILLE_MAX = 20_000  # octets : une progression fait moins de 2 Ko
ROIS = ("AZAR", "SHANS", "KARMA", "MOJO")
# Valeurs de localStorage « matatak_tutoriel » (« fini », « connu », ou rien)
TUTORIELS = ("fini", "connu")


def avancement(p: dict | None) -> tuple:
    """Plus grand = plus loin sur la route : étape, puis victoires de l'étape, puis parties jouées."""
    if not p:
        return (-1, -1, -1)
    return (int(p.get("etape", 0)), int(p.get("victoires", 0)), int(p.get("parties", 0)))


def valide(p) -> bool:
    """Forme attendue (Progression, version 1) ; le contenu reste celui du joueur, comme sur son
    appareil : il ne donne accès à rien d'autre que son Aventure."""
    try:
        return (
            isinstance(p, dict)
            and p.get("version") == 1
            and p.get("roi") in ROIS
            and isinstance(p.get("recrues"), list)
            and isinstance(p.get("equipe"), dict)
            and all(
                isinstance(p.get(k), int) and p.get(k) >= 0
                for k in ("etape", "victoires", "parties")
            )
        )
    except Exception:
        return False


async def _joueur(request):
    """Le joueur connecté (pas un invité), ou None."""
    app_state = get_app_state(request.app)
    session = await aiohttp_session.get_session(request)
    try:
        user = await app_state.users.get(session.get("user_name"))
    except NotInDbUsers:
        return None, app_state
    if user is None or user.anon:
        return None, app_state
    return user, app_state


async def _lire(app_state, username) -> dict:
    if app_state.db is None:
        return {}
    doc = await app_state.db.user.find_one({"_id": username}, {"aventure": 1})
    return (doc or {}).get("aventure") or {}


def _reponse(stocke: dict) -> web.Response:
    return web.json_response(
        {"connecte": True, "aventure": stocke.get("p"), "tutoriel": stocke.get("t")}
    )


async def lire(request):
    user, app_state = await _joueur(request)
    if user is None:
        return web.json_response({"connecte": False})
    return _reponse(await _lire(app_state, user.username))


async def enregistrer(request):
    user, app_state = await _joueur(request)
    if user is None:
        return web.json_response({"connecte": False}, status=401)
    # JSON seulement : un formulaire d'un autre site ne peut pas en envoyer sans autorisation (CORS)
    if request.content_type != "application/json":
        return web.json_response({"erreur": "json"}, status=415)
    corps = await request.read()
    if len(corps) > TAILLE_MAX:
        return web.json_response({"erreur": "trop gros"}, status=413)
    try:
        data = json.loads(corps)
    except ValueError:
        return web.json_response({"erreur": "json"}, status=400)
    if not isinstance(data, dict):
        return web.json_response({"erreur": "json"}, status=400)

    stocke = await _lire(app_state, user.username)
    tutoriel = data.get("tutoriel")
    # Le tutoriel ne se « désapprend » pas : on garde « fini » / « connu » s'il est déjà noté
    t = (
        stocke.get("t")
        if stocke.get("t") in TUTORIELS
        else (tutoriel if tutoriel in TUTORIELS else None)
    )
    if t == "connu" and tutoriel == "fini":
        t = "fini"

    if data.get("reinitialiser"):
        nouveau = {"p": None, "t": t}
    else:
        p = data.get("aventure")
        if p is not None and not valide(p):
            return web.json_response({"erreur": "progression"}, status=400)
        garde = p if avancement(p) >= avancement(stocke.get("p")) else stocke.get("p")
        nouveau = {"p": garde, "t": t}

    if nouveau != {"p": stocke.get("p"), "t": stocke.get("t")} and app_state.db is not None:
        await app_state.db.user.update_one(
            {"_id": user.username},
            {"$set": {"aventure": dict(nouveau, maj=datetime.now(timezone.utc))}},
        )
    return _reponse(nouveau)
