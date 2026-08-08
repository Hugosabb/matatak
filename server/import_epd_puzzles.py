"""
Import de puzzles matatak depuis un fichier EPD dans MongoDB.
Par défaut, ajoute les puzzles à la base de données sans supprimer les existants.
Utiliser --replace pour effacer les anciens puzzles avant l'importation.

Usage:
    python3 server/import_epd_puzzles.py matatak_puzzles.epd [--mongo-host <url>] [--replace] [--dry-run]
"""

import os
import sys
import argparse
import random
import string

import pymongo


# Mapping des types EPD vers les types MongoDB pychess-puzzler
TYPE_MAP = {
    "mate": "mate",
    "partial-mate": "mate",
    "defensive": "defensive",
    "turnaround": "turnaround",
    "winning": "winning",
}

VARIANTS_TO_CLEAR = ("matatak", "matatakmini")


def generate_id(length=5):
    """Génère un ID aléatoire alphanumérique de longueur `length`."""
    chars = string.ascii_letters + string.digits
    return "".join(random.choices(chars, k=length))


def parse_epd_line(line: str) -> dict | None:
    """
    Parse une ligne EPD et retourne un document puzzle MongoDB.
    Retourne None si la ligne est invalide ou vide.
    """
    line = line.strip()
    if not line:
        return None

    parts = line.split(";")
    if len(parts) < 2:
        return None

    fen = parts[0].strip()
    fields = {}
    for part in parts[1:]:
        part = part.strip()
        if not part:
            continue
        tokens = part.split(None, 1)  # split sur le premier espace
        if len(tokens) == 2:
            fields[tokens[0]] = tokens[1]
        elif len(tokens) == 1:
            fields[tokens[0]] = ""

    variant = fields.get("variant", "matatak")

    # Moves : depuis le champ pv (principal variation), déjà en format UCI séparé par virgules
    pv = fields.get("pv", fields.get("bm", ""))
    moves = pv.strip()

    # Eval
    eval_val = fields.get("eval", "")

    # Type
    raw_type = fields.get("type", "")
    puzzle_type = TYPE_MAP.get(raw_type, raw_type)

    doc = {
        "_id": generate_id(),
        "fen": fen,
        "variant": variant,
        "moves": moves,
        "eval": eval_val,
        "type": puzzle_type,
        "uploadedBy": "admin",
        "review": True,
        "played": 0,
        "perf": {
            "gl": {"r": 1500.0, "d": 500.0, "v": 0.06},
            "nb": 0,
        },
    }

    return doc


def import_epd(epd_file: str, mongo_host: str, dry_run: bool = False, replace: bool = False):
    client = pymongo.MongoClient(mongo_host)
    db = client["pychess-variants"]

    try:
        client.admin.command("ping")
        print(f"✓ Connecté à MongoDB: {mongo_host}")
    except Exception as e:
        print(f"✗ Impossible de se connecter à MongoDB: {e}")
        sys.exit(1)

    # Parse le fichier EPD
    puzzles = []
    errors = 0
    with open(epd_file) as f:
        for lineno, line in enumerate(f, 1):
            doc = parse_epd_line(line)
            if doc is None:
                continue
            puzzles.append((lineno, doc))

    print(f"\n{len(puzzles)} puzzles parsés depuis {epd_file}")

    if not puzzles:
        print("Aucun puzzle à importer.")
        client.close()
        return

    if dry_run:
        print("\n[DRY-RUN] Puzzles qui seraient importés :")
        for lineno, doc in puzzles:
            print(
                f"  Ligne {lineno:2d}: {doc['_id']} | {doc['variant']:12s} | "
                f"{doc['type']:12s} | eval={doc['eval']:6s} | moves={doc['moves'][:40]}"
            )
        client.close()
        return

    # Efface les anciens puzzles matatak / matatakmini uniquement si --replace est spécifié
    if replace:
        print(f"\n[REPLACE] Suppression des anciens puzzles {VARIANTS_TO_CLEAR}...")
        for variant in VARIANTS_TO_CLEAR:
            result = db.puzzle.delete_many({"variant": variant})
            print(f"  ✓ {result.deleted_count} puzzles '{variant}' supprimés")
    else:
        print(f"\n[AJOUT] Ajout des puzzles sans supprimer les existants...")

    # Assure des IDs uniques (génère de nouveaux si collision)
    existing_ids = set(doc["_id"] for doc in db.puzzle.find({}, {"_id": 1}))
    inserted = 0
    for lineno, doc in puzzles:
        while doc["_id"] in existing_ids:
            doc["_id"] = generate_id()
        existing_ids.add(doc["_id"])

        try:
            db.puzzle.insert_one(doc)
            print(
                f"  ✓ {lineno:2d}: {doc['_id']} | {doc['variant']:12s} | "
                f"{doc['type']:12s} | eval={doc['eval']:6s} | {doc['moves']}"
            )
            inserted += 1
        except Exception as e:
            print(f"  ✗ Ligne {lineno} ERREUR: {e}")
            errors += 1

    client.close()

    print(f"\nRésultat:")
    print(f"  Importés : {inserted}")
    print(f"  Erreurs  : {errors}")

    # Stats
    client2 = pymongo.MongoClient(mongo_host)
    db2 = client2["pychess-variants"]
    total = db2.puzzle.count_documents({})
    for v in VARIANTS_TO_CLEAR:
        count = db2.puzzle.count_documents({"variant": v})
        print(f"  Puzzles {v}: {count}")
    print(f"  Total puzzles en base: {total}")
    client2.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Import puzzles EPD → MongoDB")
    parser.add_argument("epd_file", help="Fichier EPD (une ligne = un puzzle)")
    parser.add_argument(
        "--mongo-host",
        default=os.getenv("MONGO_HOST", "mongodb://admin:pass@localhost:27017"),
        help="URL MongoDB (défaut: mongodb://admin:pass@localhost:27017)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Affiche ce qui serait importé sans écrire en base",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Efface les anciens puzzles avant d'importer les nouveaux (par défaut, conserve les anciens)",
    )
    args = parser.parse_args()

    if not os.path.exists(args.epd_file):
        print(f"Fichier introuvable: {args.epd_file}")
        sys.exit(1)

    import_epd(args.epd_file, args.mongo_host, dry_run=args.dry_run, replace=args.replace)


