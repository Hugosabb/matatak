import sys
import json
from datetime import datetime, timezone
from typing import Dict, Any

def epd_to_json(epd_line, username="sab"):
    """
    Converts a single line from an EPD puzzle file to a JSON object
    matching the matatak puzzle schema.

    EPD format from chess-variant-puzzler is expected to be like:
    <fen> <operations>; e.g.: 8/3pbkn1/6l1/8/3c4/2G2K2/4FM2/3I1H2 w - - 4 6;variant matatak;bm d1d4;...
    """
    parts = epd_line.strip().split(";")
    fen_part = parts[0].strip()
    ops: Dict[str, Any] = {}
    for part in parts[1:]:
        part = part.strip()
        if " " in part:
            key, value = part.split(" ", 1)
            ops[key] = value.strip('"') 

    # The first part of the EPD is the FEN string, which can contain spaces.
    # The operations start after the first ';'.
    # The fen is everything before the first ';'.
    fen = fen_part

    variant = ops.get("variant", "chess")

    # The solution is the best move (bm)
    solution_moves_str = ops["bm"]

    puzzle_eval = ops.get("eval", "")

    puzzle = {
        "_id": datetime.now(timezone.utc).isoformat(),
        "variant": variant,
        "fen": fen,
        "moves": solution_moves_str,
        "type": ops.get("type", "advantage"),
        "eval": puzzle_eval,
        "pv": ops.get("pv", ""),
        "difficulty": float(ops.get("difficulty", 0)),
        "quality": float(ops.get("quality", 0)),
        "volatility": float(ops.get("volatility", 0)),
        "volatility2": float(ops.get("volatility2", 0)),
        "accuracy": float(ops.get("accuracy", 0)),
        "accuracy2": float(ops.get("accuracy2", 0)),
        "std": float(ops.get("std", 0)),
        "ambiguity": float(ops.get("ambiguity", 0)),
        "content": float(ops.get("content", 0)),
        "uploaded_by": username,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    return puzzle


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python epd2json.py <input.epd> [output.json]")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else input_file.replace(".epd", ".json")

    with open(input_file, "r") as f_in, open(output_file, "w") as f_out:
        for line in f_in:
            if not line.strip():
                continue
            json_puzzle = epd_to_json(line)
            f_out.write(json.dumps(json_puzzle, default=str) + "\n")

    print(f"Successfully converted {input_file} to {output_file}")