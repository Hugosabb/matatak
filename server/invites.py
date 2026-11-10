"""Arène sans compte (Hugo, 03 et 10/11/2026) : un invité joue classé.

Les invités (« Adjectif-Animal#000000 ») n'existent qu'en mémoire ; leur classement est gardé dans une
collection à part, ``invite`` ({_id: pseudo, perfs, vu}), jamais mêlée aux comptes : pas au palmarès,
pas au classement de tous les temps. Il est effacé tout seul après un an sans partie (index TTL sur
``vu``). Quand l'invité crée un compte, son classement et ses parties sont repris sur le compte s'il a
joué au moins une partie classée (sinon le compte part de 1500).
"""

from __future__ import annotations

from datetime import datetime, timezone

from classement_unique import CLE_CLASSEMENT as CLE
from logger import log

UN_AN = 365 * 24 * 3600


def est_invite(user) -> bool:
    """Un invité (pas l'ordinateur du Solo, « Level N », lui aussi en mémoire seulement)."""
    from users import INVITE

    return bool(
        user is not None and user.anon and user.title != "LIA" and INVITE.match(user.username or "")
    )


def peut_jouer_en_arene(user) -> bool:
    """Compte, ou invité ; jamais l'ordinateur du Solo ni un adversaire d'entraînement."""
    return user is not None and (not user.anon or est_invite(user)) and not user.entrainement


async def creer_index(db):
    if db is not None:
        await db.invite.create_index("vu", expireAfterSeconds=UN_AN)


async def enregistrer(app_state, user):
    """Après une partie classée : classement de l'invité, et la date qui repousse son effacement."""
    if app_state.db is None:
        return
    await app_state.db.invite.update_one(
        {"_id": user.username},
        {"$set": {"perfs": user.perfs, "vu": datetime.now(timezone.utc)}},
        upsert=True,
    )


async def charger(app_state, user):
    """Invité recréé (redémarrage du serveur, purge de la mémoire) : il retrouve son classement."""
    if app_state.db is None:
        return
    doc = await app_state.db.invite.find_one({"_id": user.username})
    if doc and doc.get("perfs"):
        user.perfs.update(doc["perfs"])


async def reprendre_sur_le_compte(app_state, ancien: str | None, compte: str) -> bool:
    """Nouveau compte créé depuis la session d'un invité : classement et parties de l'invité repris."""
    from users import INVITE

    db = app_state.db
    if db is None or not ancien or not INVITE.match(ancien):
        return False
    doc = await db.invite.find_one({"_id": ancien})
    perf = (doc or {}).get("perfs", {}).get(CLE)
    if not perf or not perf.get("nb"):
        return False
    await db.user.update_one({"_id": compte}, {"$set": {"perfs.%s" % CLE: perf}})
    for i in (0, 1):  # Blancs, Noirs (« us » = [Blancs, Noirs])
        await db.game.update_many({"us.%d" % i: ancien}, {"$set": {"us.%d" % i: compte}})
    await db.invite.delete_one({"_id": ancien})
    log.info(
        "Invité %s repris sur le nouveau compte %s (%s parties classées)",
        ancien,
        compte,
        perf["nb"],
    )
    return True
