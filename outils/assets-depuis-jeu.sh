#!/usr/bin/env bash
# Copie les illustrations du site (sous droits, absentes de ce dépôt public) depuis un dépôt privé.
#   bash outils/assets-depuis-jeu.sh [chemin/vers/le/dépôt/privé]
# Par défaut, le premier dossier voisin qui existe : ../site-prive (PC de Hugo), ../matatak-site-prive (cloud),
# ../jeu (ancien rangement). Sur le serveur : donner le chemin (~/matatak-jeu, clone partiel).
# Source : <dépôt>/assets/site/, même arborescence que static/. Rien n'est supprimé dans static/.
# Les fichiers copiés restent ignorés par git (.gitignore) ; une nouvelle image doit aussi figurer dans .dockerignore.
set -euo pipefail
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
JEU="${1:-}"
if [ -z "$JEU" ]; then
  for voisin in site-prive matatak-site-prive jeu; do
    if [ -d "$RACINE/../$voisin/assets/site" ]; then JEU="$RACINE/../$voisin"; break; fi
  done
fi
SOURCE="${JEU:-$RACINE/../site-prive}/assets/site"
if [ ! -d "$SOURCE" ]; then
  echo "Introuvable : $SOURCE (donner en argument le chemin du dépôt privé qui contient assets/site)" >&2
  exit 1
fi
cp -a "$SOURCE/." "$RACINE/static/"
echo "$(find "$SOURCE" -type f | wc -l) fichiers copiés de $SOURCE vers static/"
