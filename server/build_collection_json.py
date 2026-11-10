"""Construit les données de la page /collection à partir du dépôt privé matatak-jeu (livret et vidéos).

    python3 server/build_collection_json.py [chemin/vers/jeu] [--sans-images]

Sorties :
- static/data/collection.json : les 42 Personnages (nom, espèce, rang, Saison, boîte, Force, réplique,
  déplacements calculés depuis variants.ini par jeu/outils/deplacements.py ; numéro et
  équivalent aux échecs du tableau d'Hugo `sources/donnees/characters-hugo.csv`, famille de
  `donnees/lore.csv`), rangés dans l'ordre du tableau ;
- <jeu>/assets/site/images/background/collection/{sombre,clair}{,-720}/NN-nom.webp : les cartes réduites
  en 360 et 720 px (illustrations sous droits réservés : rangées dans le dépôt privé, puis copiées dans
  static/ par outils/assets-depuis-jeu.sh, ici comme sur le serveur).

Nécessite Pillow (pour les images).
"""

import csv
import json
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
JEU = Path(ARGS[0]) if ARGS else RACINE.parent / "jeu"
SANS_IMAGES = "--sans-images" in sys.argv
TAILLES = {"": 360, "-720": 720}  # suffixe du dossier -> px ; le navigateur choisit (srcset)

SAISONS = {"printemps": "Printemps", "ete": "Été", "automne": "Automne", "hiver": "Hiver"}
# Colonne « Chess » du tableau d'Hugo -> filtre de la Collection (les autres : pas d'équivalent exact)
ECHECS = {
    "King": "roi",
    "Queen": "dame",
    "Rook": "tour",
    "Bishop": "fou",
    "Knight": "cavalier",
    "Pawn": "pion",
}


def tableau_d_hugo():
    """{NOM: (numéro, équivalent aux échecs ou None)} depuis l'export CSV de l'Excel des Personnages."""
    lignes = list(csv.reader((JEU / "sources/donnees/characters-hugo.csv").open(encoding="utf-8")))
    entete = lignes[2]
    i_id, i_nom, i_echecs = entete.index("ID"), entete.index("Name"), entete.index("Chess")
    tableau = {}
    for ligne in lignes[3:]:
        nom = ligne[i_nom].strip().upper()
        if ligne[i_id].isdigit() and nom and nom not in tableau:
            tableau[nom] = (int(ligne[i_id]), ECHECS.get(ligne[i_echecs].strip()))
    return tableau


def familles():
    with (JEU / "donnees/lore.csv").open(encoding="utf-8-sig") as f:
        return {
            ligne["nom"].upper(): ligne["famille"] for ligne in csv.DictReader(f, delimiter=";")
        }


def main():
    cartes = json.loads((JEU / "assets/cartes/cartes.json").read_text(encoding="utf-8"))
    deplacements = json.loads((JEU / "assets/data/deplacements.json").read_text(encoding="utf-8"))

    tableau = tableau_d_hugo()
    famille = familles()
    personnages = []
    for c in cartes:
        espece = deplacements[c["espece"]]
        nom_fichier = Path(c["fichier"]).stem + ".webp"
        personnages.append(
            {
                "nom": c["nom"],
                "espece": c["espece"],
                "rang": c["rang"],
                "saison": c["saison"],
                "boite": "base" if c["boite"] == "base" else "extension",
                "etoiles": c["etoiles"],
                "replique": c.get("lore") or "",
                "numero": tableau[c["nom"].upper()][0],
                "echecs": tableau[c["nom"].upper()][1],
                "famille": famille[c["nom"].upper()],
                "image": nom_fichier,
                "cases": [
                    {k: m[k] for k in ("dx", "dy", "genre", "saut", "repete", "illimite")}
                    for m in espece["cases"]
                ],
            }
        )
    personnages.sort(key=lambda p: p["numero"])

    sortie = RACINE / "static/data/collection.json"
    sortie.parent.mkdir(parents=True, exist_ok=True)
    sortie.write_text(
        json.dumps({"saisons": SAISONS, "personnages": personnages}, ensure_ascii=False, indent=1)
        + "\n",
        encoding="utf-8",
    )
    print(f"{len(personnages)} Personnages -> {sortie.relative_to(RACINE)}")
    if SANS_IMAGES:
        return

    from PIL import Image

    for face, dossier in (("sombre", "recto"), ("clair", "verso")):
        for suffixe, taille in TAILLES.items():
            dest = JEU / "assets/site/images/background/collection" / (face + suffixe)
            dest.mkdir(parents=True, exist_ok=True)
            for c in cartes:
                im = Image.open(JEU / "assets/cartes" / dossier / c["fichier"]).convert("RGB")
                im.resize((taille, taille), Image.LANCZOS).save(
                    dest / (Path(c["fichier"]).stem + ".webp"), quality=82, method=6
                )
    print(
        "images -> <jeu>/assets/site/images/background/collection/ ; puis : bash outils/assets-depuis-jeu.sh"
    )


if __name__ == "__main__":
    main()
