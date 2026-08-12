"""
Générateur des fichiers de campagne JSON pour Matatak et Matatak Mini.
"""

import json
import os
from import_epd_puzzles import parse_epd_line

PIECE_NAMES = {
    "k": "Lion",
    "b": "Chat",
    "c": "Léopard",
    "d": "Tigre",
    "e": "Tortue",
    "f": "Phacochère",
    "g": "Panda",
    "h": "Ours",
    "i": "Rhinocéros",
    "m": "Chimpanzé",
    "n": "Orang-outan",
    "o": "Gorille",
    "s": "Cheval",
    "w": "Éléphant",
    "x": "Crocodile",
}

PIECE_DESCRIPTIONS = {
    "k": "Le Lion est votre Roi. Protégez-le tout en traquant le Lion adverse !",
    "b": "Le Chat est agile et se déplace d'une case dans n'importe quelle direction.",
    "c": "Le Léopard bondit sur 2 cases en diagonale ou en ligne droite.",
    "i": "Le Rhinocéros avance en ligne droite comme une Tour mais charge avec puissance.",
    "m": "Le Chimpanzé saute comme un Fou ou un Cavalier avec une grande agilité.",
    "s": "Le Cheval se déplace en L comme le Cavalier classique aux échecs.",
    "x": "Le Crocodile est une pièce puissante combinant Tour et Roi.",
}


def puzzle_difficulty_key(puzzle):
    eval_str = puzzle.get("eval", "")
    num_moves = len(puzzle.get("moves", "").split(","))

    mate_in = 99
    if eval_str.startswith("#"):
        try:
            mate_in = int(eval_str[1:])
        except ValueError:
            pass

    fen_board = puzzle["fen"].split()[0]
    piece_count = sum(1 for c in fen_board if c.isalpha())

    return (num_moves, mate_in, piece_count)


def build_campaign(epd_file: str, output_json: str, variant_name: str, max_levels: int = 200):
    if not os.path.exists(epd_file):
        print(f"Fichier introuvable : {epd_file}")
        return

    puzzles = []
    with open(epd_file) as f:
        for lineno, line in enumerate(f, 1):
            doc = parse_epd_line(line)
            if doc:
                doc["variant"] = variant_name
                puzzles.append(doc)

    print(f"Lu {len(puzzles)} puzzles depuis {epd_file}")

    # Trier les puzzles du plus facile au plus difficile
    puzzles.sort(key=puzzle_difficulty_key)

    # Prendre jusqu'à max_levels puzzles
    selected = puzzles[:max_levels]

    seen_pieces = set()
    campaign_levels = []

    for idx, puzzle in enumerate(selected, 1):
        fen = puzzle["fen"]
        board_part = fen.split()[0]

        # Détecter si une nouvelle pièce remarquable apparaît pour la première fois
        intro_piece = None
        intro_title = None
        intro_text = None

        for char in board_part.lower():
            if char in PIECE_NAMES and char not in seen_pieces:
                seen_pieces.add(char)
                intro_piece = char
                intro_title = f"Nouveau personnage : Le {PIECE_NAMES[char]} !"
                intro_text = PIECE_DESCRIPTIONS.get(
                    char, f"Découvrez les pouvoirs du {PIECE_NAMES[char]} dans ce niveau."
                )
                break

        level_doc = {
            "level": idx,
            "puzzle_id": puzzle["_id"],
            "fen": fen,
            "moves": puzzle["moves"],
            "eval": puzzle["eval"],
            "type": puzzle["type"],
            "variant": variant_name,
            "title": f"Niveau {idx}",
        }

        if intro_piece:
            level_doc["intro"] = {
                "piece": intro_piece,
                "piece_name": PIECE_NAMES[intro_piece],
                "title": intro_title,
                "text": intro_text,
            }

        campaign_levels.append(level_doc)

    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(campaign_levels, f, ensure_ascii=False, indent=2)

    print(f"✓ Généré {len(campaign_levels)} niveaux dans {output_json}")


if __name__ == "__main__":
    base_dir = "/home/hugo/github/matatak"
    build_campaign(
        os.path.join(base_dir, "matatakmini_puzzles_01.epd"),
        os.path.join(base_dir, "server/campaign_matatakmini.json"),
        "matatakmini",
        200,
    )
    build_campaign(
        os.path.join(base_dir, "matatak_puzzles_01.epd"),
        os.path.join(base_dir, "server/campaign_matatak.json"),
        "matatak",
        200,
    )
