# -*- coding: utf-8 -*-
"""Tests de non-régression des bugs propres à Matatak (voir issues corrigées dans l'historique git)."""

import json
import logging
import time
from unittest.mock import AsyncMock, patch

from aiohttp.test_utils import AioHTTPTestCase
from mongomock_motor import AsyncMongoMockClient

from const import reserved
from pychess_global_app_state_utils import get_app_state
from puzzle import empty_puzzle
from server import make_app

logging.basicConfig()
logging.getLogger().setLevel(level=logging.ERROR)


def session_cookie(username):
    """Cookie de session au format de SimpleCookieStorage (make_app(simple_cookie_storage=True))."""
    return {"AIOHTTP_SESSION": json.dumps({"session": {"user_name": username}, "created": int(time.time())})}


class MatatakViewsTestCase(AioHTTPTestCase):
    async def get_application(self):
        return make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True)

    async def tearDownAsync(self):
        app_state = get_app_state(self.app)
        for user in app_state.users.values():
            if user.anon and not reserved(user.username):
                user.remove_task.cancel()
        await self.client.close()

    async def test_registered_user_not_in_memory(self):
        """Un joueur enregistré dont la session survit à un redémarrage du serveur ne doit pas avoir de 500.

        Avant la correction, `from const import NONE_USER` placé dans le corps du `if` rendait
        `NONE_USER` local à la fonction : UnboundLocalError (HTTP 500) à la première page.
        """
        app_state = get_app_state(self.app)
        await app_state.db.user.insert_one({"_id": "ChipsouChess", "title": ""})
        self.assertNotIn("ChipsouChess", app_state.users)  # comme après un redémarrage

        resp = await self.client.request("GET", "/about", cookies=session_cookie("ChipsouChess"))
        self.assertEqual(resp.status, 200)
        self.assertIn("ChipsouChess", await resp.text())  # reconnu, pas remplacé par un invité

    async def test_unknown_session_user_becomes_guest(self):
        """Un invité d'avant le redémarrage garde son nom (sa partie en cours est rechargée sous ce
        nom, AUDIT P1-7) ; un pseudo inconnu qui n'a pas la forme d'un nom d'invité reçoit un
        nouvel invité. Jamais de 500."""
        resp = await self.client.request("GET", "/about", cookies=session_cookie("Fake-Tiger#123456"))
        self.assertEqual(resp.status, 200)
        self.assertIn("Fake-Tiger", await resp.text())
        resp = await self.client.request("GET", "/about", cookies=session_cookie("Pseudo-inventé"))
        self.assertEqual(resp.status, 200)
        self.assertNotIn("Pseudo-inventé", await resp.text())

    async def test_puzzle_pages_do_not_crash(self):
        """/puzzle, /puzzle/{variante} et /puzzle/{id} utilisaient VARIANTS sans l'importer (NameError).

        L'accès à la base est remplacé : la prod utilise pymongo (`await collection.aggregate()`),
        alors que mongomock_motor imite l'ancien pilote motor et ne le supporte pas.
        """
        fake = empty_puzzle("matatak")
        with patch("views.puzzle.next_puzzle", AsyncMock(return_value=fake)), patch(
            "views.puzzle.get_puzzle", AsyncMock(return_value=fake)
        ):
            for path in ("/puzzle", "/puzzle/matatak", "/puzzle/matatakmini", "/puzzle/abcde"):
                resp = await self.client.request("GET", path)
                self.assertEqual(resp.status, 200, path)


class JoueurAbsentTestCase(AioHTTPTestCase):
    async def get_application(self):
        return make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True)

    async def test_joueur_plus_en_memoire(self):
        """Un joueur de la partie qui n'est plus en mémoire est « déconnecté », sans exception.

        Avant la correction, `users.get()` levait NotInDbUsers dans `handle_is_user_present` et la
        WebSocket de la partie tombait à chaque reconnexion (vu en local le 21/10/2026).
        """
        from wsr import handle_is_user_present

        ws = AsyncMock()
        game = type("G", (), {"id": "abcdefgh"})()
        with patch("wsr.ws_send_json", new=AsyncMock()) as envoi:
            await handle_is_user_present(
                ws, get_app_state(self.app).users, "Parti-Panda#000001", game
            )
        envoi.assert_awaited_once_with(
            ws, {"type": "user_disconnected", "username": "Parti-Panda#000001"}
        )


class PartieContreIATestCase(AioHTTPTestCase):
    async def get_application(self):
        return make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True)

    async def tearDownAsync(self):
        app_state = get_app_state(self.app)
        for user in app_state.users.values():
            if user.anon and not reserved(user.username):
                user.remove_task.cancel()
        await self.client.close()

    async def test_couleur_random_garde_le_joueur(self):
        """Une couleur inconnue (« random ») ne doit pas faire jouer l'IA contre elle-même.

        Avant la correction, le bouton « Jouer contre l'IA » de fin du tutoriel envoyait
        `color: "random"` : `new_game` ne reconnaissait que "w"/"b"/"r" et mettait l'IA des
        deux côtés (partie « Level 1 » contre « Level 1 », impossible à jouer).
        """
        from user import User
        from wsl import handle_create_ai_challenge

        app_state = get_app_state(self.app)
        joueur = User(app_state, username="Tuto-Panda#000001", anon=True)
        app_state.users[joueur.username] = joueur
        data = {
            "variant": "matatakmini", "fen": "", "color": "random", "minutes": 0, "increment": 0,
            "byoyomiPeriod": 0, "rated": False, "level": 1, "chess960": False, "rm": False,
            "draft": False, "boost": 0,
        }
        with patch("wsl.ws_send_json", new=AsyncMock()) as envoi:
            await handle_create_ai_challenge(app_state, AsyncMock(), joueur, data)
        reponse = envoi.await_args.args[1]
        self.assertEqual(reponse["type"], "new_game")
        self.assertEqual(
            sorted([reponse["wplayer"], reponse["bplayer"]]), ["Level 1", "Tuto-Panda#000001"]
        )

    async def test_revanche_ia_apres_purge_du_fantome(self):
        """« Rejouer » / « Niveau suivant » doivent relancer une partie contre l'IA même si le
        joueur fantôme « Level N » a été purgé de la mémoire.

        Le fantôme n'est jamais connecté : User.remove() l'efface après ANON_TIMEOUT (10 min en
        prod, quelques secondes sur un serveur local). Avant la correction, handle_rematch le
        cherchait dans app_state.users, recevait NONE_USER et envoyait une offre de revanche à
        un humain inexistant : rien ne se passait.
        """
        from user import User
        from wsl import handle_create_ai_challenge
        from wsr import handle_rematch

        app_state = get_app_state(self.app)
        joueur = User(app_state, username="Revanche-Koala#000002", anon=True)
        app_state.users[joueur.username] = joueur
        data = {
            "variant": "matatakmini", "fen": "", "color": "w", "minutes": 0, "increment": 0,
            "byoyomiPeriod": 0, "rated": False, "level": 3, "chess960": False, "rm": False,
            "draft": False, "boost": 0,
        }
        with patch("wsl.ws_send_json", new=AsyncMock()) as envoi:
            await handle_create_ai_challenge(app_state, AsyncMock(), joueur, data)
        game = app_state.games[envoi.await_args.args[1]["gameId"]]
        app_state.users["Level 3"].remove_task.cancel()
        del app_state.users["Level 3"]  # comme après la purge

        with patch("wsl.ws_send_json", new=AsyncMock()) as envoi:
            await handle_rematch(app_state, AsyncMock(), joueur, {"handicap": False, "level": 4}, game)
        reponse = envoi.await_args.args[1]
        self.assertEqual(reponse["type"], "new_game")
        self.assertIn("Level 4", (reponse["wplayer"], reponse["bplayer"]))

    async def test_solo_mini_equipe_du_roi(self):
        """Solo sur le Mini : l'ordinateur joue l'équipe de la Saison du Roi de son palier
        (niveau 3 = AZAR, équipe Été : TAMTAM « f » et KRAK « x »)."""
        from user import User
        from wsl import handle_create_ai_challenge

        app_state = get_app_state(self.app)
        joueur = User(app_state, username="Solo-Koala#000003", anon=True)
        app_state.users[joueur.username] = joueur
        for niveau, pion, champion in ((3, "f", "x"), (8, "b", "i"), (12, "l", "w"), (18, "m", "c")):
            data = {
                "variant": "matatakmini", "fen": "", "color": "r", "minutes": 0, "increment": 0,
                "byoyomiPeriod": 0, "rated": False, "level": niveau, "chess960": False,
                "rm": False, "draft": False, "boost": 0,
            }
            with patch("wsl.ws_send_json", new=AsyncMock()) as envoi:
                await handle_create_ai_challenge(app_state, AsyncMock(), joueur, data)
            reponse = envoi.await_args.args[1]
            game = app_state.games[reponse["gameId"]]
            placement = game.initial_fen.split(" ")[0]
            ia_blancs = reponse["wplayer"] == f"Level {niveau}"
            pieces_ia = {c for c in placement if (c.isupper() if ia_blancs else c.islower()) and c.lower() != "k"}
            self.assertEqual(pieces_ia, {pion.upper(), champion.upper()} if ia_blancs else {pion, champion}, niveau)
            joueur.game_in_progress = None


class CoupDePouceTestCase(AioHTTPTestCase):
    async def get_application(self):
        return make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True)

    async def test_crans_du_livret(self):
        """Coup de pouce (livret) : +1 Champion aidé, +2 ses Pions, +3 Pions adverses −1 étoile,
        +4 Champion adverse −1 ; un cran impossible est sauté ; la position reste légale."""
        import pyffish as sf
        from fairy.fairy_board import FairyBoard as F

        force = F.FORCE
        etoiles = lambda groupe: [force[c.lower()][1] for c in groupe if c.lower() != "k"]
        equipes = ("kw", "ll", "SS", "IK")  # Noirs : FRANK + BONGO ; Blancs : SALSA (2★) + ROKK (3★)
        for crans in range(5):
            bc, bp, wp, wc = F.add_boost(True, crans, *equipes)
            self.assertEqual(etoiles(wc), [4 if crans >= 1 else 3], crans)
            self.assertEqual(etoiles(wp), [3, 3] if crans >= 2 else [2, 2], crans)
            self.assertEqual(etoiles(bp), [2, 2] if crans >= 3 else [3, 3], crans)
            self.assertEqual(etoiles(bc), [2] if crans >= 4 else [3], crans)
            fen = F.matatak_placement_start(bc, bp, wp, wc, True)
            self.assertEqual(sf.validate_fen(fen, "matatakmini"), 1, fen)
        # Négatif : on aide les Noirs
        bc, bp, wp, wc = F.add_boost(True, -1, *equipes)
        self.assertEqual(etoiles(bc), [4])
        self.assertEqual((wp, wc), ("SS", "IK"))

    async def test_jouer_solo_mene_a_la_partie(self):
        """/jouer/solo (fin du tutoriel, « Première partie ») crée la partie Solo et y mène
        directement, sans repasser par /jouer."""
        resp = await self.client.request("GET", "/jouer/solo?variant=matatakmini&level=1", allow_redirects=False)
        self.assertEqual(resp.status, 302)
        game_id = resp.headers["Location"].lstrip("/")
        game = get_app_state(self.app).games[game_id]
        self.assertEqual(game.variant, "matatakmini")
        self.assertIn("Level 1", (game.wplayer.username, game.bplayer.username))


class SecuriteWebSocketTestCase(AioHTTPTestCase):
    """AUDIT P1-2 : la WebSocket de partie acceptait tout message de n'importe quel visiteur."""

    async def get_application(self):
        return make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True)

    async def tearDownAsync(self):
        app_state = get_app_state(self.app)
        for user in app_state.users.values():
            if user.anon and not reserved(user.username):
                user.remove_task.cancel()
        await self.client.close()

    async def partie_solo(self, nom, couleur, niveau=1):
        from user import User
        from wsl import handle_create_ai_challenge

        app_state = get_app_state(self.app)
        joueur = User(app_state, username=nom, anon=True)
        app_state.users[joueur.username] = joueur
        data = {
            "variant": "matatakmini", "fen": "", "color": couleur, "minutes": 0, "increment": 0,
            "byoyomiPeriod": 0, "rated": False, "level": niveau, "chess960": False, "rm": False,
            "draft": False, "boost": 0,
        }
        with patch("wsl.ws_send_json", new=AsyncMock()) as envoi:
            await handle_create_ai_challenge(app_state, AsyncMock(), joueur, data)
        return joueur, app_state.games[envoi.await_args.args[1]["gameId"]]

    async def test_un_spectateur_ne_peut_ni_abandonner_ni_jouer(self):
        from user import User
        from wsr import process_message

        app_state = get_app_state(self.app)
        _, game = await self.partie_solo("Joueur-Lion#000010", "w")
        intrus = User(app_state, username="Intrus-Rat#000011", anon=True)
        app_state.users[intrus.username] = intrus
        coup = game.board.legal_moves()[0]
        for message in (
            {"type": "resign", "gameId": game.id},
            {"type": "abandon", "gameId": game.id},
            {"type": "move", "gameId": game.id, "move": coup, "clocks": [0, 0], "ply": 1},
            {"type": "delete", "gameId": game.id},
        ):
            await process_message(app_state, intrus, AsyncMock(), message, game)
        self.assertEqual(game.result, "*")
        self.assertEqual(game.board.ply, 0)

    async def test_le_joueur_joue_pour_l_ordinateur_du_navigateur(self):
        """Contre l'IA locale (titre LIA), le navigateur du joueur envoie aussi les coups de l'IA :
        le contrôle ne doit pas casser les parties en Solo."""
        from wsr import message_autorise

        joueur, game = await self.partie_solo("Joueur-Ours#000012", "b")
        self.assertEqual(game.wplayer.title, "LIA")  # l'ordinateur a les Blancs, il commence
        coup = {"type": "move", "gameId": game.id}
        self.assertTrue(message_autorise(joueur, coup, game))
        self.assertTrue(message_autorise(joueur, {"type": "resign", "gameId": game.id}, game))
        # Un message pour une autre partie que celle de la WebSocket est refusé
        self.assertFalse(message_autorise(joueur, {"type": "resign", "gameId": "autre"}, game))

    def test_entre_humains_seul_le_joueur_au_trait_joue(self):
        from types import SimpleNamespace as N
        from fairy import WHITE
        from wsr import message_autorise

        blanc = N(username="Blanc-Chat#000013", title="", bot=False)
        noir = N(username="Noir-Chien#000014", title="", bot=False)
        game = N(
            id="abcdefgh", wplayer=blanc, bplayer=noir, board=N(color=WHITE),
            server_variant=N(two_boards=False), draft=None,
        )
        coup = {"type": "move", "gameId": game.id}
        self.assertTrue(message_autorise(blanc, coup, game))
        self.assertFalse(message_autorise(noir, coup, game))
        # Reprendre un coup : seulement contre un ordinateur
        self.assertFalse(message_autorise(blanc, {"type": "takeback", "gameId": game.id}, game))

    def test_websocket_ouverte_par_un_autre_site(self):
        from aiohttp.test_utils import make_mocked_request
        from websocket_utils import origine_autorisee

        def requete(origine, hote="127.0.0.1:8080"):
            entetes = {"Host": hote}
            if origine is not None:
                entetes["Origin"] = origine
            return make_mocked_request("GET", "/wsr/abcdefgh", headers=entetes)

        with patch("settings.URI", "https://matatak.org"):
            self.assertTrue(origine_autorisee(requete("https://matatak.org")))
            self.assertTrue(origine_autorisee(requete("https://www.matatak.org")))
            self.assertTrue(origine_autorisee(requete("http://192.168.1.20:8099", "192.168.1.20:8099")))
            self.assertTrue(origine_autorisee(requete(None)))
            self.assertFalse(origine_autorisee(requete("https://site-pirate.example")))

    async def test_niveau_et_coup_de_pouce_bornes(self):
        """Le niveau nomme un fantôme « Level N » gardé en mémoire : borné à 1..20 (AUDIT P2-3).
        Un Coup de pouce hors de −4..4 faisait échouer la création de la partie (AUDIT P2-2)."""
        from seek import Seek

        app_state = get_app_state(self.app)
        for i, (niveau, attendu) in enumerate(((999, "Level 20"), (-3, "Level 1"), ("abc", "Level 1"))):
            _, game = await self.partie_solo(f"Joueur-Pie#00002{i}", "w", niveau)
            self.assertIn(attendu, (game.wplayer.username, game.bplayer.username))
        noms = [nom for nom in app_state.users if nom.startswith("Level ")]
        self.assertEqual(sorted(noms), ["Level 1", "Level 20"])
        createur = app_state.users["Joueur-Pie#000020"]
        self.assertEqual(Seek("s1", createur, "matatakmini", boost=99).boost, 4)
        self.assertEqual(Seek("s2", createur, "matatakmini", boost="x").boost, 0)

    async def test_import_reserve_aux_comptes(self):
        resp = await self.client.post("/import", data={"Variant": "matatakmini", "username": "Quelqu-un"})
        self.assertEqual(resp.status, 403)

    async def test_recherche_de_pseudos_sans_expression_reguliere(self):
        app_state = get_app_state(self.app)
        await app_state.db.user.insert_one({"_id": "Hugosabb", "title": ""})
        resp = await self.client.get("/api/names?p=.*.*")
        self.assertEqual(await resp.json(), [])
        resp = await self.client.get("/api/names?p=hug")
        self.assertEqual(await resp.json(), [["Hugosabb", ""]])


class DraftTestCase(AioHTTPTestCase):
    """Draft en ligne refait le 22/10/2026 (server/draft.py), étapes du livret et choix d'Hugo."""

    async def get_application(self):
        return make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True)

    async def tearDownAsync(self):
        app_state = get_app_state(self.app)
        for user in app_state.users.values():
            if user.anon and not reserved(user.username):
                user.remove_task.cancel()
        await self.client.close()

    def draft_complet(self, variant):
        from draft import Draft, FINI

        d = Draft(variant)
        d.former("white", [[0, 1, 2], [3, 4, 5]])
        d.choisir("black", 1)
        d.former("black", [[0, 1, 6], [2, 3, 7]])
        d.choisir("white", 0)
        self.assertEqual(d.equipes["black"]["pions"], [d.pions[i] for i in (3, 4, 5)])
        self.assertEqual(d.equipes["white"]["pions"], [d.pions[i] for i in (0, 1, 2)])
        self.assertEqual(d.equipes["white"]["roi"], d.rois[0])
        self.assertEqual(d.equipes["black"]["roi"], d.rois[1])
        blanc = d.equipes["white"]
        d.placer("white", list(reversed(blanc["pions"])), [blanc["arriere"][2], "k", blanc["arriere"][0]])
        noir = d.equipes["black"]
        d.placer("black", noir["pions"], noir["arriere"])
        self.assertEqual(d.phase, FINI)
        return d

    def test_draft_complet_donne_une_position_legale(self):
        import pyffish as sf
        from draft import tourner

        for variant, roi_blanc, roi_noir in (("matatak", "e1", "d8"), ("matatakmini", "c1", "b8")):
            d = self.draft_complet(variant)
            fen = d.fen()
            self.assertEqual(sf.validate_fen(fen, variant), 1, fen)
            self.assertEqual(sf.validate_fen(tourner(fen), variant), 1, tourner(fen))
            self.assertGreater(len(sf.legal_moves(variant, fen, [])), 0)
            # Roi sur sa case de départ (couronne du plateau)
            rangees = fen.split(" ")[0].split("/")

            def case(c):
                rangee = rangees[8 - int(c[1])]
                colonne = 0
                for ch in rangee:
                    if ch.isdigit():
                        colonne += int(ch)
                    else:
                        if colonne == "abcdefgh".index(c[0]):
                            return ch
                        colonne += 1
                return None

            self.assertEqual(case(roi_blanc), "K", fen)
            self.assertEqual(case(roi_noir), "k", fen)

    def test_le_navigateur_ne_peut_pas_tricher(self):
        from draft import Draft, DraftErreur

        d = Draft("matatakmini")
        with self.assertRaises(DraftErreur):
            d.former("black", [[0, 1, 2], [3, 4, 5]])  # pas son tour
        with self.assertRaises(DraftErreur):
            d.former("white", [[0, 1, 2], [2, 3, 4]])  # carte en double
        with self.assertRaises(DraftErreur):
            d.former("white", [[0, 1], [3, 4, 5]])  # groupe incomplet
        d.former("white", [[0, 1, 2], [3, 4, 5]])
        d.choisir("black", 0)
        with self.assertRaises(DraftErreur):
            d.former("black", [[0, 1, 2], [3, 6, 7]])  # un groupe sans Roi, l'autre avec deux
        d.former("black", [[0, 1, 6], [2, 3, 7]])
        d.choisir("white", 1)
        equipe = d.equipes["white"]
        with self.assertRaises(DraftErreur):
            d.placer("white", equipe["pions"], ["k", equipe["arriere"][0], equipe["arriere"][2]])  # Roi déplacé
        with self.assertRaises(DraftErreur):
            d.placer("white", ["a", "a", "a"], equipe["arriere"])  # Pions inventés

    async def partie_draft(self, nom, couleur):
        from user import User
        from wsl import handle_create_ai_challenge

        app_state = get_app_state(self.app)
        joueur = User(app_state, username=nom, anon=True)
        app_state.users[joueur.username] = joueur
        data = {
            "variant": "matatakmini", "fen": "", "color": couleur, "minutes": 0, "increment": 0,
            "byoyomiPeriod": 0, "rated": False, "level": 2, "chess960": False, "rm": False,
            "draft": True, "boost": 0,
        }
        with patch("wsl.ws_send_json", new=AsyncMock()) as envoi:
            await handle_create_ai_challenge(app_state, AsyncMock(), joueur, data)
        return joueur, app_state.games[envoi.await_args.args[1]["gameId"]]

    async def test_draft_contre_l_ordinateur(self):
        from draft import FINI, PIONS_CHOISIR, CHAMPIONS_CHOISIR, PLACEMENT
        from wsr import process_message, handle_board

        app_state = get_app_state(self.app)
        # Le joueur a les Noirs : l'ordinateur (Blancs) forme ses groupes dès la connexion
        joueur, game = await self.partie_draft("Draft-Ours#000030", "b")
        self.assertIsNotNone(game.draft)
        await handle_board(AsyncMock(), joueur, game)
        self.assertEqual(game.draft.phase, PIONS_CHOISIR)
        # Un coup est refusé tant que le Draft n'est pas fini
        coup = game.board.legal_moves()[0]
        await process_message(app_state, joueur, AsyncMock(), {"type": "move", "gameId": game.id, "move": coup, "clocks": [0, 0], "ply": 1}, game)
        self.assertEqual(game.board.ply, 0)
        ws = AsyncMock()
        await process_message(app_state, joueur, ws, {"type": "draft", "gameId": game.id, "action": "choisir", "groupe": 0}, game)
        # Le joueur forme les groupes de Champions, l'ordinateur choisit puis se place
        await process_message(app_state, joueur, ws, {"type": "draft", "gameId": game.id, "action": "former", "groupes": [[0, 1, 6], [2, 3, 7]]}, game)
        self.assertEqual(game.draft.phase, PLACEMENT)
        self.assertTrue(game.draft.pret["white"])
        equipe = game.draft.equipes["black"]
        await process_message(app_state, joueur, ws, {"type": "draft", "gameId": game.id, "action": "placer", "pions": equipe["pions"], "arriere": equipe["arriere"]}, game)
        self.assertEqual(game.draft.phase, FINI)
        self.assertEqual(game.initial_fen, game.draft.fen())
        self.assertEqual(game.rois, {"white": game.draft.equipes["white"]["roi"], "black": equipe["roi"]})
        self.assertIs(game.stopwatch.board, game.board)

    async def test_revanche_garde_les_equipes(self):
        from draft import tourner
        from wsr import handle_rematch, process_message, handle_board

        app_state = get_app_state(self.app)
        joueur, game = await self.partie_draft("Draft-Lynx#000031", "w")
        await handle_board(AsyncMock(), joueur, game)
        ws = AsyncMock()
        envoyer = lambda **m: process_message(app_state, joueur, ws, {"type": "draft", "gameId": game.id, **m}, game)
        await envoyer(action="former", groupes=[[0, 1, 2], [3, 4, 5]])
        await envoyer(action="choisir", groupe=0)
        equipe = game.draft.equipes["white"]
        await envoyer(action="placer", pions=equipe["pions"], arriere=equipe["arriere"])
        fen, rois = game.initial_fen, game.rois

        with patch("wsl.ws_send_json", new=AsyncMock()) as envoi:
            await handle_rematch(app_state, AsyncMock(), joueur, {"handicap": False}, game)
        revanche = app_state.games[envoi.await_args.args[1]["gameId"]]
        self.assertIsNone(revanche.draft)
        self.assertEqual(revanche.initial_fen, tourner(fen))
        self.assertEqual(revanche.rois, {"white": rois["black"], "black": rois["white"]})
        self.assertEqual(revanche.bplayer.username, joueur.username)  # couleurs échangées

        with patch("wsl.ws_send_json", new=AsyncMock()) as envoi:
            await handle_rematch(app_state, AsyncMock(), joueur, {"handicap": False, "nouveau_draft": True}, revanche)
        nouveau = app_state.games[envoi.await_args.args[1]["gameId"]]
        self.assertIsNotNone(nouveau.draft)

    async def test_draft_entre_amis(self):
        """Le navigateur envoie « draft » : la création d'invitation lisait « isDraft » et ignorait
        le Draft entre amis (seul le Solo passait)."""
        from seek import create_seek
        from user import User

        app_state = get_app_state(self.app)
        joueur = User(app_state, username="Draft-Pie#000032", anon=True)
        app_state.users[joueur.username] = joueur
        data = {
            "variant": "matatakmini", "fen": "", "color": "r", "minutes": 5, "increment": 3,
            "byoyomiPeriod": 0, "day": 0, "rated": False, "chess960": False, "draft": True,
            "boost": 0, "target": "", "rrmin": -1000, "rrmax": 1000,
        }
        seek = await create_seek(app_state.db, app_state.invites, app_state.seeks, joueur, data)
        self.assertTrue(seek.isDraft)


class RedemarrageTestCase(AioHTTPTestCase):
    """AUDIT P1-7 : une partie Solo ou entre invités survit au redémarrage du serveur."""

    async def get_application(self):
        return make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True)

    async def tearDownAsync(self):
        app_state = get_app_state(self.app)
        for user in app_state.users.values():
            if user.anon and not reserved(user.username) and user.remove_task:
                user.remove_task.cancel()
        await self.client.close()

    async def test_partie_solo_rechargee_apres_redemarrage(self):
        from user import User
        from utils import load_game
        from wsl import handle_create_ai_challenge
        from wsr import process_message

        app_state = get_app_state(self.app)
        joueur = User(app_state, username="Brave-Koala#000040", anon=True)
        app_state.users[joueur.username] = joueur
        data = {
            "variant": "matatakmini", "fen": "", "color": "w", "minutes": 0, "increment": 0,
            "byoyomiPeriod": 0, "rated": False, "level": 4, "chess960": False, "rm": False,
            "draft": False, "boost": 0,
        }
        with patch("wsl.ws_send_json", new=AsyncMock()) as envoi:
            await handle_create_ai_challenge(app_state, AsyncMock(), joueur, data)
        game = app_state.games[envoi.await_args.args[1]["gameId"]]
        coup = game.board.legal_moves()[0]
        await process_message(app_state, joueur, AsyncMock(), {"type": "move", "gameId": game.id, "move": coup, "clocks": [0, 0], "ply": 1}, game)
        self.assertEqual(game.board.ply, 1)

        # Redémarrage : plus rien en mémoire, ni la partie, ni l'invité, ni l'ordinateur
        game_id = game.id
        del app_state.games[game_id]
        for nom in (joueur.username, "Level 4"):
            app_state.users[nom].remove_task.cancel()
            del app_state.users[nom]

        rechargee = await load_game(app_state, game_id)
        self.assertIsNotNone(rechargee)
        self.assertEqual(rechargee.wplayer.username, "Brave-Koala#000040")
        self.assertEqual(rechargee.bplayer.title, "LIA")
        self.assertEqual(rechargee.board.ply, 1)

        # L'invité revient avec son cookie : même nom, il retrouve sa partie
        resp = await self.client.request("GET", "/" + game_id, cookies=session_cookie("Brave-Koala#000040"))
        self.assertEqual(resp.status, 200)
        self.assertIn("Brave-Koala", await resp.text())
