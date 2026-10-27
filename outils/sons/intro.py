"""Intro du tutoriel : des tambours au loin qui se rapprochent, de plus en plus forts, jusqu'à
l'impact de « MATATAK ! » (texte du livret : « les tambours résonnent de plus en plus fort »).

Même palette que les sons du jeu (VSCO 2 CE, CC0) : tumba et tambour ethnique grave au loin, puis
les congas en ta-ka-ta-ka, accents en 3-3-2, et l'impact final (tambour géant + grave + tumba).

Usage : python3 -I outils/sons/intro.py CHEMIN/VERS/VSCO-2-CE
"""

import os
import subprocess
import sys
import wave

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
import vsco  # noqa: E402
from catalogue import instruments, perc  # noqa: E402
from final import Jeu  # noqa: E402
from vsco import DC, SR, np  # noqa: E402

SORTIE = os.path.join(ICI, "rendu-intro")
MESURE = 16  # doubles croches par mesure (106 à la noire, comme les autres sons)
CRI = 6 * MESURE  # l'impact de « MATATAK ! » : début de la 7e mesure, 13,6 s
TROIS_TROIS_DEUX = (0, 6, 12)  # accents de la mesure en 3-3-2 (en croches : 0, 3, 6)


def intro(j):
    mix = np.zeros((int(SR * (CRI * DC + 4)), 2), np.float32)
    # 1-2 : au loin, un cœur qui bat (tumba et tambour grave sur les temps, très doux)
    for m in range(2):
        for p in (0, 4, 8, 12):
            pos = m * MESURE + p
            vel = 34 + 6 * m + (8 if p == 0 else 0)
            j.coup(mix, "tumba", pos, vel)
            if p in (0, 8):
                j.coup(mix, "ethnique_grave", pos, vel - 6)
        for p in (2, 6, 10, 14):
            j.coup(mix, "maracas", m * MESURE + p, 40 + 8 * m)
    # 3-4 : les congas arrivent en ta-ka-ta-ka, accents en 3-3-2
    j.taka(mix, 2 * MESURE, 2 * MESURE, 52, 88)
    for m in (2, 3):
        for p in TROIS_TROIS_DEUX:
            j.coup(mix, "ethnique_grave", m * MESURE + p, 70 + 10 * (m - 2))
        for p in range(0, MESURE, 2):
            j.coup(mix, "maracas", m * MESURE + p, 60 + 10 * (m - 2))
    # 5-6 : tout le monde, de plus en plus fort ; tambour géant sur les accents, tambourin
    j.taka(mix, 4 * MESURE, 2 * MESURE, 90, 122)
    for m in (4, 5):
        for p in TROIS_TROIS_DEUX:
            j.coup(mix, "geant_main", m * MESURE + p, 96 + 12 * (m - 4))
        for p in (0, 4, 8, 12):
            j.coup(mix, "tambourin", m * MESURE + p, 90 + 10 * (m - 4))
        for p in range(MESURE):
            j.coup(mix, "maracas", m * MESURE + p, 75 + 10 * (m - 4))
    # fin de la 6e mesure : roulement des bongos qui monte
    for i in range(8):
        j.coup(mix, "bongo_aigu" if i % 2 else "bongo_grave", 5 * MESURE + 8 + i, 95 + 4 * i)
    # « MATATAK ! » : l'impact, avec claves et tambourin, puis, un temps après, le son de l'échec
    # du jeu (ta-ka-TA, courts.py « echec-a-ta-ka-TA », Hugo) et les maracas qui retombent
    j.impact(mix, CRI)
    j.coup(mix, "claves", CRI, 120)
    j.coup(mix, "tambourin", CRI, 115)
    t, r = (CRI + 4) * DC, 0.07
    for cle, dt, vel in (("quinto", 0, 100), ("conga", r * 1.3, 105), ("tumba", r * 2.6, 125), ("geant_main", r * 2.6, 120)):
        j[cle].jouer(mix, t + dt, vel)
    for i in range(6):
        j.coup(mix, "maracas", CRI + 8 + 2 * i, 75 - 10 * i)
    return au_loin(mix)


def au_loin(mix):
    """Les tambours se rapprochent : le volume monte de 16 dB jusqu'à l'impact, et le son, d'abord
    étouffé (aigus coupés), s'éclaircit."""
    t = np.arange(len(mix)) / SR
    avance = np.clip(t / (CRI * DC), 0, 1)
    gain = 10 ** (-16 * (1 - avance) ** 1.4 / 20)
    # passe-bas d'une pôle, coupure fixe ; on mélange étouffé et clair selon l'avancée
    a = np.exp(-2 * np.pi * 700 / SR)
    etouffe = np.empty_like(mix)
    y = np.zeros(2, np.float32)
    for k in range(len(mix)):
        y = (1 - a) * mix[k] + a * y
        etouffe[k] = y
    clair = avance[:, None]
    return (gain[:, None] * (clair * mix + (1 - clair) * etouffe * 1.6)).astype(np.float32)


def exporter(nom, mix, longueur, formats=("ogg", "mp3", "webm")):
    """Comme vsco.exporter, mais sans loudnorm : il écraserait la montée (le crescendo est le
    sujet). On ne règle que la crête."""
    os.makedirs(SORTIE, exist_ok=True)
    mix = vsco.reverb(mix, duree=2.2, humide=0.22)
    mix = mix / max(1e-9, np.abs(mix).max()) * 0.9
    wav = os.path.join(SORTIE, nom + ".wav")
    with wave.open(wav, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((mix * 32767).astype(np.int16).tobytes())
    fondu = longueur - 1.2
    filtre = (
        "bass=g=7:f=100:w=0.7,equalizer=f=450:t=o:w=1.5:g=-3,"
        f"alimiter=limit=0.89,atrim=0:{longueur},afade=t=out:st={fondu}:d=1.2"
    )
    codecs = {
        "ogg": ["-c:a", "libvorbis", "-q:a", "5"],
        "mp3": ["-c:a", "libmp3lame", "-q:a", "3"],
        "webm": ["-c:a", "libopus", "-b:a", "128k"],
    }
    for ext, codec in ((e, codecs[e]) for e in formats):
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-af", filtre, "-ar", "48000" if ext == "webm" else "44100", *codec, os.path.join(SORTIE, f"{nom}.{ext}")],
            check=True,
        )
    os.remove(wav)
    print(f"{nom} : impact à {CRI * DC:.2f} s ->", os.path.join(SORTIE, nom + ".ogg"))


LONGUEUR = CRI * DC + 3.2

if __name__ == "__main__":
    b = vsco.banque()
    ins = instruments(b)
    ins["tap_quinto"] = perc("Percussion/Quinto-Tap1_*.wav", gain=-4, pan=0.2)
    exporter("Intro", intro(Jeu(b, ins)), LONGUEUR)
