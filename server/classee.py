"""Parties classées : file d'attente de l'onglet « Classée » de /jouer.

Le joueur (connecté) demande une partie sur un plateau. On cherche un autre joueur en attente de
classement proche ; l'écart accepté grandit avec l'attente. Au bout de DELAI_BOT secondes sans
adversaire, un adversaire d'entraînement de son niveau prend la place (bots_classes.py).
Toujours en Draft, à cadence fixe par plateau. Inspiré de auto_pair.py (appariement pychess).
"""

from __future__ import annotations
import asyncio
import time

from bots_classes import choisir_bot, creer_bot, niveau_du_bot
from const import STARTED
from logger import log
from newid import new_id
from seek import Seek
from utils import join_seek
from websocket_utils import ws_send_json

# (minutes, incrément) par plateau
CADENCES = {"matatakmini": (5, 3), "matatak": (5, 3)}  # choix d'Hugo : deux classements, 5+3
DELAI_BOT = 15
ECART_DEPART = 150
ECART_PAR_SECONDE = 20


class Attente:
    def __init__(self, user, variant, classement):
        self.user = user
        self.variant = variant
        self.classement = classement
        self.debut = time.monotonic()
        self.tache: asyncio.Task | None = None

    @property
    def ecart(self) -> float:
        return ECART_DEPART + ECART_PAR_SECONDE * (time.monotonic() - self.debut)


def _file(app_state) -> dict:
    """{username: Attente}"""
    if not hasattr(app_state, "file_classee"):
        app_state.file_classee = {}
    return app_state.file_classee


def _derniers(app_state) -> dict:
    """{username: dernier bot affronté} : on évite de retomber deux fois de suite sur le même."""
    if not hasattr(app_state, "derniers_bots"):
        app_state.derniers_bots = {}
    return app_state.derniers_bots


async def _envoyer(user, message):
    for ws in list(user.lobby_sockets):
        await ws_send_json(ws, message)


def _adversaire(app_state, attente: Attente) -> Attente | None:
    for autre in _file(app_state).values():
        if autre is attente or autre.variant != attente.variant:
            continue
        ecart = abs(autre.classement - attente.classement)
        if ecart <= min(autre.ecart, attente.ecart):
            return autre
    return None


async def _creer_partie(app_state, joueur, adversaire, variant, level=0):
    minutes, inc = CADENCES[variant]
    seek_id = await new_id(None if app_state.db is None else app_state.db.seek)
    seek = Seek(
        seek_id,
        joueur,
        variant,
        color="r",
        base=minutes,
        inc=inc,
        level=level,
        player1=joueur,
        rated=True,
        isDraft=True,
    )
    response = await join_seek(app_state, adversaire, seek)
    game = app_state.games.get(response.get("gameId"))
    if game is not None and game.draft is not None:
        asyncio.create_task(surveiller_draft(game), name="draft-classe-%s" % game.id)
    return response


async def surveiller_draft(game):
    """Draft classé : passé le délai d'une étape (draft.DELAI_CLASSEE), le serveur la joue à la
    place du joueur en retard, comme l'ordinateur du Solo. Personne ne bloque la partie."""
    from draft import FINI
    from wsr import avancer_draft, message_draft
    from broadcast import round_broadcast

    while game.draft is not None and game.draft.phase != FINI and game.status <= STARTED:
        await asyncio.sleep(1)
        if game.draft.phase == FINI or game.status > STARTED:
            return
        retard = game.draft.en_retard()
        if not retard:
            continue
        log.info("Draft classé %s : étape jouée par le serveur pour %s", game.id, retard)
        for couleur in retard:
            game.draft.jouer_ordinateur(couleur)
        if game.draft.phase != FINI:
            await round_broadcast(game, message_draft(game), full=True)
        await avancer_draft(game)


def _retirer(app_state, username):
    attente = _file(app_state).pop(username, None)
    if (
        attente is not None
        and attente.tache is not None
        and attente.tache is not asyncio.current_task()
    ):
        attente.tache.cancel()
    return attente


async def _attendre(app_state, attente: Attente):
    """Cherche un humain chaque seconde (l'écart s'élargit), puis donne un bot."""
    try:
        while time.monotonic() - attente.debut < DELAI_BOT:
            await asyncio.sleep(1)
            if _file(app_state).get(attente.user.username) is not attente:
                return
            autre = _adversaire(app_state, attente)
            if autre is not None:
                await _apparier(app_state, attente, autre)
                return
        if _file(app_state).get(attente.user.username) is not attente:
            return
        _retirer(app_state, attente.user.username)
        user = attente.user
        nom = await choisir_bot(
            app_state,
            attente.variant,
            attente.classement,
            {_derniers(app_state).get(user.username, "")},
        )
        _derniers(app_state)[user.username] = nom
        bot = await creer_bot(app_state, nom)
        response = await _creer_partie(app_state, user, bot, attente.variant, niveau_du_bot(nom))
        log.info("Partie classée %s contre l'entraînement %s", user.username, nom)
        await _envoyer(user, response)
    except asyncio.CancelledError:
        pass
    except Exception:
        log.exception("File classée : échec pour %s", attente.user.username)
        _retirer(app_state, attente.user.username)
        await _envoyer(attente.user, {"type": "classee_annulee"})


async def _apparier(app_state, a: Attente, b: Attente):
    _retirer(app_state, a.user.username)
    _retirer(app_state, b.user.username)
    response = await _creer_partie(app_state, a.user, b.user, a.variant)
    log.info("Partie classée %s contre %s", a.user.username, b.user.username)
    await _envoyer(a.user, response)
    await _envoyer(b.user, response)


async def chercher(app_state, user, data):
    """Message « classee_chercher » {variant} de la WebSocket du salon."""
    variant = data.get("variant")
    if user.anon or variant not in CADENCES:
        await _envoyer(user, {"type": "classee_annulee"})
        return
    _retirer(app_state, user.username)
    attente = Attente(user, variant, user.get_rating_value(variant, False))
    _file(app_state)[user.username] = attente

    autre = _adversaire(app_state, attente)
    if autre is not None:
        await _apparier(app_state, attente, autre)
        return
    await _envoyer(user, {"type": "classee_attente", "variant": variant})
    attente.tache = asyncio.create_task(
        _attendre(app_state, attente), name="classee-%s" % user.username
    )


async def annuler(app_state, user):
    """Message « classee_annuler », ou le joueur a fermé toutes ses pages du salon."""
    if _retirer(app_state, user.username) is not None:
        await _envoyer(user, {"type": "classee_annulee"})


def en_attente(app_state, variant=None) -> int:
    return sum(1 for a in _file(app_state).values() if variant is None or a.variant == variant)


async def infos(request):
    """GET /api/classee : classements du joueur pour l'onglet « Classée » de /jouer."""
    from aiohttp import web
    import aiohttp_session
    from pychess_global_app_state_utils import get_app_state
    from users import NotInDbUsers

    app_state = get_app_state(request.app)
    session = await aiohttp_session.get_session(request)
    try:
        user = await app_state.users.get(session.get("user_name"))
    except NotInDbUsers:
        user = None
    if user is None or user.anon:
        return web.json_response({"connecte": False})
    reponse = {"connecte": True, "username": user.username}
    for variant, (minutes, inc) in CADENCES.items():
        rating = user.get_rating(variant, False)
        r, prov = rating.rating_prov
        reponse[variant] = {
            "r": r,
            "prov": prov == "?",
            "nb": user.perfs.get(variant, {}).get("nb", 0),
            "cadence": "%d+%d" % (minutes, inc),
        }
    return web.json_response(reponse)
