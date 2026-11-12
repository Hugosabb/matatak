#!/usr/bin/env bash
# Prépare le Codespace, une seule fois à sa création : outils, dépôt privé voisin, paquets, illustrations.
set -uo pipefail
cd "$(dirname "$0")/.."
PRIVE="../matatak-site-prive"

sudo apt-get update -qq && sudo apt-get install -y -qq lsof iproute2 >/dev/null
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"

if [ ! -d "$PRIVE/.git" ]; then
    git clone https://github.com/Hugosabb/matatak-site-prive "$PRIVE" \
        || { echo "⚠️ Dépôt privé non cloné : le Codespace n'a pas reçu l'accès à matatak-site-prive."; exit 0; }
fi
bash "$PRIVE/outils/demarrage-cloud.sh"
# Bibliothèques système de Chromium, pour les parcours de test (facultatif).
"$HOME/.cache/matatak-venv/bin/playwright" install-deps chromium >/dev/null 2>&1 || true
