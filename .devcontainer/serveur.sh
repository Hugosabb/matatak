#!/usr/bin/env bash
# Lance le serveur de test (port 8099) à chaque ouverture du Codespace. Ctrl+C l'arrête ;
# pour le relancer après une modification : bash .devcontainer/serveur.sh
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"
git -C ../matatak-site-prive pull -q --ff-only 2>/dev/null || true
if [ ! -f ../matatak-site-prive/.claude/serveur-test.sh ]; then
    echo "Dépôt privé absent : relancer bash .devcontainer/installer.sh"; exit 0
fi
exec bash ../matatak-site-prive/.claude/serveur-test.sh
