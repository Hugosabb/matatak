#!/usr/bin/env bash
# Toutes les vérifications de Matatak, à lancer avant chaque déploiement :
#   bash tests/verifier.sh            (tout : ~4 min)
#   bash tests/verifier.sh rapide     (sans les parcours dans le navigateur : ~1 min)
# Python : $PYTHON, sinon ~/.cache/matatak-venv (serveur de test), sinon python3.
# Il faut les extras de dev (pytest, mongomock-motor, playwright) et `playwright install chromium`.
set -uo pipefail
cd "$(dirname "$0")/.."

PY="${PYTHON:-$HOME/.cache/matatak-venv/bin/python}"
[ -x "$PY" ] || PY=python3
export PYTHONDONTWRITEBYTECODE=1 MONGO_HOST=mongodb://127.0.0.1:1
echecs=()

etape() { echo; echo "=== $1"; }

etape "Bundle du navigateur (esbuild)"
node esbuild.mjs dev >/dev/null || echecs+=("bundle")

etape "Types (tsc) : seules les erreurs des fichiers Matatak comptent"
nouvelles=$(./node_modules/typescript/bin/tsc --incremental false --noEmit 2>&1 \
  | grep -E "client/(draft|carteAnimee|collection|apprendre|equipe|installer|rois|editor/)" || true)
if [ -n "$nouvelles" ]; then echo "$nouvelles"; echecs+=("types"); else echo "ok"; fi

etape "Tests du navigateur (Jest)"
sortie=$(./node_modules/.bin/yarn --ignore-engines -s test 2>&1); code=$?
echo "$sortie" | grep -E "Tests:|✕" || true
[ $code -eq 0 ] || echecs+=("jest")

etape "Tests du serveur (pytest)"
PYTHONPATH=server "$PY" -m pytest -p no:cacheprovider -q tests/test_*.py 2>&1 | grep -E "^FAILED|passed|failed" \
  ; [ "${PIPESTATUS[0]}" -eq 0 ] || echecs+=("serveur")

if [ "${1:-}" != "rapide" ]; then
  etape "Parcours de joueur dans Chromium (ordinateur et téléphone)"
  PYTHONPATH=server:tests/navigateur "$PY" -m pytest -p no:cacheprovider -q tests/navigateur 2>&1 \
    | grep -E "^FAILED|^ERROR|passed|failed" ; [ "${PIPESTATUS[0]}" -eq 0 ] || echecs+=("parcours")
fi

echo
if [ ${#echecs[@]} -eq 0 ]; then
  echo "✅ Tout est vert."
else
  echo "❌ À regarder : ${echecs[*]}"
  exit 1
fi
