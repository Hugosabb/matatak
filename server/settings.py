from __future__ import annotations

import base64
import hashlib
import os
import json
import string
from pathlib import Path

LOCALHOST = "http://127.0.0.1:8080"
URI = os.getenv("URI", LOCALHOST)

PROD = os.getenv("PROD") == "true"
DEV = not PROD

# lichess.org API token created by the pychess-monitor BOT user
PYCHESS_MONITOR_TOKEN = os.getenv("PYCHESS_MONITOR_TOKEN")

# lichess.org API token created by a team leader of
# https://lichess.org/team/pychess-tournaments
LICHESS_API_TOKEN = os.getenv("LICHESS_API_TOKEN")

# secret_key for session encryption
# key must be 32 url-safe base64-encoded bytes
FERNET_KEY = os.getenv("FERNET_KEY", string.ascii_letters[:42] + "_=")
SECRET_KEY = base64.urlsafe_b64decode(FERNET_KEY)
MAX_AGE = 3600 * 24 * 365

MONGO_HOST = os.getenv("MONGO_HOST", "mongodb://127.0.0.1:27017")
MONGO_DB_NAME = "pychess-variants"

BOT_TOKENS = json.loads(os.getenv("BOT_TOKENS", "{}"))
FISHNET_KEYS = json.loads(os.getenv("FISHNET_KEYS", "{}"))

ADMINS = os.getenv("ADMINS", "").split(",")
TOURNAMENT_DIRECTORS = os.getenv("TOURNAMENT_DIRECTORS", "").split(",")

STATIC_ROOT = os.getenv("STATIC_ROOT", "/static")

TWITCH_CLIENT_ID = os.getenv("TWITCH_CLIENT_ID", "")
TWITCH_CLIENT_SECRET = os.getenv("TWITCH_CLIENT_SECRET", "")

DISCORD_TOKEN = os.getenv("DISCORD_TOKEN", "")

ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS", "https://www.matatak.org,https://cdn.jsdelivr.net"
).split(",")


def compute_asset_version(static_dir: Path | None = None) -> str:
    """Empreinte courte du contenu des fichiers de style et de script.

    Elle change à chaque modification de ces fichiers, donc à chaque déploiement : elle sert de
    numéro de version aux adresses (`?v=...`) et au service worker, pour que navigateurs et PWA
    récupèrent toujours les fichiers à jour sans intervention manuelle.
    """
    if static_dir is None:
        static_dir = Path(__file__).resolve().parent.parent / "static"
    digest = hashlib.sha256()
    patterns = ("*.css", "*.js", "js/*.js", "piece/mono/*.css")
    files = sorted({f for pattern in patterns for f in static_dir.glob(pattern)})
    for f in files:
        if f.name == "service-worker.js":  # servi à part, avec la version injectée
            continue
        digest.update(f.relative_to(static_dir).as_posix().encode())
        digest.update(f.read_bytes())
    return digest.hexdigest()[:10]


# Variable d'environnement SOURCE_VERSION : prioritaire si elle est définie, sinon empreinte calculée.
ASSET_VERSION = os.getenv("SOURCE_VERSION") or compute_asset_version()
SOURCE_VERSION = "?v=%s" % ASSET_VERSION


def static_url(static_file_path):
    url = "%s/%s" % (STATIC_ROOT, static_file_path)
    if static_file_path.endswith((".css", ".js")):
        url += SOURCE_VERSION
    return url
