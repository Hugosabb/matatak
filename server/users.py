from __future__ import annotations
import re
from collections import UserDict

import bots_classes
from bots_classes import creer_bot, est_bot_classe
from const import BLOCK, MAX_USER_BLOCK, NONE_USER, TYPE_CHECKING
from glicko2.glicko2 import DEFAULT_PERF
from user import User
from logger import log
from variants import RATED_VARIANTS

if TYPE_CHECKING:
    from pychess_global_app_state import PychessGlobalAppState

# Noms jamais en base : invités (const.random_anonyme_username) et ordinateur du mode Solo
INVITE = re.compile(r"^[A-Z][A-Za-z]*-[A-Z][A-Za-z]*#\d{6}$")
ORDINATEUR = re.compile(r"^Level ([1-9]|1[0-9]|20)$")


class NotInAppUsers(Exception):
    """Raised when dict access syntax was used, but username not in Users dict"""


class NotInDbUsers(Exception):
    """Raised when await get() syntax was used, but username not in db users"""


class Users(UserDict):
    """
    The Users class: store user objects in memory

    If we know for sure that username is already in the dict, we can use dictionary access syntax.
    If not, await get(username) will load user data from mongodb
    """

    def __init__(self, app_state: PychessGlobalAppState):
        super().__init__()
        self.app_state = app_state

    def __getitem__(self, username):
        if username in self.data:
            return self.data[username]
        else:
            # raise NotInAppUsers("%s is not in Users. Use await users.get() instead.", username)
            user = self.data[NONE_USER]
            return user

    async def get_joueur(self, username):
        """Comme get(), mais recrée sous le même nom un invité ou l'ordinateur (Level N).

        Ils ne sont jamais en base, seulement en mémoire : après un redémarrage, leurs parties en
        cours n'étaient plus rechargées et l'invité revenait sous un nouveau nom (AUDIT P1-7).
        À n'utiliser que pour un nom sûr : joueur d'une partie en base, ou cookie de session
        (chiffré par le serveur), jamais pour un nom tapé dans une adresse.
        """
        try:
            return await self.get(username)
        except NotInDbUsers:
            if est_bot_classe(username):
                return await creer_bot(self.app_state, username)
            if ORDINATEUR.match(username or ""):
                user = User(self.app_state, username=username, title="LIA", anon=True)
            elif INVITE.match(username or ""):
                user = User(self.app_state, username=username, anon=True)
            else:
                raise
            self.data[username] = user
            return user

    async def get(self, username):
        if username in self.data:
            return self.data[username]

        if username is None:
            user = self.data[NONE_USER]
            return user

        doc = await self.app_state.db.user.find_one({"_id": username})
        if doc is not None and est_bot_classe(username):
            return bots_classes.utilisateur(self.app_state, doc)
        if doc is None:
            if est_bot_classe(username):
                raise NotInDbUsers  # adversaire d'entraînement pas encore créé (creer_bot)
            log.error("--- users.get() %s NOT IN db ---", username)
            raise NotInDbUsers
            # return self.data[NONE_USER]
        else:
            perfs = doc.get("perfs", {variant: DEFAULT_PERF for variant in RATED_VARIANTS})
            pperfs = doc.get("pperfs", {variant: DEFAULT_PERF for variant in RATED_VARIANTS})

            user = User(
                self.app_state,
                username=username,
                title=doc.get("title"),
                bot=doc.get("title") == "BOT",
                perfs=perfs,
                pperfs=pperfs,
                enabled=doc.get("enabled", True),
                lang=doc.get("lang", "en"),
                theme=doc.get("theme", "dark"),
                oauth_id=doc.get("oauth_id"),
                oauth_provider=doc.get("oauth_provider"),
            )
            self.data[username] = user

            cursor = self.app_state.db.relation.find({"u1": username, "r": BLOCK})
            docs = await cursor.to_list(MAX_USER_BLOCK)
            user.blocked = {doc["u2"] for doc in docs}

            return user
