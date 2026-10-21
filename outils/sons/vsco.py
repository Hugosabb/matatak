"""Sons Matatak joués avec les vrais échantillons de VSCO 2 Community Edition (CC0).

Petit échantillonneur maison (pas de sfizz) : choix de la nuance selon la vélocité, alternance
des prises, transposition par rééchantillonnage, réverbération synthétique, compression.

Usage : python3 -I vsco.py CHEMIN/VERS/VSCO-2-CE
"""

import glob
import os
import re
import subprocess
import sys
import wave

import numpy as np

SR = 44100
RACINE = sys.argv[1]
ICI = os.path.dirname(os.path.abspath(__file__))
SORTIE = os.path.join(ICI, "rendu-vsco")
rng = np.random.default_rng(3)

NOTES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def n(nom):
    """Nom de note standard ('C4' = 60) -> MIDI."""
    m = re.fullmatch(r"([A-G])([b#]?)(-?\d)", nom)
    base = NOTES[m[1]] + {"": 0, "b": -1, "#": 1}[m[2]]
    return 12 * (int(m[3]) + 1) + base


def nom_vsco(nom):
    """Les fichiers VSCO nomment 'C3' le do du milieu : un octave de plus que le standard."""
    return n(nom.replace("#", "#")) + 12


# --- lecture des échantillons ------------------------------------------------------------------

_cache = {}


def lire(chemin):
    if chemin in _cache:
        return _cache[chemin]
    w = wave.open(chemin)
    nc, sw, sr, nf = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
    brut = w.readframes(nf)
    if sw == 2:
        x = np.frombuffer(brut, np.int16).astype(np.float32) / 32768
    elif sw == 3:
        o = np.frombuffer(brut, np.uint8).reshape(-1, 3).astype(np.int32)
        x = o[:, 0] | o[:, 1] << 8 | o[:, 2] << 16
        x = (np.where(x >= 1 << 23, x - (1 << 24), x) / (1 << 23)).astype(np.float32)
    else:
        raise ValueError(f"{chemin} : {sw} octets par échantillon")
    x = x.reshape(-1, nc)
    if nc == 1:
        x = np.repeat(x, 2, axis=1)
    if sr != SR:
        idx = np.arange(0, len(x) - 1, sr / SR)
        x = np.stack([np.interp(idx, np.arange(len(x)), x[:, c]) for c in (0, 1)], axis=1).astype(
            np.float32
        )
    # retire le silence avant l'attaque (sinon tout serait en retard)
    seuil = np.abs(x).max() * 0.02
    debut = max(0, int(np.argmax(np.abs(x).max(axis=1) > seuil)) - int(0.002 * SR))
    x = x[debut:]
    _cache[chemin] = x
    return x


def fichiers(motif):
    return sorted(glob.glob(os.path.join(RACINE, motif)))


# --- instruments -------------------------------------------------------------------------------


class Percussion:
    """couches[i] = liste de prises (rr) pour la nuance i, de la plus douce à la plus forte."""

    def __init__(self, couches, gain_db=0.0, pan=0.0):
        self.couches = [c for c in couches if c]
        self.gain = 10 ** (gain_db / 20)
        self.pan = np.array([1 - pan, 1 + pan], np.float32) / (1 + abs(pan))
        self.rr = 0
        crete = max(np.abs(lire(f)).max() for f in self.couches[-1])
        self.norme = 1 / crete

    def jouer(self, mix, t, vel=100, coupe=None, transpo=0.0):
        k = min(len(self.couches) - 1, int(vel / 128 * len(self.couches)))
        prises = self.couches[k]
        x = lire(prises[self.rr % len(prises)])
        self.rr += 1
        if transpo:
            x = transposer(x, transpo)
        if coupe:
            x = relacher(x, coupe, 0.25)
        # niveau : la nuance choisie garde son timbre, la vélocité ajuste finement
        g = self.gain * self.norme * (0.55 + 0.45 * vel / 127)
        poser(mix, t, x * g * self.pan)


class Tonal:
    """Instrument à hauteur : dict {midi: fichier}, on prend l'échantillon le plus proche."""

    def __init__(self, racines, gain_db=0.0, relache=0.12):
        self.racines = racines
        self.gain = 10 ** (gain_db / 20)
        self.relache = relache
        crete = np.median([np.abs(lire(f)).max() for f in racines.values()])
        self.norme = 1 / crete

    def jouer(self, mix, t, note, duree, vel=100):
        racine = min(self.racines, key=lambda r: (abs(r - note), r < note))
        x = transposer(lire(self.racines[racine]), note - racine)
        x = relacher(x, duree, self.relache)
        g = self.gain * self.norme * (vel / 127) ** 1.3
        # léger décalage humain, pour que les accords ne sonnent pas « machine »
        poser(mix, t + rng.uniform(0, 0.012), x * g)


def transposer(x, demi_tons):
    if abs(demi_tons) < 1e-3:
        return x
    r = 2 ** (demi_tons / 12)
    idx = np.arange(0, len(x) - 1, r)
    return np.stack([np.interp(idx, np.arange(len(x)), x[:, c]) for c in (0, 1)], axis=1)


def relacher(x, duree, rel):
    fin = int((duree + rel) * SR)
    x = x[:fin].copy()
    d0 = int(duree * SR)
    if len(x) > d0:
        x[d0:] *= np.linspace(1, 0, len(x) - d0)[:, None] ** 2
    return x


def poser(mix, t, x):
    i = int(t * SR)
    j = min(len(mix), i + len(x))
    if j > i:
        mix[i:j] += x[: j - i]


# --- banque ------------------------------------------------------------------------------------


def couches(prefixe, nuances):
    return [fichiers(f"{prefixe}_v{v}_*.wav") for v in nuances]


def cuivre(dossier, motif, nuance_forte):
    """{midi: fichier} en prenant la nuance la plus forte disponible pour chaque note."""
    par_note = {}
    for f in fichiers(f"Brass/{dossier}/sus/*.wav"):
        m = re.search(motif, os.path.basename(f))
        if not m:
            continue
        note, v = nom_vsco(m[1]), int(m[2])
        if v <= nuance_forte and (note not in par_note or v > par_note[note][0]):
            par_note[note] = (v, f)
    return {k: f for k, (v, f) in par_note.items()}


def banque():
    b = {
        "gc": Percussion(couches("Percussion/BDrumNewhit", range(1, 8)), 0),
        "gong": Percussion(
            [
                [f]
                for f in (
                    fichiers("Percussion/gongHit_p.wav")
                    + fichiers("Percussion/gongHit_mf.wav")
                    + fichiers("Percussion/gongHit_f.wav")
                    + fichiers("Percussion/gongHit_fff.wav")
                )
            ],
            -2,
        ),
        "quinto": Percussion(couches("Percussion/Quinto-HitN", (1, 2, 3)), -7, pan=0.25),
        "conga": Percussion(couches("Percussion/Conga-HitN", (1, 2, 3)), -6, pan=-0.1),
        "tumba": Percussion(couches("Percussion/Tumba-HitN", (1, 2, 3)), -4, pan=-0.3),
        "bois_haut": Percussion(couches("Percussion/LogDrumHi_MedM", (1, 2, 3)), -9, pan=0.35),
        "bois_bas": Percussion(couches("Percussion/LogDrumLo_MedM", (1, 2, 3)), -6, pan=-0.35),
        "tambourin": Percussion(couches("Percussion/Tamb1-Shake", (1,)), -16),
        "maracas": Percussion([fichiers("VSCO 1 Percussion/varWood/maraca[1-5].wav")], -15),
        "trompette": Tonal(cuivre("Trumpet", r"_sus_([A-G]#?\d)_v(\d)_rr1", 3), -7),
        "cor": Tonal(cuivre("F Horn", r"_sus_([A-G]#?\d)_v(\d)_", 4), -8),
        "trombone": Tonal(cuivre("Tenor Trombone", r"_sus_([A-G]#?\d)_v(\d)_", 3), -8),
        "tuba": Tonal(cuivre("Tuba", r"_sus_([A-G]#?\d)_v(\d)_rr1", 3), -5),
        "marimba": Tonal(
            {
                nom_vsco(re.search(r"Outrigger_([A-G]\d)", f)[1]): f
                for f in fichiers("Percussion/Marimba/*.wav")
            },
            -6,
            relache=0.6,
        ),
    }
    # timbales : hauteurs mesurées (les fichiers ne portent pas de nom de note)
    timbales = {
        37.4: "Timpani3",
        40.0: "Timpani4",
        41.6: "Timpani1",
        42.4: "Timpani5",
        46.7: "Timpani2",
    }
    b["timbales"] = {
        h: Percussion(
            [
                fichiers(f"Percussion/Timpani/{nom}_Hit_v3_*.wav"),
                fichiers(f"Percussion/Timpani/{nom}_Hit_v4_*.wav")
                or fichiers(f"Percussion/Timpani/{nom}_Hit_v3_*.wav"),
            ],
            -3,
        )
        for h, nom in timbales.items()
    }
    return b


def timbale(b, mix, t, note, vel=115, coupe=2.0):
    h = min(b["timbales"], key=lambda h: abs(h - note))
    b["timbales"][h].jouer(mix, t, vel, coupe=coupe, transpo=note - h)


def accord_cuivres(b, mix, t, duree, haut, milieu, bas, basse, vel=115):
    for nom in haut:
        b["trompette"].jouer(mix, t, n(nom), duree, vel)
    for nom in milieu:
        b["cor"].jouer(mix, t, n(nom), duree, vel)
    for nom in bas:
        b["trombone"].jouer(mix, t, n(nom), duree, vel)
    b["tuba"].jouer(mix, t, n(basse), duree, vel)


def groove(b, mix, t0, temps, beat, vel0=55, vel1=120):
    """Congas en doubles croches (quinto / conga / tumba), maracas, grosse caisse syncopée."""
    motif = ["quinto", "conga", "tumba", "conga", "quinto", "conga", "tumba", "tumba"]
    k = int(temps * 4)
    for i in range(k):
        v = int(vel0 + (vel1 - vel0) * i / max(1, k - 1))
        t = t0 + i * beat / 4
        b[motif[i % 8]].jouer(mix, t, min(127, v + (15 if i % 4 == 0 else 0)))
        b["maracas"].jouer(mix, t, v)
        if i % 8 in (0, 3):
            b["gc"].jouer(mix, t, min(127, v + 10), coupe=0.6)
        if i % 8 == 6:
            b["bois_bas"].jouer(mix, t, v)


# --- compositions ------------------------------------------------------------------------------


def victoire_tribale(b):
    """V1 : congas qui montent, cadence de cuivres Ab - Bb - C sur grosse caisse et timbales."""
    beat = 60 / 136
    mix = np.zeros((SR * 5, 2), np.float32)
    groove(b, mix, 0, 1.0, beat)
    for i, (haut, milieu, bas, basse, tim) in enumerate(
        (
            (["Ab4", "C5", "Eb5"], ["Ab3", "C4", "Eb4"], ["Ab2", "Eb3"], "Ab1", "Ab2"),
            (["Bb4", "D5", "F5"], ["Bb3", "D4", "F4"], ["Bb2", "F3"], "Bb1", "Bb2"),
        )
    ):
        t = (1.0 + 0.5 * i) * beat
        accord_cuivres(b, mix, t, 0.42 * beat, haut, milieu, bas, basse, 112 + 5 * i)
        b["gc"].jouer(mix, t, 115, coupe=0.6)
        b["tumba"].jouer(mix, t, 120)
        timbale(b, mix, t, n(tim), 110, coupe=0.5)
    t = 2.0 * beat
    accord_cuivres(
        b, mix, t, 1.9 * beat, ["C5", "E5", "G5"], ["C4", "E4", "G4"], ["C3", "G3"], "C2", 127
    )
    b["gc"].jouer(mix, t, 127, coupe=2.0)
    timbale(b, mix, t, n("C2"), 127)
    b["bois_bas"].jouer(mix, t, 127)
    b["tumba"].jouer(mix, t, 127)
    for i, nom in enumerate(["G4", "C5", "E5", "G5", "C6"]):
        b["marimba"].jouer(mix, t + i * beat / 8, n(nom), 0.6, 110)
    for i in range(8):  # roulement de congas qui retombe
        b["conga" if i % 2 else "quinto"].jouer(mix, t + (2 + i) * beat / 8, 110 - 9 * i)
    return mix


def victoire_marimba(b):
    """V2 : groove de tambours, marimba pentatonique qui grimpe, impact cuivres + timbales."""
    beat = 60 / 128
    mix = np.zeros((SR * 5, 2), np.float32)
    groove(b, mix, 0, 2.0, beat, vel0=50, vel1=115)
    for t, nom in ((0, "bois_haut"), (0.75, "bois_haut"), (1.5, "bois_bas")):
        b[nom].jouer(mix, t * beat, 110)
    for i, nom in enumerate(["C4", "D4", "E4", "G4", "A4", "C5", "D5", "E5"]):
        b["marimba"].jouer(mix, (1.0 + i / 8) * beat, n(nom), 0.4, 100 + 3 * i)
    t = 2.0 * beat
    accord_cuivres(
        b, mix, t, 1.8 * beat, ["E5", "G5", "C6"], ["C4", "E4", "G4"], ["C3", "G3"], "C2", 125
    )
    b["gc"].jouer(mix, t, 127, coupe=2.0)
    timbale(b, mix, t, n("C2"), 127)
    timbale(b, mix, t + 0.5 * beat, n("G2"), 100)
    b["tumba"].jouer(mix, t, 127)
    b["bois_bas"].jouer(mix, t, 120)
    for nom in ("C4", "E4", "G4", "C5"):
        b["marimba"].jouer(mix, t, n(nom), 1.2, 115)
    return mix


def debut_gong(b):
    """S1 : un coup de gong, doublé d'une grosse caisse et d'une timbale pour le poids."""
    mix = np.zeros((SR * 4, 2), np.float32)
    b["gong"].jouer(mix, 0.0, 127, coupe=2.6)
    b["gc"].jouer(mix, 0.0, 127, coupe=2.0)
    timbale(b, mix, 0.0, n("C2"), 115)
    return mix


def debut_tambours_gong(b):
    """S2 : « ta-ka-ta-ka » de congas qui monte, puis BOUM + gong."""
    beat = 60 / 140
    mix = np.zeros((SR * 4, 2), np.float32)
    motif = ["quinto", "conga", "quinto", "conga", "tumba", "conga", "tumba", "tumba"]
    for i, nom in enumerate(motif):
        b[nom].jouer(mix, i * beat / 4, 70 + 7 * i)
    t = 2 * beat
    b["gong"].jouer(mix, t, 127, coupe=2.3)
    b["gc"].jouer(mix, t, 127, coupe=2.0)
    b["tumba"].jouer(mix, t, 127)
    timbale(b, mix, t, n("C2"), 120)
    return mix


# --- variantes du « ta-ka-ta-ka » --------------------------------------------------------------


def frappes(b, mix, beat, seq):
    """seq : (position en temps, instrument, vélocité). Petit flottement humain sur chaque coup."""
    for pos, nom, vel in seq:
        t = max(0.0, pos * beat + rng.normal(0, 0.004))
        v = int(np.clip(vel + rng.integers(-5, 6), 1, 127))
        b[nom].jouer(mix, t, v)


def boum(b, mix, t, gong=None, timb=True):
    """L'impact : grosse caisse + tumba + tambour en bois grave, timbale et gong en option."""
    b["gc"].jouer(mix, t, 127, coupe=2.0)
    b["tumba"].jouer(mix, t, 127)
    b["bois_bas"].jouer(mix, t, 120)
    if timb:
        timbale(b, mix, t, n("C2"), 118)
    if gong:
        b["gong"].jouer(mix, t, gong, coupe=2.4)


TAKA = ["quinto", "conga", "quinto", "conga", "tumba", "conga", "tumba", "tumba"]


def p1_taka_lent(b):
    """P1 : le même ta-ka-ta-ka que S2, plus posé (108 au lieu de 140), puis BOUM + gong."""
    beat = 60 / 108
    mix = np.zeros((SR * 5, 2), np.float32)
    frappes(b, mix, beat, [(i / 4, nom, 72 + 7 * i) for i, nom in enumerate(TAKA)])
    boum(b, mix, 2 * beat, gong=127)
    return mix


def p2_appel_reponse(b):
    """P2 : appel aigu « ta-ka-ta-ka », un silence, réponse grave « ta-ka », puis BOUM, sans gong."""
    beat = 60 / 100
    mix = np.zeros((SR * 5, 2), np.float32)
    frappes(
        b,
        mix,
        beat,
        [
            (0, "quinto", 95),
            (0.25, "conga", 80),
            (0.5, "quinto", 100),
            (0.75, "conga", 85),
            (1.5, "tumba", 105),
            (1.75, "tumba", 110),
        ],
    )
    boum(b, mix, 2 * beat)
    frappes(b, mix, beat, [(2.5 + i / 4, "maracas", 90 - 12 * i) for i in range(4)])
    return mix


def p3_ternaire(b):
    """P3 : en ternaire (balancement africain « ta-ka-ta, ta-ka-ta »), qui monte, puis BOUM + gong
    plus doux."""
    beat = 60 / 96
    mix = np.zeros((SR * 5, 2), np.float32)
    motif = ["quinto", "conga", "conga", "quinto", "conga", "tumba"]
    frappes(
        b,
        mix,
        beat,
        [(i / 3, nom, 75 + 8 * i + (12 if i % 3 == 0 else 0)) for i, nom in enumerate(motif)],
    )
    frappes(b, mix, beat, [(i / 3, "maracas", 70) for i in range(6)])
    boum(b, mix, 2 * beat, gong=105)
    return mix


def p4_taka_bois(b):
    """P4 : ta-ka-ta-ka de congas, les tambours en bois répondent « tok-tok », puis BOUM, sans gong."""
    beat = 60 / 104
    mix = np.zeros((SR * 5, 2), np.float32)
    frappes(b, mix, beat, [(i / 4, nom, 78 + 7 * i) for i, nom in enumerate(TAKA[:4])])
    frappes(b, mix, beat, [(1.0, "bois_haut", 110), (1.5, "bois_bas", 115)])
    boum(b, mix, 2 * beat, timb=False)
    b["bois_haut"].jouer(mix, 2.5 * beat, 90)
    return mix


def p5_double(b):
    """P5 : deux phrases. « ta-ka-ta-ka boum » moyen, puis « ta-ka-ta-ka BOUM » avec le gong."""
    beat = 60 / 112
    mix = np.zeros((SR * 5, 2), np.float32)
    frappes(b, mix, beat, [(i / 4, nom, 70 + 6 * i) for i, nom in enumerate(TAKA[:4])])
    frappes(b, mix, beat, [(1.0, "tumba", 110)])
    b["gc"].jouer(mix, 1.0 * beat, 95, coupe=0.6)
    frappes(b, mix, beat, [(2 + i / 4, nom, 90 + 8 * i) for i, nom in enumerate(TAKA[4:])])
    boum(b, mix, 3 * beat, gong=127)
    return mix


# --- d'après la référence (106 BPM, doubles croches, accents sur les temps puis en 3-3-2) -------

DC = 60 / 106 / 4  # une double croche


def taka(b, mix, t0, positions, accents, vel0, vel1, grave=True):
    """Doubles croches de congas : les accents vont sur la tumba (grave) doublée d'une grosse caisse
    légère, les autres coups alternent quinto et conga."""
    k = max(positions) if positions else 1
    for i, pos in enumerate(positions):
        v = vel0 + (vel1 - vel0) * pos / max(1, k)
        t = max(0.0, t0 + pos * DC + rng.normal(0, 0.004))
        if pos in accents:
            b["tumba"].jouer(mix, t, int(min(127, v + 18)))
            b["conga"].jouer(mix, t, int(min(127, v + 5)))
            if grave:
                b["gc"].jouer(mix, t, int(min(127, v)), coupe=0.5)
        else:
            b["quinto" if i % 2 == 0 else "conga"].jouer(mix, t, int(v - 10))


def impact(b, mix, t, vel=127):
    """Coup tutti grave, sans gong : grosse caisse, timbale, tumba, conga, tambour en bois grave."""
    b["gc"].jouer(mix, t, vel, coupe=1.8)
    timbale(b, mix, t, n("C2"), vel - 5, coupe=1.5)
    b["tumba"].jouer(mix, t, vel)
    b["conga"].jouer(mix, t, vel - 10)
    b["bois_bas"].jouer(mix, t, vel - 5)


def r1_depart(b):
    """R1 (début de partie) : les tout premiers coups de la référence, « ta-ka-ta-ka-ta-ka-ta (ka)
    TA », puis l'impact."""
    mix = np.zeros((SR * 5, 2), np.float32)
    taka(b, mix, 0, [0, 1, 2, 3, 4, 5, 6, 7], {0, 4}, 70, 105)
    impact(b, mix, 8 * DC)
    return mix


def r2_tresillo(b):
    """R2 : un temps de ta-ka-ta-ka, puis les accents en 3-3-2 qui montent, et l'impact."""
    mix = np.zeros((SR * 6, 2), np.float32)
    taka(b, mix, 0, list(range(4)), {0}, 70, 85)
    taka(b, mix, 4 * DC, list(range(8)), {0, 3, 6}, 85, 115)
    taka(b, mix, 12 * DC, list(range(8)), {0, 3, 6}, 100, 122)
    impact(b, mix, 20 * DC)
    return mix


def r3_tutti(b):
    """R3 (victoire) : deux temps de ta-ka-ta-ka, puis trois coups tutti en 3-3-2 « BOUM . . BOUM
    . . BOUM . » et le dernier, le plus fort."""
    mix = np.zeros((SR * 6, 2), np.float32)
    taka(b, mix, 0, list(range(8)), {0, 4}, 70, 110)
    for i, pos in enumerate((8, 11, 14)):
        impact(b, mix, pos * DC, 112 + 4 * i)
        if pos != 14:  # petit « ka » de conga dans le trou
            b["quinto"].jouer(mix, (pos + 2) * DC, 85)
    impact(b, mix, 16 * DC, 127)
    return mix


def r4_crescendo(b):
    """R4 : une mesure entière de ta-ka-ta-ka qui part de presque rien (comme la référence), grave
    qui arrive sur les accents, puis l'impact."""
    mix = np.zeros((SR * 6, 2), np.float32)
    taka(b, mix, 0, list(range(8)), {0, 4}, 45, 85, grave=False)
    taka(b, mix, 8 * DC, list(range(8)), {0, 3, 6}, 85, 120)
    impact(b, mix, 16 * DC)
    return mix


# --- mixage ------------------------------------------------------------------------------------


def reverb(mix, duree=1.3, humide=0.16):
    """Salle synthétique : bruit stéréo qui décroît, un peu assombri, 15 ms de pré-délai."""
    L = int(duree * SR)
    tt = np.arange(L) / SR
    ir = rng.standard_normal((L, 2)).astype(np.float32) * np.exp(-tt / (duree / 5))[:, None]
    noyau = np.ones(6) / 6
    ir = np.stack([np.convolve(ir[:, c], noyau, mode="same") for c in (0, 1)], axis=1)
    ir = np.concatenate([np.zeros((int(0.015 * SR), 2), np.float32), ir])
    ir /= np.sqrt((ir**2).sum(axis=0))
    N = 1 << int(np.ceil(np.log2(len(mix) + len(ir))))
    mouille = np.stack(
        [np.fft.irfft(np.fft.rfft(mix[:, c], N) * np.fft.rfft(ir[:, c], N), N) for c in (0, 1)],
        axis=1,
    )[: len(mix)]
    return mix + humide * mouille.astype(np.float32)


def exporter(nom, mix, longueur=3.0, integre=-14, fondu_d=0.6):
    os.makedirs(SORTIE, exist_ok=True)
    mix = reverb(mix)
    mix = mix / max(1e-9, np.abs(mix).max()) * 0.9
    wav = os.path.join(SORTIE, nom + ".wav")
    with wave.open(wav, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((mix * 32767).astype(np.int16).tobytes())
    fondu = longueur - fondu_d
    # échantillons d'orchestre pris de loin : on rend le grave et on creuse le médium
    filtre = (
        f"bass=g=7:f=100:w=0.7,equalizer=f=450:t=o:w=1.5:g=-3,"
        f"acompressor=threshold=-20dB:ratio=3:attack=8:release=180:makeup=2,"
        f"loudnorm=I={integre}:TP=-1:LRA=11,atrim=0:{longueur},afade=t=out:st={fondu}:d={fondu_d}"
    )
    for ext, codec in (
        ("ogg", ["-c:a", "libvorbis", "-q:a", "5"]),
        ("mp3", ["-c:a", "libmp3lame", "-q:a", "3"]),
    ):
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                wav,
                "-af",
                filtre,
                "-ar",
                "44100",
                *codec,
                os.path.join(SORTIE, f"{nom}.{ext}"),
            ],
            check=True,
        )
    os.remove(wav)
    print(os.path.join(SORTIE, nom + ".ogg"))


if __name__ == "__main__":
    b = banque()
    choix = sys.argv[2] if len(sys.argv) > 2 else ""
    for nom, f, duree in (
        ("R1-depart", r1_depart, 2.4),
        ("R2-tresillo", r2_tresillo, 3.6),
        ("R3-tutti", r3_tutti, 3.4),
        ("R4-crescendo", r4_crescendo, 3.4),
        ("P1-taka-lent", p1_taka_lent, 3.4),
        ("P2-appel-reponse", p2_appel_reponse, 3.0),
        ("P3-ternaire", p3_ternaire, 3.4),
        ("P4-taka-bois", p4_taka_bois, 2.8),
        ("P5-double", p5_double, 3.8),
        ("V1-victoire-tribale", victoire_tribale, 3.0),
        ("V2-victoire-marimba", victoire_marimba, 3.0),
        ("S1-debut-gong", debut_gong, 2.6),
        ("S2-debut-tambours-gong", debut_tambours_gong, 3.0),
    ):
        if nom.startswith(choix):
            exporter(nom, f(b), duree)
