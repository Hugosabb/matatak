import base64
import hashlib
import secrets
from urllib.parse import urlencode

import aiohttp
import aiohttp_session
from aiohttp import web

from broadcast import round_broadcast
from bots_classes import est_bot_classe
from const import STARTED, reserved
from oauth_config import fournisseurs_actifs, oauth_config
from settings import DEV, URI
from pychess_global_app_state_utils import get_app_state
from websocket_utils import ws_send_json
from logger import log


async def oauth(request):
    """Get oauth token with PKCE"""

    provider = request.match_info.get("provider")
    if provider not in fournisseurs_actifs():
        return web.HTTPFound("/connexion")
    redirect_uri = URI + "/oauth/%s" % provider

    config = oauth_config[provider]

    client_id = config["client_id"]
    client_secret = config["client_secret"]

    oauth_authorize_url = config["oauth_authorize_url"]
    oauth_token_url = config["oauth_token_url"]
    scope = config["scope"]

    session = await aiohttp_session.get_session(request)
    code = request.rel_url.query.get("code")

    if code is None:
        code_verifier = secrets.token_urlsafe(64)
        session["oauth_code_verifier"] = code_verifier
        code_challenge = get_code_challenge(code_verifier)
        # state tiré au hasard et gardé en session (avant : le client_secret, visible dans l'adresse)
        state = secrets.token_urlsafe(24)
        session["oauth_state"] = state

        params = {
            "state": state,
            "client_id": client_id,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "scope": scope,
        }
        if provider == "google":
            # Appareil partagé en famille : toujours demander quel compte utiliser
            params["prompt"] = "select_account"
        return web.HTTPFound(oauth_authorize_url + "?" + urlencode(params))
    else:
        state = request.rel_url.query.get("state")
        attendu = session.pop("oauth_state", None)
        if attendu is None or state is None or not secrets.compare_digest(state, attendu):
            log.error("OAuth state value mismatch for provider '%s'", provider)
            return web.HTTPFound("/jouer")

        if "oauth_code_verifier" not in session:
            log.error("No oauth_code_verifier in session")
            return web.HTTPFound("/jouer")

        data = {
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": session["oauth_code_verifier"],
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
        }

        # print(oauth_token_url)
        # print(data)
        # print("----------------")

        headers = {"Content-Type": "application/x-www-form-urlencoded"}

        async with aiohttp.ClientSession() as client_session:
            async with client_session.post(oauth_token_url, data=data, headers=headers) as resp:
                data = await resp.json()
                # print("OAUTH_DATA=", data)
                token = data.get("access_token")
                if token is not None:
                    session["token"] = token
                    return web.HTTPFound("/login/%s" % provider)
                else:
                    log.error("Failed to get OAuth token for provider '%s'", provider)
                    return web.HTTPFound("/jouer")


async def login(request):
    session = await aiohttp_session.get_session(request)

    provider = request.match_info.get("provider")
    redirect_path = "/oauth/%s" % provider

    if provider not in fournisseurs_actifs():
        return web.HTTPFound("/connexion")

    if "token" not in session:
        return web.HTTPFound(redirect_path)

    config = oauth_config[provider]
    account_api_url = config["account_api_url"]

    user_data = await get_user_data(account_api_url, session["token"])

    del session["token"]

    # Google (OpenID) : identifiant dans « sub », pas de pseudo ; on ne propose pas le vrai prénom
    # comme pseudo (public jeune, docs/RGPD.md)
    _id = user_data.get("id") or user_data.get("sub")
    if not _id:
        log.error("No account id from provider '%s'", provider)
        return web.HTTPFound("/connexion")
    username = user_data.get("username", "" if provider == "google" else _id)
    title = user_data.get("title", "")
    closed = user_data.get("closed", "")
    tosViolation = user_data.get("tosViolation", "")

    if reserved(username) or est_bot_classe(username):
        log.error("User %s tried to log in.", username)
        return web.HTTPFound("/jouer")

    elif (not DEV) and title == "BOT":
        log.error("BOT user %s tried to log in.", username)
        return web.HTTPFound("/jouer")

    elif tosViolation == "true":
        log.error("tosViolation user %s tried to log in.", username)
        return web.HTTPFound("/jouer")

    elif closed == "true":
        log.error("closed user %s tried to log in.", username)
        return web.HTTPFound("/jouer")

    log.info("+++ authenticated user: %s", username)
    app_state = get_app_state(request.app)
    users = app_state.users

    # For other OAuth providers, check if user needs to choose a username
    existing_user = await app_state.db.user.find_one({"oauth_id": _id, "oauth_provider": provider})
    if existing_user:
        # User exists with this OAuth ID, use their existing username
        if not existing_user.get("enabled", True):
            log.info("Closed account %s tried to log in.", username)

            prev_session_user = session.get("user_name")
            prev_user = await users.get(prev_session_user)
            if prev_user is not None:
                # todo: is consistency with app_state.lobby.lobbysockets lost here?
                #       also don't we want to close all these sockets - lobby, tournament and game?
                prev_user.lobby_sockets = set()  # make it offline
                prev_user.game_sockets = {}
                prev_user.tournament_sockets = {}
                prev_user.update_online()

                session["user_name"] = prev_session_user
        else:
            session["user_name"] = existing_user["_id"]

    else:
        # New user from OAuth provider - needs to choose username
        session["oauth_id"] = _id
        session["oauth_provider"] = provider
        session["oauth_username"] = username
        session["oauth_title"] = title
        return web.HTTPFound("/select-username")

    return web.HTTPFound("/jouer")


async def get_user_data(url, token):
    async with aiohttp.ClientSession() as client_session:
        data = {"Authorization": "Bearer %s" % token}
        async with client_session.get(url, headers=data) as resp:
            data = await resp.json()
            # print("USER_DATA", data)
            return data


async def logout(request, user=None):
    if request is not None:
        # user clicked the logout
        app_state = get_app_state(request.app)
        session = await aiohttp_session.get_session(request)
        session_user = session.get("user_name")
        user = await app_state.users.get(session_user)
    else:
        # admin banned the user
        app_state = user.app_state

    if user is None:
        return web.HTTPFound("/jouer")
    response = {"type": "logout"}

    # close lobby socket
    ws_set = user.lobby_sockets
    for ws in list(ws_set):
        await ws_send_json(ws, response)

    # close tournament sockets
    for ws_set in user.tournament_sockets.values():
        for ws in list(ws_set):
            await ws_send_json(ws, response)

    # lose and close game sockets when ban() calls this from admin.py
    # TODO: this can't end game if logout came from an ongoing game
    # because its ws was already closed and removed from game_sockets
    if not user.enabled:
        for gameId in user.game_sockets:
            if gameId in app_state.games:
                game = app_state.games[gameId]
                if game.status <= STARTED:
                    response = await game.game_ended(user, "abandon")
                    await round_broadcast(game, response, full=True)

    if request is not None:
        session.invalidate()

    return web.HTTPFound("/jouer")


async def select_username(request):
    """Handle username selection for new OAuth users"""
    session = await aiohttp_session.get_session(request)

    # Check if user is in the middle of OAuth flow
    if "oauth_id" not in session:
        return web.HTTPFound("/jouer")

    # This will be handled by the client-side view
    return web.HTTPFound("/jouer")


async def check_username_availability(request):
    """API endpoint to check if username is available"""
    data = await request.json()
    username = data.get("username", "").strip()

    if not username:
        return web.json_response({"available": False, "error": "Choisissez un pseudo"})

    if len(username) < 3:
        return web.json_response(
            {"available": False, "error": "Au moins 3 caractères"}
        )

    if len(username) > 20:
        return web.json_response(
            {"available": False, "error": "20 caractères au plus"}
        )

    # Check for invalid characters
    import re

    if not re.match(r"^[a-zA-Z0-9_-]+$", username):
        return web.json_response(
            {"available": False, "error": "Lettres sans accent, chiffres, _ et - seulement"}
        )

    if reserved(username) or est_bot_classe(username):
        return web.json_response({"available": False, "error": "Ce pseudo est réservé"})

    app_state = get_app_state(request.app)
    existing_user = await app_state.db.user.find_one({"_id": username})

    if existing_user:
        return web.json_response({"available": False, "error": "Ce pseudo est déjà pris"})

    return web.json_response({"available": True})


async def confirm_username(request):
    """Confirm username selection and complete OAuth registration"""
    session = await aiohttp_session.get_session(request)

    # Check if user is in the middle of OAuth flow
    if "oauth_id" not in session:
        return web.json_response({"error": "Invalid session"}, status=400)

    data = await request.json()
    username = data.get("username", "").strip()

    # Validate username again by calling the validation logic directly
    if not username:
        return web.json_response({"error": "Choisissez un pseudo"}, status=400)

    if len(username) < 3:
        return web.json_response({"error": "Au moins 3 caractères"}, status=400)

    if len(username) > 20:
        return web.json_response({"error": "20 caractères au plus"}, status=400)

    # Check for invalid characters
    import re

    if not re.match(r"^[a-zA-Z0-9_-]+$", username):
        return web.json_response(
            {"error": "Lettres sans accent, chiffres, _ et - seulement"}, status=400
        )

    if reserved(username) or est_bot_classe(username):
        return web.json_response({"error": "Ce pseudo est réservé"}, status=400)

    app_state = get_app_state(request.app)
    existing_user = await app_state.db.user.find_one({"_id": username})

    if existing_user:
        return web.json_response({"error": "Ce pseudo est déjà pris"}, status=400)

    # Create new user with OAuth information
    oauth_id = session["oauth_id"]
    oauth_provider = session["oauth_provider"]
    title = session.get("oauth_title", "")

    try:
        result = await app_state.db.user.insert_one(
            {
                "_id": username,
                "title": title,
                "oauth_id": oauth_id,
                "oauth_provider": oauth_provider,
                "perfs": {},
                "pperfs": {},
                "enabled": True,
            }
        )
        print("db insert user result %s" % repr(result.inserted_id))

        # Set session username and clean up OAuth data
        session["user_name"] = username
        session.pop("oauth_id", None)
        session.pop("oauth_provider", None)
        session.pop("oauth_username", None)
        session.pop("oauth_title", None)

        log.info("Created new user %s via OAuth signup", username)
        return web.json_response({"success": True})

    except Exception as e:
        log.error("Failed to create user %s: %s", username, e)
        return web.json_response({"error": "Création du compte impossible"}, status=500)


def get_code_challenge(code_verifier):
    hashed = hashlib.sha256(code_verifier.encode("ascii")).digest()
    encoded = base64.urlsafe_b64encode(hashed)
    return encoded.decode("ascii")[:-1]
