# -*- coding: utf-8 -*-
"""Parties classées (onglet « Classée » de /jouer) : file d'attente et adversaires d'entraînement."""

import asyncio
from unittest.mock import AsyncMock, patch

from aiohttp.test_utils import AioHTTPTestCase
from mongomock_motor import AsyncMongoMockClient

from const import RATED, reserved
from pychess_global_app_state_utils import get_app_state
from server import make_app


class BaseClassee(AioHTTPTestCase):
    """Serveur neuf et joueurs connectés (comptes) ; pas de test ici."""

    async def get_application(self):
        return make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True)

    async def tearDownAsync(self):
        app_state = get_app_state(self.app)
        for attente in list(getattr(app_state, "file_classee", {}).values()):
            if attente.tache:
                attente.tache.cancel()
        for user in app_state.users.values():
            if user.anon and not reserved(user.username) and getattr(user, "remove_task", None):
                user.remove_task.cancel()
        await self.client.close()

    def joueur(self, nom, classement=1500, anon=False):
        from user import User

        app_state = get_app_state(self.app)
        perf = {"gl": {"r": classement, "d": 80, "v": 0.06}, "la": None, "nb": 10}
        user = User(
            app_state, username=nom, anon=anon, perfs={"matatakmini": perf, "matatak": perf}
        )
        user.lobby_sockets.add(AsyncMock())
        app_state.users[nom] = user
        return user


class ClasseeTestCase(BaseClassee):
    def test_reserve_de_bots(self):
        from bots_classes import BOTS, est_bot_classe, niveau
        from users import INVITE

        self.assertEqual(len(BOTS), 240)
        for nom, classement in BOTS.items():
            # Comme un invité (« Silly-Goose »), sans son numéro : jamais confondu avec un invité
            self.assertRegex(nom, r"^[A-Z][A-Za-z]*-[A-Z][A-Za-z]*$")
            self.assertIsNone(INVITE.match(nom))
            self.assertTrue(700 <= classement <= 3000)
        self.assertTrue(est_bot_classe(next(iter(BOTS)).upper()))
        self.assertFalse(est_bot_classe("Level 7"))
        self.assertEqual((niveau(800), niveau(1500), niveau(3000)), (1, 8, 20))
        self.assertEqual((niveau(1900), niveau(2450), niveau(5000)), (12, 16, 20))
        # Les meilleurs bots jouent au niveau 20, le plus fort de Fairy-Stockfish
        self.assertEqual(niveau(max(BOTS.values())), 20)

    async def test_deux_joueurs_proches_sont_apparies_en_draft(self):
        import classee

        app_state = get_app_state(self.app)
        a = self.joueur("alice", 1500)
        b = self.joueur("bruno", 1580)
        with patch("classee.ws_send_json", new=AsyncMock()) as envoi:
            await classee.chercher(app_state, a, {"variant": "matatakmini"})
            await classee.chercher(app_state, b, {"variant": "matatakmini"})
        reponse = envoi.await_args.args[1]
        self.assertEqual(reponse["type"], "new_game")
        game = app_state.games[reponse["gameId"]]
        self.assertEqual(game.rated, RATED)
        self.assertIsNotNone(game.draft)
        self.assertEqual((game.base, game.inc), (5, 3))
        self.assertEqual(classee.en_attente(app_state), 0)

    async def test_un_seul_classement_le_mini_si_l_un_des_deux_le_prefere(self):
        """Classement unique (03/11/2026) : un joueur sur 8×8 et un sur le Mini se retrouvent dans la
        même file, la partie se joue sur le Mini, et elle compte pour le même classement."""
        import classee

        app_state = get_app_state(self.app)
        a = self.joueur("alice", 1500)
        b = self.joueur("bruno", 1540)
        with patch("classee.ws_send_json", new=AsyncMock()) as envoi:
            await classee.chercher(app_state, a, {"variant": "matatak"})
            await classee.chercher(app_state, b, {"variant": "matatakmini"})
        reponse = envoi.await_args.args[1]
        self.assertEqual(reponse["type"], "new_game")
        game = app_state.games[reponse["gameId"]]
        self.assertEqual(game.variant, "matatakmini")
        self.assertEqual(
            a.get_rating_value("matatak", False), a.get_rating_value("matatakmini", False)
        )

    async def test_ecart_trop_grand_puis_bot_classe(self):
        import classee
        from bots_classes import BOTS, niveau_du_bot

        app_state = get_app_state(self.app)
        a = self.joueur("alice", 1200)
        b = self.joueur("bruno", 2000)
        with (
            patch("classee.DELAI_BOT", 0.1),
            patch("classee.ws_send_json", new=AsyncMock()) as envoi,
        ):
            await classee.chercher(app_state, a, {"variant": "matatak"})
            await classee.chercher(app_state, b, {"variant": "matatak"})
            self.assertEqual(classee.en_attente(app_state), 2)  # 800 points d'écart : pas ensemble
            await classee.annuler(app_state, b)
            await asyncio.sleep(1.3)
        parties = [c.args[1] for c in envoi.await_args_list if c.args[1]["type"] == "new_game"]
        self.assertEqual(len(parties), 1)
        game = app_state.games[parties[0]["gameId"]]
        bot = game.bplayer if game.wplayer is a else game.wplayer
        self.assertIn(bot.username, BOTS)
        self.assertEqual(bot.title, "LIA")
        self.assertTrue(bot.entrainement)
        self.assertEqual(game.rated, RATED)
        self.assertLessEqual(abs(BOTS[bot.username] - 1200), 100)
        self.assertEqual(game.level, niveau_du_bot(bot.username))

    async def test_un_invite_joue_classe_et_garde_son_classement_a_part(self):
        """Arène sans compte (Hugo, 03 et 10/11/2026) : l'invité joue classé ; son classement est gardé
        dans la collection « invite » (effacée après un an sans partie), jamais au palmarès."""
        import classee
        from wsr import handle_abort_resign_abandon_flag

        app_state = get_app_state(self.app)
        invite = self.joueur("Cool-Camel#000001", anon=True)
        b = self.joueur("bruno", 1540)
        with patch("classee.ws_send_json", new=AsyncMock()) as envoi:
            await classee.chercher(app_state, invite, {"variant": "matatakmini"})
            await classee.chercher(app_state, b, {"variant": "matatakmini"})
        reponse = envoi.await_args.args[1]
        self.assertEqual(reponse["type"], "new_game")
        game = app_state.games[reponse["gameId"]]
        self.assertEqual(game.rated, RATED)
        game.draft = None
        with patch("wsr.round_broadcast", new=AsyncMock()):
            await handle_abort_resign_abandon_flag(
                AsyncMock(), app_state.users, b, {"type": "resign"}, game
            )
        self.assertGreater(invite.get_rating_value("matatak", False), 1500)
        doc = await app_state.db.invite.find_one({"_id": invite.username})
        self.assertEqual(doc["perfs"]["matatak"]["nb"], 11)
        self.assertIsNotNone(doc["vu"])
        self.assertIsNone(await app_state.db.user.find_one({"_id": invite.username}))
        # Jamais au classement de tous les temps
        hs = await app_state.db.highscore.find_one({"_id": "matatak"}) or {}
        self.assertFalse(any(k.startswith("Cool-Camel") for k in hs.get("scores", hs)))

    async def test_l_ordinateur_du_solo_ne_joue_pas_dans_l_arene(self):
        import classee

        app_state = get_app_state(self.app)
        ordi = self.joueur("Level 7", anon=True)
        ordi.title = "LIA"
        with patch("classee.ws_send_json", new=AsyncMock()) as envoi:
            await classee.chercher(app_state, ordi, {"variant": "matatakmini"})
        self.assertEqual(envoi.await_args.args[1]["type"], "classee_annulee")
        self.assertEqual(classee.en_attente(app_state), 0)

    async def test_invite_recree_apres_redemarrage_retrouve_son_classement(self):
        from invites import creer_index

        app_state = get_app_state(self.app)
        perf = {"gl": {"r": 1720, "d": 70, "v": 0.06}, "la": None, "nb": 4}
        await app_state.db.invite.insert_one({"_id": "Shy-Owl#123456", "perfs": {"matatak": perf}})
        user = await app_state.users.get_joueur("Shy-Owl#123456")
        self.assertTrue(user.anon)
        self.assertEqual(user.get_rating_value("matatakmini", False), 1720)
        # Effacé tout seul après un an sans partie
        await creer_index(app_state.db)
        index = await app_state.db.invite.index_information()
        self.assertTrue(any(i.get("expireAfterSeconds") == 365 * 24 * 3600 for i in index.values()))

    async def test_compte_cree_par_un_invite_reprend_classement_et_parties(self):
        from invites import reprendre_sur_le_compte

        app_state = get_app_state(self.app)
        db = app_state.db
        perf = {"gl": {"r": 1650, "d": 90, "v": 0.06}, "la": None, "nb": 3}
        await db.invite.insert_one({"_id": "Shy-Owl#000009", "perfs": {"matatak": perf}})
        await db.game.insert_one({"_id": "abcdefgh", "us": ["Shy-Owl#000009", "bruno"]})
        await db.user.insert_one({"_id": "hibou", "perfs": {}})
        self.assertTrue(await reprendre_sur_le_compte(app_state, "Shy-Owl#000009", "hibou"))
        self.assertEqual((await db.user.find_one({"_id": "hibou"}))["perfs"]["matatak"]["nb"], 3)
        self.assertEqual((await db.game.find_one({"_id": "abcdefgh"}))["us"], ["hibou", "bruno"])
        self.assertIsNone(await db.invite.find_one({"_id": "Shy-Owl#000009"}))
        # Sans partie classée : rien à reprendre, le compte part de 1500
        await db.invite.insert_one(
            {"_id": "Shy-Owl#000010", "perfs": {"matatak": dict(perf, nb=0)}}
        )
        await db.user.insert_one({"_id": "chouette", "perfs": {}})
        self.assertFalse(await reprendre_sur_le_compte(app_state, "Shy-Owl#000010", "chouette"))
        self.assertFalse(await reprendre_sur_le_compte(app_state, "bruno", "chouette"))

    async def partie_contre_un_bot(self, nom="alice", classement=1500):
        import classee

        app_state = get_app_state(self.app)
        a = self.joueur(nom, classement)
        with patch("classee.DELAI_BOT", 0), patch("classee.ws_send_json", new=AsyncMock()) as envoi:
            await classee.chercher(app_state, a, {"variant": "matatakmini"})
            await asyncio.sleep(1.2)
        game = app_state.games[envoi.await_args.args[1]["gameId"]]
        bot = game.bplayer if game.wplayer is a else game.wplayer
        return a, bot, game

    async def test_contre_un_bot_pas_de_reprise_et_le_bot_qui_tombe_au_temps_gagne(self):
        from bots_classes import BOTS, DERIVE_MAX
        from wsr import message_autorise

        app_state = get_app_state(self.app)
        a, bot, game = await self.partie_contre_un_bot()
        self.assertFalse(message_autorise(a, {"type": "takeback", "gameId": game.id}, game))

        # Le bot tombe au temps (le joueur a fermé la page) : c'est le joueur qui perd
        game.draft = None
        for _ in range(4):
            game.board.push(game.board.legal_moves()[0])
        await game.game_ended(bot, "flag")
        self.assertEqual(game.result, "1-0" if game.wplayer is bot else "0-1")
        self.assertLess(a.get_rating_value("matatakmini", False), 1500)
        # Le bot gagne quelques points, enregistrés en base, sans s'éloigner de son ancrage
        ancrage = BOTS[bot.username]
        apres = bot.get_rating_value("matatakmini", False)
        self.assertTrue(ancrage < apres <= ancrage + DERIVE_MAX, (ancrage, apres))
        doc = await app_state.db.user.find_one({"_id": bot.username})
        # Un seul classement pour les deux plateaux : enregistré sous « matatak »
        self.assertEqual(round(doc["perfs"]["matatak"]["gl"]["r"]), apres)

    def test_un_bot_ne_s_eloigne_pas_de_son_ancrage(self):
        from bots_classes import BOTS, DERIVE_MAX, PHI_BOT, borner
        from glicko2.glicko2 import gl2

        nom = next(iter(BOTS))
        r = borner(nom, gl2.create_rating(BOTS[nom] - 900, 30, 0.06, None))
        self.assertEqual((r.mu, r.phi), (BOTS[nom] - DERIVE_MAX, PHI_BOT))

    async def test_classee_comptee_des_le_debut_sans_annulation(self):
        """Hugo : on n'annule pas une partie classée parce que son équipe ne plaît pas."""
        from wsr import handle_abort_resign_abandon_flag

        app_state = get_app_state(self.app)
        a, bot, game = await self.partie_contre_un_bot()
        game.draft = None
        await handle_abort_resign_abandon_flag(
            AsyncMock(), app_state.users, a, {"type": "abort"}, game
        )
        self.assertEqual(game.result, "*")
        # Abandon avant le premier coup : la partie compte et reste en base
        with patch("wsr.round_broadcast", new=AsyncMock()):
            await handle_abort_resign_abandon_flag(
                AsyncMock(), app_state.users, a, {"type": "resign"}, game
            )
        self.assertNotEqual(game.result, "*")
        self.assertLess(a.get_rating_value("matatakmini", False), 1500)
        self.assertIsNotNone(await app_state.db.game.find_one({"_id": game.id}))

    async def partie_entre_humains(self, delai=None):
        import classee

        app_state = get_app_state(self.app)
        a = self.joueur("alice", 1500)
        b = self.joueur("bruno", 1500)
        with patch("classee.ws_send_json", new=AsyncMock()) as envoi:
            if delai is not None:
                with patch("game.DELAI_CLASSEE", delai):
                    await classee.chercher(app_state, a, {"variant": "matatakmini"})
                    await classee.chercher(app_state, b, {"variant": "matatakmini"})
            else:
                await classee.chercher(app_state, a, {"variant": "matatakmini"})
                await classee.chercher(app_state, b, {"variant": "matatakmini"})
        return a, b, app_state.games[envoi.await_args.args[1]["gameId"]]

    async def test_draft_classe_abandonne_la_partie_est_annulee(self):
        """Hugo : quitter un Draft annule la partie (personne ne bloque son adversaire)."""
        from const import ABORTED

        app_state = get_app_state(self.app)
        with patch("broadcast.round_broadcast", new=AsyncMock()):
            a, b, game = await self.partie_entre_humains(delai=0.5)
            self.assertIsNotNone(game.draft.etat()["reste"])
            for _ in range(10):
                await asyncio.sleep(0.5)
                if game.status > 0:
                    break
        self.assertEqual((game.status, game.result), (ABORTED, "*"))
        self.assertEqual(a.get_rating_value("matatakmini", False), 1500)
        self.assertIsNone(await app_state.db.game.find_one({"_id": game.id}))

    async def test_annuler_pendant_le_draft_mais_pas_apres(self):
        from draft import FINI
        from const import ABORTED
        from wsr import avancer_draft, handle_abort_resign_abandon_flag

        app_state = get_app_state(self.app)
        a, b, game = await self.partie_entre_humains()
        # Draft terminé (chacun fait ses étapes) : le premier coup est chronométré, plus d'annulation
        with patch("wsr.round_broadcast", new=AsyncMock()):
            while game.draft.phase != FINI:
                for couleur in ("white", "black"):
                    if game.draft.phase != FINI and (game.draft.acteur() in (couleur, None)):
                        game.draft.jouer_ordinateur(couleur)
                await avancer_draft(game)
            self.assertTrue(game.stopwatch.running)
            self.assertEqual(game.stopwatch.secs, 30 * 1000)
            await handle_abort_resign_abandon_flag(
                AsyncMock(), app_state.users, a, {"type": "abort"}, game
            )
        self.assertEqual(game.result, "*")
        self.assertLess(game.status, 0)

        # Une autre partie, encore en Draft : l'annulation passe
        a2, b2, game2 = await self.partie_entre_humains()
        with patch("wsr.round_broadcast", new=AsyncMock()):
            await handle_abort_resign_abandon_flag(
                AsyncMock(), app_state.users, a2, {"type": "abort"}, game2
            )
        self.assertEqual(game2.status, ABORTED)
        self.assertEqual(game2.result, "*")

    async def test_redefier_apres_une_partie_classee_nouveau_draft(self):
        from wsr import handle_rematch

        app_state = get_app_state(self.app)
        a, b, game = await self.partie_entre_humains()
        game.draft = None
        game.rois = {"white": "ete", "black": "hiver"}  # équipes d'un Draft fini
        await game.game_ended(a, "resign")
        with (
            patch("wsr.round_broadcast", new=AsyncMock()),
            patch("wsr.ws_send_json", new=AsyncMock()) as envoi,
        ):
            await handle_rematch(
                app_state, AsyncMock(), a, {"gameId": game.id, "handicap": False}, game
            )
            await handle_rematch(
                app_state, AsyncMock(), b, {"gameId": game.id, "handicap": False}, game
            )
        nouvelle = app_state.games[envoi.await_args.args[1]["gameId"]]
        self.assertEqual((nouvelle.rated, nouvelle.base, nouvelle.inc), (RATED, 5, 3))
        self.assertIsNotNone(nouvelle.draft)  # pas les mêmes équipes : un nouveau Draft

    async def test_bot_recree_apres_redemarrage_et_pseudo_reserve(self):
        from bots_classes import BOTS
        from users import NotInDbUsers

        app_state = get_app_state(self.app)
        nom = next(iter(BOTS))
        with self.assertNoLogs(level="ERROR"):
            with self.assertRaises(NotInDbUsers):
                await app_state.users.get(nom)
        bot = await app_state.users.get_joueur(nom)
        self.assertTrue(bot.entrainement)
        # Créé en base à sa première partie, puis relu tel quel après un redémarrage
        del app_state.users[nom]
        relu = await app_state.users.get(nom)
        self.assertTrue(relu.entrainement)
        self.assertEqual(relu.title, "LIA")
        resp = await self.client.post("/api/check-username", json={"username": nom.lower()})
        if resp.status == 200:
            self.assertFalse((await resp.json())["available"])


class DefiTestCase(BaseClassee):
    """Liste des joueurs en ligne de l'onglet Classée et défis entre eux."""

    async def test_liste_des_joueurs_en_ligne(self):
        import classee

        app_state = get_app_state(self.app)
        a = self.joueur("alice", 1500)
        b = self.joueur("bruno", 1620)
        invite = self.joueur("Cool-Camel#000002", anon=True)
        for u in (a, b, invite):
            app_state.lobby.lobbysockets[u.username] = u.lobby_sockets
        liste = classee.joueurs_en_ligne(app_state, a)
        # ni soi-même ; les invités aussi, on peut les défier (Hugo, 10/11/2026)
        self.assertEqual([j["u"] for j in liste], ["bruno", "Cool-Camel#000002"])
        self.assertEqual(liste[0]["matatakmini"]["r"], 1620)
        self.assertFalse(liste[0]["en_partie"])

    async def test_defi_accepte_puis_partie_classee_en_draft(self):
        import classee

        app_state = get_app_state(self.app)
        a = self.joueur("alice", 1500)
        b = self.joueur("bruno", 2100)  # écart sans importance : on se choisit
        with patch("classee.ws_send_json", new=AsyncMock()) as envoi:
            await classee.defier(app_state, a, {"variant": "matatak", "adversaire": "bruno"})
            recu = next(
                c.args[1] for c in envoi.await_args_list if c.args[1]["type"] == "classee_defi"
            )
            self.assertEqual((recu["de"], recu["cadence"], recu["r"]), ("alice", "5+3", 1500))
            # Seul le joueur défié peut accepter
            await classee.repondre(app_state, a, {"id": recu["id"], "accepte": True})
            self.assertFalse(any(c.args[1]["type"] == "new_game" for c in envoi.await_args_list))
            await classee.repondre(app_state, b, {"id": recu["id"], "accepte": True})
        parties = [c.args[1] for c in envoi.await_args_list if c.args[1]["type"] == "new_game"]
        self.assertEqual(len(parties), 2)  # envoyé aux deux joueurs
        game = app_state.games[parties[0]["gameId"]]
        self.assertEqual((game.rated, game.base, game.inc), (RATED, 5, 3))
        self.assertIsNotNone(game.draft)
        self.assertEqual({game.wplayer.username, game.bplayer.username}, {"alice", "bruno"})

    async def test_defi_refuse_annule_expire(self):
        import classee

        app_state = get_app_state(self.app)
        a = self.joueur("alice", 1500)
        b = self.joueur("bruno", 1500)

        async def defi():
            await classee.defier(app_state, a, {"variant": "matatakmini", "adversaire": "bruno"})
            return next(iter(classee._defis(app_state).values()))

        with (
            patch("classee.DELAI_DEFI", 0.2),
            patch("classee.ws_send_json", new=AsyncMock()) as envoi,
        ):
            d = await defi()
            await classee.repondre(app_state, b, {"id": d.id, "accepte": False})
            d = await defi()
            await classee.repondre(app_state, a, {"id": d.id, "annuler": True})
            await defi()
            await asyncio.sleep(0.5)
        fins = [
            c.args[1]["raison"]
            for c in envoi.await_args_list
            if c.args[1]["type"] == "classee_defi_fin"
        ]
        self.assertEqual(fins, ["refuse", "refuse", "annule", "annule", "expire", "expire"])
        self.assertEqual(classee._defis(app_state), {})

    async def test_defi_a_un_invite_mais_pas_a_soi_meme(self):
        import classee

        app_state = get_app_state(self.app)
        a = self.joueur("alice", 1500)
        self.joueur("Cool-Camel#000003", anon=True)
        with patch("classee.ws_send_json", new=AsyncMock()):
            for nom in ("alice", "personne"):
                await classee.defier(app_state, a, {"variant": "matatakmini", "adversaire": nom})
            self.assertEqual(classee._defis(app_state), {})
            await classee.defier(
                app_state, a, {"variant": "matatakmini", "adversaire": "Cool-Camel#000003"}
            )
        self.assertEqual(
            [d.a.username for d in classee._defis(app_state).values()], ["Cool-Camel#000003"]
        )
        for d in list(classee._defis(app_state).values()):
            d.tache.cancel()


class PersosDuDraftTestCase(BaseClassee):
    """Personnages du Draft (Hugo, 03/11/2026) : toujours la base (équipes de départ + DUB et JAZZ),
    plus ceux choisis ; dans l'Arène, seulement ceux que les deux joueurs ont."""

    def test_reserve_base_et_en_plus(self):
        import random
        from draft import BASE_CHAMPIONS, BASE_PIONS, Draft, en_commun, nettoyer_en_plus

        for graine in range(30):
            d = Draft("matatakmini", random.Random(graine))
            self.assertTrue(set(d.pions) <= set(BASE_PIONS))
            self.assertTrue(set(d.champions) <= set(BASE_CHAMPIONS))
        vus = set()
        for graine in range(200):
            d = Draft("matatak", random.Random(graine), en_plus="ds")
            vus |= set(d.pions) | set(d.champions)
        self.assertTrue({"d", "s"} <= vus)  # FUNK et SALSA tirés au moins une fois
        self.assertTrue(vus <= set(BASE_PIONS + BASE_CHAMPIONS + "ds"))
        # Lettres inconnues, base ou doublons : ignorés
        self.assertEqual(nettoyer_en_plus("ssdkX!b"), "ds")
        self.assertEqual(nettoyer_en_plus(None), "")
        self.assertEqual(en_commun("dsa", "sa"), "as")

    async def test_arene_personnages_en_commun(self):
        import classee

        app_state = get_app_state(self.app)
        a = self.joueur("alice", 1500)
        b = self.joueur("bruno", 1520)
        with patch("classee.ws_send_json", new=AsyncMock()) as envoi:
            await classee.chercher(app_state, a, {"variant": "matatakmini", "persos": "dsa"})
            await classee.chercher(app_state, b, {"variant": "matatakmini", "persos": "sz"})
        game = app_state.games[envoi.await_args.args[1]["gameId"]]
        self.assertEqual(game.persos, "s")
        self.assertEqual(game.draft.en_plus, "s")

    def test_l_ordinateur_choisit_selon_la_force_de_l_excel(self):
        """Draft contre l'ordinateur (Hugo, 03/11/2026) : la colonne Force de l'Excel, pas les étoiles.
        KRAK (4★, 700) + DUB (2★, 350) contre FUNK (4★, 900) + DYSKO (3★, 600) : même écart d'étoiles
        moins grand, mais le second groupe vaut nettement plus."""
        import random
        from draft import CHAMPIONS_CHOISIR, Draft

        d = Draft("matatak", random.Random(1))
        d.champions = list("xhdcnn")
        d.groupes["pions"], d.choix["pions"] = [[0, 1, 2], [3, 4, 5]], 0
        d.phase = CHAMPIONS_CHOISIR
        d.groupes["champions"] = [[0, 1, 6], [2, 3, 7]]
        d.jouer_ordinateur("white", random.Random(0), niveau=20)
        self.assertEqual(d.choix["champions"], 1)
        # Niveau 1 : il lui arrive de prendre le moins bon groupe, jamais au niveau 20
        moins_bons = 0
        for graine in range(200):
            d.phase, d.choix["champions"] = CHAMPIONS_CHOISIR, None
            d.jouer_ordinateur("white", random.Random(graine), niveau=1)
            moins_bons += d.choix["champions"] == 0
        self.assertTrue(30 < moins_bons < 110, moins_bons)
