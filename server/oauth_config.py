import os

oauth_config = {
    "lichess": {
        "client_id": os.getenv("LICHESS_CLIENT_ID", "pychess"),
        "client_secret": os.getenv("CLIENT_SECRET", "secret"),
        "oauth_authorize_url": "https://lichess.org/oauth",
        "oauth_token_url": "https://lichess.org/api/token",
        "scope": "",
        "account_api_url": "https://lichess.org/api/account",
    },
    "lishogi": {
        "client_id": os.getenv("LISHOGI_CLIENT_ID", "pychess"),
        "client_secret": os.getenv("CLIENT_SECRET", "secret"),
        "oauth_authorize_url": "https://lishogi.org/oauth",
        "oauth_token_url": "https://lishogi.org/api/token",
        "scope": "",
        "account_api_url": "https://lishogi.org/api/account",
    },
    "google": {
        "client_id": os.getenv("GOOGLE_CLIENT_ID", "pychess"),
        "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", "secret"),
        "oauth_authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "oauth_token_url": "https://oauth2.googleapis.com/token",
        # « openid » seul : Google ne donne qu'un identifiant (sub), ni nom ni e-mail (docs/RGPD.md)
        "scope": "openid",
        "account_api_url": "https://openidconnect.googleapis.com/v1/userinfo",
    },
    "microsoft": {
        "client_id": os.getenv("MICROSOFT_CLIENT_ID", "pychess"),
        "client_secret": os.getenv("MICROSOFT_CLIENT_SECRET", "secret"),
        "oauth_authorize_url": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "oauth_token_url": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "scope": "openid",
        "account_api_url": "https://graph.microsoft.com/v1.0/me",
    },
    "facebook": {
        "client_id": os.getenv("FACEBOOK_CLIENT_ID", "pychess"),
        "client_secret": os.getenv("FACEBOOK_CLIENT_SECRET", "secret"),
        "oauth_authorize_url": "https://www.facebook.com/dialog/oauth",
        "oauth_token_url": "https://graph.facebook.com/oauth/access_token",
        "scope": "user_link",
        "account_api_url": "https://graph.facebook.com/me",
    },
    "discord": {
        "client_id": os.getenv("DISCORD_CLIENT_ID", "pychess"),
        "client_secret": os.getenv("DISCORD_CLIENT_SECRET", "secret"),
        "oauth_authorize_url": "https://discord.com/oauth2/authorize",
        "oauth_token_url": "https://discord.com/api/oauth2/token",
        "scope": "identify",
        "account_api_url": "https://discordapp.com/api/users/@me",
    },
}


def fournisseurs_actifs():
    """Connexions proposées sur /connexion : Lichess toujours (sans secret, grâce à PKCE), Google
    seulement si GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET sont définis (.env du VPS)."""
    actifs = ["lichess"]
    google = oauth_config["google"]
    if google["client_id"] != "pychess" and google["client_secret"] != "secret":
        actifs.append("google")
    return actifs
