#!/usr/bin/env bash
# Copie les illustrations du site (sous droits, absentes de ce dépôt public) depuis le dépôt privé matatak-jeu.
#   bash outils/assets-depuis-jeu.sh [chemin/vers/jeu]
# Par défaut : ../jeu (PC de Hugo et de son frère). Sur le serveur : ~/matatak-jeu (clone partiel, voir docs/JOURNAL.md).
# Source : <jeu>/assets/site/, même arborescence que static/. Rien n'est supprimé dans static/.
# Les fichiers copiés restent ignorés par git (.gitignore) ; une nouvelle image doit aussi figurer dans .dockerignore.
set -euo pipefail
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
JEU="${1:-$RACINE/../jeu}"
SOURCE="$JEU/assets/site"
if [ ! -d "$SOURCE" ]; then
  echo "Introuvable : $SOURCE (donner le chemin du dépôt matatak-jeu en argument)" >&2
  exit 1
fi
cp -a "$SOURCE/." "$RACINE/static/"
echo "$(find "$SOURCE" -type f | wc -l) fichiers copiés de $SOURCE vers static/"
