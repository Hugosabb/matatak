"""Section « Les échecs vous font envie, mais… » de la vitrine : écrit les deux plateaux dans templates/vitrine.html.

1. Échiquier classique (pièces Cburnett de Wikimedia, CC BY-SA 3.0, dans outils/pieces-cburnett/) : une ouverture
   italienne (1. e4 e5 2. Cf3 Cc6 3. Fc4 Fc5) ; à chaque position, une flèche pour chacun des coups légaux du joueur
   qui a le trait (calculés par python-chess, pas inventés).
2. Plateau de MATATAK : la mise en place à 2 du livret (Printemps contre Été). Il arrive et pousse l'échiquier hors
   de l'écran ; MOJO avance d'une case, on zoome sur sa carte, ses symboles brillent, puis on recule : une flèche
   aux couleurs du Printemps sort de chacun jusqu'à la case qu'il indique (point 1).

Le gabarit garde le résultat : ce script ne sert qu'à le refaire. Il a besoin de python-chess (pip install chess).
    python3 outils/vitrine_freins.py
"""
import re
from pathlib import Path

import chess

ICI = Path(__file__).resolve().parent
GABARIT = ICI.parent / "templates/vitrine.html"
PIECES = ICI / "pieces-cburnett"

# ---------------- 1. Échecs ----------------
COUPS_ECHECS = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]


def xy(sq):
    return chess.square_file(sq) * 100, (7 - chess.square_rank(sq)) * 100


def assourdi(couleur):
    """Couleur #rgb ou #rrggbb passée par saturate(.45) puis brightness(.62) (formules CSS) : l'échiquier est assourdi
    dans ses couleurs mêmes, sans filtre CSS (un filtre sur ce dessin, dont 198 flèches changent à chaque image,
    était recalculé à chaque image : jusqu'à plusieurs secondes par image dans WebKit, 17/11)."""
    h = couleur.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    s = 0.45
    m = [(0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s),
         (0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s),
         (0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s)]
    out = [min(1, max(0, a * r + b_ * g + c * b)) * 0.62 for a, b_, c in m]
    return "#" + "".join(f"{round(v * 255):02x}" for v in out)


def assourdir_tout(texte):
    return re.sub(r"#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b", lambda m: assourdi(m.group(0)), texte)


def symboles():
    """Un <symbol> par pièce, pris tel quel dans le fichier de Wikimedia."""
    out = []
    for p in "kqrbnp":
        for couleur, c in (("l", p.upper()), ("d", p)):
            svg = (PIECES / f"Chess_{p}{couleur}t45.svg").read_text()
            corps = re.search(r"<svg[^>]*>(.*)</svg>", svg, re.S).group(1)
            corps = re.sub(r"\s+", " ", corps).strip()
            corps = assourdir_tout(corps)  # couleurs assourdies d'avance, sans filtre CSS
            out.append(f'<symbol id="pc-{"b" if c.isupper() else "n"}{p}" viewBox="0 0 45 45">{corps}</symbol>')
    return "".join(out)


def echiquier():
    board = chess.Board()
    # chaque pièce suit sa case d'une position à l'autre (pas de prise dans cette ouverture)
    pieces = {sq: [sq] for sq in board.piece_map()}
    coups = []
    for k in range(len(COUPS_ECHECS) + 1):
        coups.append(list(board.legal_moves))
        if k == len(COUPS_ECHECS):
            break
        mv = board.parse_san(COUPS_ECHECS[k])
        for chemin in pieces.values():
            chemin.append(mv.to_square if chemin[-1] == mv.from_square else chemin[-1])
        board.push(mv)
    depart = chess.Board()
    out = ['<svg class="echiquier" viewBox="-46 -46 892 892" aria-hidden="true"><defs>',
           '<marker id="pointe" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3" orient="auto">'
           '<path d="M0 0L10 5L0 10z"/></marker>', symboles(), '</defs>',
           '<rect class="cadre" x="-46" y="-46" width="892" height="892" rx="14"/>']
    for r in range(8):
        for f in range(8):
            out.append(f'<rect x="{f*100}" y="{r*100}" width="100" height="100" class="{"c" if (r + f) % 2 == 0 else "f"}"/>')
    # coordonnées dans le cadre, comme sur un échiquier de club
    for f in range(8):
        out.append(f'<text class="coord" x="{f*100+50}" y="833">{"abcdefgh"[f]}</text>')
    for r in range(8):
        out.append(f'<text class="coord" x="-23" y="{r*100+59}">{8-r}</text>')
    # les flèches sous les pièces, un groupe par position
    for k, liste in enumerate(coups):
        out.append(f'<g class="coups" data-k="{k}">')
        for mv in liste:
            x1, y1 = xy(mv.from_square)
            x2, y2 = xy(mv.to_square)
            dx, dy = x2 - x1, y2 - y1
            lg = (dx * dx + dy * dy) ** 0.5
            # du centre de la case de départ au centre de la case d'arrivée, pointe comprise
            ra = 22 / lg
            out.append(f'<line x1="{x1+50:.0f}" y1="{y1+50:.0f}" x2="{x2+50-dx*ra:.0f}" y2="{y2+50-dy*ra:.0f}" marker-end="url(#pointe)"/>')
        out.append('</g>')
    out.append('<g class="pieces">')
    for sq, chemin in pieces.items():
        p = depart.piece_at(sq).symbol()
        cases = " ".join(chess.square_name(s) for s in chemin)
        x, y = xy(sq)
        nom = f'{"b" if p.isupper() else "n"}{p.lower()}'
        out.append(f'<g data-c="{cases}" transform="translate({x} {y})"><use href="#pc-{nom}" width="100" height="100"/></g>')
    out.append('</g></svg>')
    return "".join(out), [len(c) for c in coups]


# ---------------- 2. MATATAK ----------------
# (nom, face, case) ; mise en place à 2 joueurs du livret : Roi e1, Champion d1, Pions d2 e2 (vus par chacun)
CARTES = [("04-mojo", "clair", "e1"), ("13-dysko", "clair", "d1"), ("19-banjo", "clair", "d2"), ("19-banjo", "clair", "e2"),
          ("01-azar", "sombre", "d8"), ("10-krak", "sombre", "e8"), ("35-tamtam", "sombre", "d7"), ("35-tamtam", "sombre", "e7")]


# MOJO (Roi) avance de e1 à e2 au début du zoom : au recul, ses 8 cases sont sur le plateau et il est au milieu.
CASE_MOJO = (4, 1)  # e2 (colonne, rangée en partant de 0)
# centre des 8 symboles de déplacement sur la carte (en % de la carte), mesuré sur clair-720/04-mojo.webp (16/11)
SYMBOLES_MOJO = [(49.6, 9.7), (86.4, 13.4), (91, 49.4), (86.4, 86.8), (50, 88.9), (13.9, 86.8), (9.4, 49.6), (13.9, 13.3)]
CARTE = 10.7  # largeur d'une carte, en % du plateau
DIRECTIONS = {0: (0, -1), 45: (1, -1), 90: (1, 0), 135: (1, 1), 180: (0, 1), 225: (-1, 1), 270: (-1, 0), 315: (-1, -1)}


def plateau_mt():
    # .vue zoome à l'intérieur du cadre du plateau (caméra), sans déborder sur le texte ; tout y est en % du plateau
    out = ['<div class="plateau-mt" aria-hidden="true" style="--carte-mojo:url(\'{{ v }}/mojo-1200.webp\')"><div class="vue">']
    c0, r0 = CASE_MOJO
    for nom, face, case in CARTES:
        x, y = (ord(case[0]) - 97) * 12.5, (8 - int(case[1])) * 12.5
        tourne = "rotate:180deg;" if face == "sombre" else ""
        if nom == "04-mojo":  # vue de très près : la grande image ; elle avance d'une case (--av)
            out.append(f'<img class="vedette" src="{{{{ v }}}}/mojo-1200.webp" alt="" loading="lazy" style="left:{x+0.9}%;top:{y+0.9}%">')
        else:
            out.append(f'<img src="{{{{ c }}}}/{face}/{nom}.webp" alt="" loading="lazy" style="left:{x+0.9}%;top:{y+0.9}%;{tourne}">')
    # chaque symbole de la carte pulse un instant (--p) : une copie du symbole lui-même, découpée dans l'image de la
    # carte (carré de 16 % de la carte, bords fondus), qui grossit puis revient.
    gx, gy = c0 * 12.5 + 0.9, (7 - r0) * 12.5 + 0.9
    T = 16  # côté du carré découpé, en % de la carte
    for sx, sy in SYMBOLES_MOJO:
        bx, by = (sx - T / 2) / (100 - T) * 100, (sy - T / 2) / (100 - T) * 100
        out.append(f'<i class="lueur" style="left:{gx + CARTE * sx / 100:.2f}%;top:{gy + CARTE * sy / 100:.2f}%;'
                   f'background-position:{bx:.1f}% {by:.1f}%"></i>')
    # Puis, pendant qu'on recule (--t), une flèche aux couleurs du Printemps (la Saison de MOJO) sort du bord de la
    # carte, à côté de chaque symbole, et pousse jusqu'à la case qu'il indique (sans l'atteindre tout à fait : légère).
    # En unités de case (c = 100, plateau de 800).
    cx0, cy0 = c0 * 100 + 50, (7 - r0) * 100 + 50
    out.append('<svg class="fleches-mt" viewBox="0 0 800 800">')
    for angle, (dx, dy) in DIRECTIONS.items():
        n = (dx * dx + dy * dy) ** 0.5
        ux, uy = dx / n, dy / n
        depart = 43 / max(abs(ux), abs(uy)) + 6          # bord de la carte (0,86 case), avec un petit jeu
        # toutes les flèches ont la même longueur (diagonales comme orthogonales, Hugo 16/11)
        arrivee = depart + 47
        long = arrivee - depart
        # --l = longueur du corps ; la pointe (20 de long) suit le bout du corps
        out.append(f'<g transform="translate({cx0 + ux * depart:.1f} {cy0 + uy * depart:.1f}) rotate({angle - 90})" style="--l:{long - 18:.1f}">'
                   f'<line x1="0" y1="0" x2="{long - 18:.1f}" y2="0"/><path class="tete" d="M20 0L0 13L3 0L0 -13Z"/></g>')
    out.append('</svg>')
    out.append('</div></div><!-- /plateau-mt -->')
    return "".join(out)


if __name__ == "__main__":
    svg, nombres = echiquier()
    html = GABARIT.read_text()
    html, n1 = re.subn(r'<svg class="echiquier".*?</svg>', lambda m: svg, html, flags=re.S)
    html, n2 = re.subn(r'<div class="plateau-mt".*?<!-- /plateau-mt -->', lambda m: plateau_mt(), html, flags=re.S)
    if n2 == 0:  # ancienne forme, sans vue intérieure
        html, n2 = re.subn(r'<div class="plateau-mt".*?</div>', lambda m: plateau_mt(), html, flags=re.S)
    assert n1 == n2 == 1, (n1, n2)
    GABARIT.write_text(html)
    print("coups possibles à chaque position :", nombres)
