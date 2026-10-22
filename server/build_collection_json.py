"""Construit les données de la page /collection à partir du projet motiontak (livret et vidéos).

    python3 server/build_collection_json.py [chemin/vers/motiontak]

Sorties :
- static/data/collection.json : les 42 Personnages (nom, espèce, rang, Saison, boîte, Force, réplique,
  déplacements calculés depuis variants.ini par motiontak/outils/deplacements.py) ;
- static/images/background/collection/{sombre,clair}{,-720}/NN-nom.webp : les cartes réduites en 360 et
  720 px (illustrations sous droits réservés : dossier ignoré par git, à copier à la main sur le serveur).

Nécessite Pillow (pour les images).
"""

import json
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
MOTIONTAK = Path(sys.argv[1]) if len(sys.argv) > 1 else RACINE.parent / "motiontak"
TAILLES = {"": 360, "-720": 720}  # suffixe du dossier -> px ; le navigateur choisit (srcset)

SAISONS = {"printemps": "Printemps", "ete": "Été", "automne": "Automne", "hiver": "Hiver"}
ORDRE_RANG = {"roi": 0, "champion": 1, "pion": 2}
ORDRE_SAISON = {"printemps": 0, "ete": 1, "automne": 2, "hiver": 3}


def main():
    cartes = json.loads((MOTIONTAK / "assets/cartes/cartes.json").read_text(encoding="utf-8"))
    deplacements = json.loads(
        (MOTIONTAK / "assets/data/deplacements.json").read_text(encoding="utf-8")
    )

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
                "image": nom_fichier,
                "cases": [
                    {k: m[k] for k in ("dx", "dy", "genre", "saut", "repete", "illimite")}
                    for m in espece["cases"]
                ],
            }
        )
    personnages.sort(
        key=lambda p: (ORDRE_RANG[p["rang"]], ORDRE_SAISON[p["saison"]], -p["etoiles"], p["nom"])
    )

    sortie = RACINE / "static/data/collection.json"
    sortie.parent.mkdir(parents=True, exist_ok=True)
    sortie.write_text(
        json.dumps({"saisons": SAISONS, "personnages": personnages}, ensure_ascii=False, indent=1)
        + "\n",
        encoding="utf-8",
    )
    print(f"{len(personnages)} Personnages -> {sortie.relative_to(RACINE)}")

    from PIL import Image

    for face, dossier in (("sombre", "recto"), ("clair", "verso")):
        for suffixe, taille in TAILLES.items():
            dest = RACINE / "static/images/background/collection" / (face + suffixe)
            dest.mkdir(parents=True, exist_ok=True)
            for c in cartes:
                im = Image.open(MOTIONTAK / "assets/cartes" / dossier / c["fichier"]).convert("RGB")
                im.resize((taille, taille), Image.LANCZOS).save(
                    dest / (Path(c["fichier"]).stem + ".webp"), quality=82, method=6
                )
    print("images -> static/images/background/collection/{sombre,clair}{,-720}/")


if __name__ == "__main__":
    main()
