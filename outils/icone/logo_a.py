"""Piste A : yeux plus grands et plus rapprochés (dosages comparés)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.argv = [sys.argv[0], sys.argv[1]]
import logo as L
from PIL import Image, ImageDraw


def deux_yeux(hauteur):
    """Les deux yeux du calque, séparés, à la hauteur voulue."""
    y = L.yeux(2000)
    milieu = y.width // 2
    g, d = y.crop((0, 0, milieu, y.height)), y.crop((milieu, 0, y.width, y.height))
    g, d = g.crop(g.getbbox()), d.crop(d.getbbox())
    k = hauteur / max(g.height, d.height)
    return [im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS) for im in (g, d)]


def piste(h_oeil, ecart, cy_yeux, cy_etoile, r_etoile):
    f = L.feuilles(0.85, zoom=1.12)
    L.clairiere(f, L.N * 0.30, L.N * 0.07)
    ry, rx = r_etoile, r_etoile * 0.82
    m = L.etoile_masque(L.N, L.N / 2, cy_etoile, rx, ry)
    L.poser_or(f, m, cy_etoile - ry, cy_etoile + ry, 0.35)
    g, d = deux_yeux(round(h_oeil))
    c = L.N / 2
    f.paste(g, (round(c - ecart / 2 - g.width), round(cy_yeux - g.height / 2)), g)
    f.paste(d, (round(c + ecart / 2), round(cy_yeux - d.height / 2)), d)
    return f


N = L.N
pistes = [
    ("actuelle", piste(N * 0.105, N * 0.27, N * 0.615, N * 0.36, N * 0.13)),
    ("a1", piste(N * 0.14, N * 0.19, N * 0.62, N * 0.355, N * 0.13)),
    ("a2", piste(N * 0.165, N * 0.15, N * 0.625, N * 0.35, N * 0.125)),
    ("a3", piste(N * 0.19, N * 0.11, N * 0.63, N * 0.345, N * 0.12)),
]
T = 400
W = Image.new("RGB", (len(pistes) * (T + 30) + 30, T * 2 + 170), (60, 56, 52))
for i, (nom, im) in enumerate(pistes):
    x = 30 + i * (T + 30)
    grand = im.resize((T, T), Image.LANCZOS)
    for j, forme in enumerate(("carre", "rond")):
        m = Image.new("L", (T * 4, T * 4), 0)
        dr = ImageDraw.Draw(m)
        if forme == "carre":
            dr.rounded_rectangle((0, 0, T * 4, T * 4), radius=T * 4 * 0.22, fill=255)
        else:
            dr.ellipse((T * 0.4, T * 0.4, T * 3.6, T * 3.6), fill=255)
        W.paste(grand, (x, 30 + j * (T + 30)), m.resize((T, T), Image.LANCZOS))
    px = x
    for t in (64, 48, 32):
        W.paste(im.resize((t, t), Image.LANCZOS), (px, 2 * T + 90))
        px += t + 16
    im.save(Path(sys.argv[1]) / f"piste-{nom}.png")
W.save(Path(sys.argv[1]) / "planche-a.png")
