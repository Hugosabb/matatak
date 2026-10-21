"""Catalogue d'instruments : le même ta-ka-ta-ka de congas, plus un instrument à chaque fois.

I.. = l'instrument remplace le BOUM final ; C.. = l'instrument joue avec le ta-ka-ta-ka.
Tous les fichiers ont le même gain (pas de normalisation par fichier) pour comparer à l'oreille.

Usage : python3 -I catalogue.py CHEMIN/VERS/VSCO-2-CE
"""

import os
import subprocess
import sys
import wave

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
import vsco  # noqa: E402
from vsco import DC, SR, Percussion, fichiers, n, np, timbale  # noqa: E402

SORTIE = os.path.join(ICI, "catalogue")
V1 = "VSCO 1 Percussion/drums/"


def perc(*motifs, gain=0.0, pan=0.0):
    """Une seule nuance (la plus forte), les prises alternent."""
    fs = [f for m in motifs for f in fichiers(m)]
    assert fs, motifs
    return Percussion([fs], gain, pan)


def instruments(b):
    return {
        "gc_orchestre": b["gc"],
        "gc_vsco1": perc(V1 + "bass/bdrum_fff_*.wav"),
        "gc_etouffee": perc(V1 + "bass/bdrum_muted_fff_*.wav"),
        "geant_main": perc(V1 + "other/ethnic/giant/hand/EthnicLargeHand_hit_ff*.wav"),
        "geant_mailloche": perc(V1 + "other/ethnic/giant/mallet/EthnicLargeMallet_hit_ff*.wav"),
        "geant_baguettes": perc(V1 + "other/ethnic/giant/sticks/EthnicLargeSticks_hit_fff*.wav"),
        "ethnique_grave": perc(V1 + "other/ethnic/congo/open/ethnicLowOpen_hit_f*.wav", pan=-0.2),
        "ethnique_aigu": perc(
            V1 + "other/ethnic/congo/open/ethnicHighOpen_hit_f*.wav", gain=-4, pan=0.3
        ),
        "tom_tenor": perc(V1 + "tenor/tenor_lower/*_fff_*.wav"),
        "caisse_claire": perc(V1 + "snare/drum1/snare1_fff_*.wav", gain=-4),
        "cymbale": perc("Percussion/susCymb1-hit_f_*.wav", gain=-4),
        "enclume": perc("Percussion/Anvil_Hit1_v3*.wav", gain=-6),
        "claves": perc("Percussion/Claves1_Hit_v3_*.wav", gain=-8, pan=0.4),
        "cloche": perc("Percussion/Cowbell1_Hit_v3_*.wav", gain=-10, pan=0.3),
        "grelots": perc("Percussion/Sleighbells_Hit_*.wav", gain=-10, pan=-0.3),
        "guiro": perc("Percussion/Guiro-Hit_*.wav", gain=-8, pan=0.3),
        "bongo_aigu": perc(V1 + "other/Bongos/HighBongo*.wav", gain=-6, pan=0.4),
        "bongo_grave": perc(V1 + "other/Bongos/LowBongo*.wav", gain=-6, pan=0.3),
        "triangle": perc("Percussion/Triangle3-Hit_v2_*.wav", gain=-12, pan=0.4),
        "carillon": perc("Percussion/BellTree_Stroke1_*.wav", gain=-8),
    }


TAKA = ["quinto", "conga", "quinto", "conga", "tumba", "conga", "tumba", "tumba"]


def base(b, mix, coups=8):
    """Le ta-ka-ta-ka de S2, au tempo de la référence (106), congas seules."""
    for i in range(coups):
        nom = TAKA[i % 8]
        t = max(0.0, i * DC + vsco.rng.normal(0, 0.004))
        b[nom].jouer(mix, t, int(min(127, 72 + 5 * i + (12 if i % 4 == 0 else 0))))


def rendre(nom, mix, gain, longueur=2.8):
    os.makedirs(SORTIE, exist_ok=True)
    mix = vsco.reverb(mix) * gain
    wav = os.path.join(SORTIE, nom + ".wav")
    with wave.open(wav, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(mix, -1, 1) * 32767).astype(np.int16).tobytes())
    filtre = (
        f"bass=g=7:f=100:w=0.7,equalizer=f=450:t=o:w=1.5:g=-3,"
        f"alimiter=limit=0.95:level=false,atrim=0:{longueur},afade=t=out:st={longueur - 0.5}:d=0.5"
    )
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
            "-c:a",
            "libvorbis",
            "-q:a",
            "5",
            wav[:-4] + ".ogg",
        ],
        check=True,
    )
    os.remove(wav)


if __name__ == "__main__":
    b = vsco.banque()
    ins = instruments(b)
    pistes = {}

    def nouvelle():
        return np.zeros((SR * 4, 2), np.float32)

    # référence : le ta-ka-ta-ka seul
    m = nouvelle()
    base(b, m)
    pistes["00-taka-seul"] = m

    # I : l'instrument à la place du BOUM (sur le 9e coup)
    impacts = [
        ("gc_orchestre", "grosse-caisse-orchestre"),
        ("gc_vsco1", "grosse-caisse-2"),
        ("gc_etouffee", "grosse-caisse-etouffee"),
        (None, "timbale"),
        ("geant_main", "tambour-geant-main"),
        ("geant_mailloche", "tambour-geant-mailloche"),
        ("geant_baguettes", "tambour-geant-baguettes"),
        ("ethnique_grave", "tambour-ethnique-grave"),
        ("tom_tenor", "tom-tenor"),
        ("caisse_claire", "caisse-claire"),
        ("cymbale", "cymbale"),
        ("enclume", "enclume"),
        ("tumba", "tumba-seule"),
        ("bois_bas", "tambour-en-bois"),
    ]
    for k, (cle, nom) in enumerate(impacts, 1):
        m = nouvelle()
        base(b, m)
        if cle is None:
            timbale(b, m, 8 * DC, n("C2"), 127)
        else:
            (ins.get(cle) or b[cle]).jouer(m, 8 * DC, 127)
        pistes[f"I{k:02d}-{nom}"] = m

    # C : l'instrument joue avec le ta-ka-ta-ka, prolongé à 3 temps pour bien l'entendre
    accents = [0, 4, 8]

    def sur(positions, cle, vel=110):
        def f(m):
            for p in positions:
                (ins.get(cle) or b[cle]).jouer(m, p * DC, vel)

        return f

    couches = [
        ("maracas-doubles-croches", sur(range(12), "maracas", 100)),
        ("tambourin-sur-les-temps", sur(accents, "tambourin", 110)),
        ("claves-motif-clave", sur([0, 3, 6, 10], "claves")),
        ("cloche-sur-les-temps", sur(accents, "cloche")),
        ("grelots-sur-les-temps", sur(accents, "grelots")),
        ("guiro-sur-les-temps", sur(accents, "guiro")),
        ("bongos-en-contretemps", sur([2, 6, 10], "bongo_aigu")),
        ("tambour-en-bois-aigu-sur-accents", sur(accents, "bois_haut")),
        ("tambour-ethnique-aigu-sur-accents", sur(accents, "ethnique_aigu")),
        ("grosse-caisse-legere-sur-accents", sur(accents, "gc_orchestre", 85)),
        ("tambour-geant-main-sur-accents", sur(accents, "geant_main", 100)),
        ("tom-tenor-sur-accents", sur(accents, "tom_tenor", 95)),
        ("triangle-a-la-fin", sur([12], "triangle")),
        ("carillon-a-la-fin", sur([11], "carillon")),
    ]
    for k, (nom, f) in enumerate(couches, 1):
        m = nouvelle()
        base(b, m, coups=12)
        f(m)
        pistes[f"C{k:02d}-{nom}"] = m

    # même gain pour tous : la crête la plus forte du lot à -1 dB
    crete = max(np.abs(vsco.reverb(m)).max() for m in pistes.values())
    for nom, m in pistes.items():
        rendre(nom, m, 0.89 / crete)
        print(nom)
