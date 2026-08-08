"""
Script d'import de puzzles synchrone (utilise pymongo, pas motor).
Remplace import_puzzles.py qui nécessitait le module motor non disponible.

Usage:
    uv run python3 server/import_puzzles_sync.py <fichier.json> [--mongo-host <url>]

Exemple local (Docker Compose actif):
    uv run python3 server/import_puzzles_sync.py /home/hugo/github/chess-variant-puzzler/puzzles.json

Format JSON attendu (une ligne par puzzle):
    {"_id": "...", "variant": "matatak", "fen": "...", "moves": "...",
     "type": "...", "eval": "...", "uploaded_by": "...", ...}

Note: seules les lignes avec le champ "uploaded_by" sont importées.
"""

import os
import json
import sys
import argparse

import pymongo


def upsert_from_json(json_file: str, mongo_host: str, dry_run: bool = False):
    client = pymongo.MongoClient(mongo_host)
    db = client["pychess-variants"]

    # Vérifie la connexion
    try:
        client.admin.command("ping")
        print(f"✓ Connecté à MongoDB: {mongo_host}")
    except Exception as e:
        print(f"✗ Impossible de se connecter à MongoDB: {e}")
        sys.exit(1)

    inserted = 0
    skipped = 0
    errors = 0

    with open(json_file) as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue

            try:
                doc = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"  Ligne {lineno}: JSON invalide — {e}")
                errors += 1
                continue

            if "uploaded_by" not in doc:
                skipped += 1
                continue

            if dry_run:
                print(f"  [DRY-RUN] Ligne {lineno}: {doc.get('_id', '?')} ({doc.get('variant', '?')})")
                inserted += 1
                continue

            try:
                db.puzzle.find_one_and_update(
                    {"_id": doc["_id"]},
                    {"$set": doc},
                    upsert=True,
                )
                print(f"  ✓ {lineno}: {doc['_id']} ({doc.get('variant', '?')})")
                inserted += 1
            except Exception as e:
                print(f"  ✗ Ligne {lineno} ERREUR: {doc.get('_id', '?')} — {e}")
                errors += 1

    client.close()

    print(f"\n{'[DRY-RUN] ' if dry_run else ''}Résultat:")
    print(f"  Importés  : {inserted}")
    print(f"  Ignorés   : {skipped} (pas de champ uploaded_by)")
    print(f"  Erreurs   : {errors}")

    # Compte les puzzles en base après import
    if not dry_run:
        client2 = pymongo.MongoClient(mongo_host)
        db2 = client2["pychess-variants"]
        total = db2.puzzle.count_documents({})
        matatak_count = db2.puzzle.count_documents({"variant": "matatak"})
        matatakmini_count = db2.puzzle.count_documents({"variant": "matatakmini"})
        print(f"\nBase de données:")
        print(f"  Total puzzles      : {total}")
        print(f"  Puzzles matatak    : {matatak_count}")
        print(f"  Puzzles matatakmini: {matatakmini_count}")
        client2.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Import puzzles JSON → MongoDB")
    parser.add_argument("json_file", help="Fichier JSON (une ligne = un puzzle)")
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
    args = parser.parse_args()

    if not os.path.exists(args.json_file):
        print(f"Fichier introuvable: {args.json_file}")
        sys.exit(1)

    upsert_from_json(args.json_file, args.mongo_host, dry_run=args.dry_run)
