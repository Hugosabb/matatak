"""Pistes d'icône Matatak à partir des calques de la boîte (motiontak/assets/boite)."""
import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

BOITE = Path.home() / "github/motiontak/assets/boite"
SORTIE = Path(sys.argv[1])
N = 1024  # taille de travail
SS = 4  # suréchantillonnage des formes vectorielles

OR_HAUT = (243, 168, 38)  # dégradé du logo de la boîte
OR_BAS = (240, 206, 104)
NOIR = (14, 12, 10)


def etoile_masque(taille, cx, cy, rx, ry, p=3.6):
    """Étoile à 4 branches aux flancs creusés, comme sur la boîte."""
    m = Image.new("L", (taille * SS, taille * SS), 0)
    pts = []
    for i in range(720):
        t = 2 * math.pi * i / 720
        c, s = math.cos(t), math.sin(t)
        x = math.copysign(abs(c) ** p, c) * rx
        y = math.copysign(abs(s) ** p, s) * ry
        pts.append(((cx + x) * SS, (cy + y) * SS))
    ImageDraw.Draw(m).polygon(pts, fill=255)
    return m.resize((taille, taille), Image.LANCZOS)


def degrade(taille, haut, bas, y0, y1):
    g = Image.new("RGB", (1, 256))
    for y in range(256):
        k = y / 255
        g.putpixel((0, y), tuple(round(a + (b - a) * k) for a, b in zip(haut, bas)))
    g = g.resize((1, max(1, int(y1 - y0))))
    im = Image.new("RGB", (taille, taille), haut)
    im.paste(g.resize((taille, g.height)), (0, int(y0)))
    ImageDraw.Draw(im).rectangle((0, int(y1), taille, taille), fill=bas)
    return im


def poser_or(fond, masque, y0, y1, lueur=0.0):
    if lueur:
        halo = masque.filter(ImageFilter.GaussianBlur(N * 0.04)).point(lambda v: int(v * lueur))
        fond.paste(Image.new("RGB", fond.size, OR_BAS), (0, 0), halo)
    fond.paste(degrade(fond.width, OR_HAUT, OR_BAS, y0, y1), (0, 0), masque)


def yeux(largeur):
    im = Image.open(BOITE / "eyes-new.png").convert("RGBA")
    im = im.crop(im.getchannel("A").getbbox())
    # le calque traîne un trait parasite sous l'œil gauche : on ne garde que les pixels opaques
    a = im.getchannel("A").point(lambda v: 255 if v > 200 else 0).filter(ImageFilter.MaxFilter(3))
    a = ImageChops.multiply(a.filter(ImageFilter.GaussianBlur(1)), im.getchannel("A"))
    im.putalpha(a)
    h = round(im.height * largeur / im.width)
    return im.resize((largeur, h), Image.LANCZOS)


def feuilles(assombrir=0.55, zoom=1.0):
    f = Image.open(BOITE / "leaves-all.png").convert("RGBA")
    if zoom != 1.0:
        t = round(2000 * zoom)
        f = f.resize((t, t), Image.LANCZOS)
        o = (t - 2000) // 2
        f = f.crop((o, o, o + 2000, o + 2000))
    f = f.resize((N, N), Image.LANCZOS)
    rgb = ImageEnhance.Brightness(f.convert("RGB")).enhance(assombrir)
    rgb = ImageEnhance.Color(rgb).enhance(0.9)
    fond = Image.new("RGB", (N, N), NOIR)
    fond.paste(rgb, (0, 0), f.getchannel("A"))
    return fond


def clairiere(fond, rayon, douceur):
    """Assombrit le centre pour détacher le motif des feuilles."""
    m = Image.new("L", (N, N), 0)
    ImageDraw.Draw(m).ellipse(
        (N / 2 - rayon, N / 2 - rayon, N / 2 + rayon, N / 2 + rayon), fill=255
    )
    m = m.filter(ImageFilter.GaussianBlur(douceur))
    fond.paste(Image.new("RGB", (N, N), NOIR), (0, 0), m)


def motif(fond, cy_etoile, r_etoile, cy_yeux, l_yeux, lueur=0.35):
    ry, rx = r_etoile, r_etoile * 0.82
    m = etoile_masque(N, N / 2, cy_etoile, rx, ry)
    poser_or(fond, m, cy_etoile - ry, cy_etoile + ry, lueur)
    y = yeux(l_yeux)
    fond.paste(y, (round(N / 2 - y.width / 2), round(cy_yeux - y.height / 2)), y)


def lettre_a(fond, cx, cy, h):
    """Le A du logo : triangle évidé en bas, étoile à la place de la barre."""
    m = Image.new("L", (N * SS, N * SS), 0)
    d = ImageDraw.Draw(m)
    s = lambda pts: [(x * SS, y * SS) for x, y in pts]
    w = h * 1.02
    haut, bas = cy - h / 2, cy + h / 2
    d.polygon(s([(cx, haut), (cx + w / 2, bas), (cx - w / 2, bas)]), fill=255)
    # encoche entre les jambes
    eh = h * 0.16
    d.polygon(
        s([(cx - w * 0.17, bas - eh), (cx + w * 0.17, bas - eh), (cx + w * 0.24, bas), (cx - w * 0.24, bas)]),
        fill=0,
    )
    m = m.resize((N, N), Image.LANCZOS)
    trou = etoile_masque(N, cx, cy + h * 0.1, h * 0.15, h * 0.18)
    m = ImageChops.subtract(m, trou)
    poser_or(fond, m, haut, bas)


def piste_a():
    """Illustrée : feuilles de la boîte, clairière, étoile et yeux en grand."""
    f = feuilles(0.85, zoom=1.12)
    clairiere(f, N * 0.30, N * 0.07)
    motif(f, N * 0.36, N * 0.13, N * 0.615, round(N * 0.62))
    return f


def piste_b():
    """Épurée : noir de la boîte, étoile et yeux seuls, aucune feuille."""
    f = Image.new("RGB", (N, N), NOIR)
    motif(f, N * 0.35, N * 0.15, N * 0.625, round(N * 0.70), lueur=0.25)
    return f


def piste_c():
    """Lettre : le A étoilé du logo MATATAK, feuilles en coin."""
    f = feuilles(0.85, zoom=1.25)
    clairiere(f, N * 0.40, N * 0.05)
    lettre_a(f, N / 2, N * 0.5, N * 0.5)
    return f


def planche(pistes):
    """Chaque piste en 512, en rond (Android), puis en 64, 32 et 16 px."""
    L = 512
    W = Image.new("RGB", (len(pistes) * (L + 40) + 40, L * 2 + 220), (60, 56, 52))
    for i, (nom, im) in enumerate(pistes):
        x = 40 + i * (L + 40)
        grand = im.resize((L, L), Image.LANCZOS)
        coin = Image.new("L", (L * 4, L * 4), 0)
        ImageDraw.Draw(coin).rounded_rectangle((0, 0, L * 4, L * 4), radius=L * 4 * 0.22, fill=255)
        W.paste(grand, (x, 40), coin.resize((L, L), Image.LANCZOS))
        rond = Image.new("L", (L * 4, L * 4), 0)
        ImageDraw.Draw(rond).ellipse((L * 0.4, L * 0.4, L * 3.6, L * 3.6), fill=255)  # zone sûre 80 %
        W.paste(grand, (x, L + 80), rond.resize((L, L), Image.LANCZOS))
        px = x
        for t in (64, 32, 16):
            W.paste(im.resize((t, t), Image.LANCZOS), (px, L * 2 + 120))
            px += t + 20
        im.save(SORTIE / f"piste-{nom}.png")
    W.save(SORTIE / "planche.png")


planche([("a", piste_a()), ("b", piste_b()), ("c", piste_c())])
