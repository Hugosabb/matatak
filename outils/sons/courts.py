"""Sons courts de partie (coup, prise, échec, temps faible, tic, carte de la collection), plusieurs
variantes de chacun, avec la palette retenue.

Usage : python3 -I courts.py CHEMIN/VERS/VSCO-2-CE
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
from vsco import SR, np  # noqa: E402

SORTIE = os.path.join(ICI, "rendu-courts")


def exporter(
    nom,
    mix,
    longueur,
    crete_db=-1.0,
    eq="bass=g=5:f=100:w=0.7",
    salle=(0.6, 0.08),
    part_fondu=1 / 3,
):
    """Sons courts : crête fixée (pas de loudnorm, peu fiable sous une seconde), salle réglable
    (durée, part de réverbération), fondu sur la fin (part_fondu de la longueur)."""
    os.makedirs(SORTIE, exist_ok=True)
    mix = vsco.reverb(mix, duree=salle[0], humide=salle[1])[: int(longueur * SR)]
    fondu = int(len(mix) * part_fondu)
    mix[-fondu:] *= np.linspace(1, 0, fondu)[:, None] ** 2
    mix = mix / max(1e-9, np.abs(mix).max()) * 10 ** (crete_db / 20)
    wav = os.path.join(SORTIE, nom + ".wav")
    with wave.open(wav, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((mix * 32767).astype(np.int16).tobytes())
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
                eq,
                *codec,
                f"{wav[:-4]}.{ext}",
            ],
            check=True,
        )
    os.remove(wav)


def sons(j):
    """{nom: (fonction(mix), longueur, crête)}. Les temps sont en secondes."""

    def c(cle, t, vel, transpo=0.0):
        return (cle, t, vel, transpo)

    def jouer(*coups):
        def f(mix):
            for cle, t, vel, transpo in coups:
                j[cle].jouer(mix, t, vel, transpo=transpo)

        return f

    r = 0.07  # écart d'un « ta-ka » serré
    return {
        # coup : un seul « tok », discret (on l'entend à chaque coup)
        "coup-a-conga-etouffee": (jouer(c("tap_quinto", 0, 110)), 0.25, -1),
        "coup-b-conga-douce": (jouer(c("conga", 0, 75)), 0.25, -1),
        "coup-c-bongo-grave": (jouer(c("bongo_grave", 0, 90)), 0.25, -1),
        "coup-d-claves": (jouer(c("claves", 0, 80)), 0.2, -3),
        # prise : plus de poids, deux frappes serrées
        "prise-a-ta-KA": (jouer(c("tap_quinto", 0, 105), c("tumba", r, 120)), 0.45, -1),
        "prise-b-bongo-tumba-claves": (
            jouer(c("bongo_aigu", 0, 110), c("tumba", 0, 120), c("claves", 0, 100)),
            0.45,
            -1,
        ),
        "prise-c-grave": (
            jouer(c("quinto", 0, 100), c("ethnique_grave", r, 120), c("tumba", r, 110)),
            0.5,
            -1,
        ),
        # alternatives proches de la prise claquée (même traitement, à comparer)
        "prise-e-claves-tumba": (
            jouer(c("claves", 0, 115), c("tumba", 0, 122), c("ethnique_grave", 0, 110)),
            0.4,
            -1,
        ),
        # « tic-tic » : deux claves, le grave sur le premier ou le second
        "prise-e2-tic-tic-grave-2e": (
            jouer(
                c("claves", 0, 105),
                c("claves", r, 118),
                c("tumba", r, 122),
                c("ethnique_grave", r, 110),
            ),
            0.45,
            -1,
        ),
        "prise-e3-tic-tic-grave-1er": (
            jouer(
                c("claves", 0, 118),
                c("tumba", 0, 122),
                c("ethnique_grave", 0, 110),
                c("claves", r, 100),
            ),
            0.45,
            -1,
        ),
        "prise-e4-tic-tic-espace": (
            jouer(
                c("claves", 0, 105),
                c("claves", 0.11, 118),
                c("tumba", 0.11, 122),
                c("ethnique_grave", 0.11, 110),
            ),
            0.5,
            -1,
        ),
        # « tic-tic » sans le grave, ou joué dans le grave
        "prise-e5-tic-tic-claves-seules": (
            jouer(c("claves", 0, 110), c("claves", r, 120)),
            0.35,
            -1,
        ),
        "prise-e6-tic-tic-claves-graves": (
            jouer(c("claves", 0, 110, -7), c("claves", r, 120, -7)),
            0.4,
            -1,
        ),
        "prise-e7-tic-tic-claves-tres-graves": (
            jouer(c("claves", 0, 110, -12), c("claves", r, 120, -12)),
            0.4,
            -1,
        ),
        "prise-e8-toc-toc-tambours-graves": (
            jouer(
                c("tumba", 0, 110),
                c("ethnique_grave", 0, 100),
                c("tumba", r, 125),
                c("ethnique_grave", r, 115),
            ),
            0.45,
            -1,
        ),
        "prise-f-ka-TA-geant": (
            jouer(c("bongo_aigu", 0, 105), c("tumba", r, 122), c("geant_main", r, 118)),
            0.5,
            -1,
        ),
        "prise-g-TA-ka": (
            jouer(c("tumba", 0, 125), c("ethnique_grave", 0, 115), c("quinto", r, 110)),
            0.45,
            -1,
        ),
        "prise-h-ta-ka-BOUM": (
            jouer(c("bongo_aigu", 0, 100), c("bongo_grave", r, 105), c("tumba", 2 * r, 125)),
            0.55,
            -1,
        ),
        "prise-i-geant-claves": (
            jouer(c("geant_main", 0, 120), c("claves", 0, 110), c("quinto", 0, 100)),
            0.5,
            -1,
        ),
        # en deux temps : « je bouge » (conga douce) puis « je dégage l'autre » (tumba + bongo)
        "prise-k-deux-temps": (
            jouer(c("conga", 0, 95), c("tumba", 0.12, 122), c("bongo_aigu", 0.12, 108)),
            1.1,
            -1,
        ),
        "prise-j-seche": (jouer(c("quinto", 0, 120), c("tumba", 0, 120)), 0.3, -1),
        "prise-d-claquee": (
            jouer(
                c("quinto", 0, 122),
                c("bongo_aigu", 0, 115),
                c("ethnique_grave", r, 120),
                c("tumba", r, 112),
            ),
            0.5,
            -1,
        ),
        # échec (« MATATAK ! ») : une alerte nette, qui se distingue d'un coup
        "echec-a-ta-ka-TA": (
            jouer(
                c("quinto", 0, 100),
                c("conga", r * 1.3, 105),
                c("tumba", r * 2.6, 125),
                c("geant_main", r * 2.6, 120),
            ),
            0.9,
            -1,
        ),
        "echec-b-claves-bongos": (
            jouer(
                c("claves", 0, 115),
                c("claves", r * 2, 115),
                c("bongo_aigu", r * 3, 105),
                c("bongo_grave", r * 4, 105),
                c("tumba", r * 5, 125),
            ),
            0.9,
            -1,
        ),
        "echec-c-mini-debut": (
            jouer(
                *[
                    c(k, i * r * 1.3, 90 + 8 * i)
                    for i, k in enumerate(["quinto", "conga", "quinto", "conga"])
                ],
                c("geant_main", 4 * r * 1.3, 127),
                c("tumba", 4 * r * 1.3, 120),
                c("tambourin", 4 * r * 1.3, 110),
            ),
            1.1,
            -1,
        ),
        # promotion : ça monte, du grave vers l'aigu (le Pion monte en grade)
        "promotion-a-montee": (
            jouer(
                *[
                    c(k, i * r, 95 + 6 * i)
                    for i, k in enumerate(["tumba", "conga", "quinto", "bongo_grave", "bongo_aigu"])
                ],
                c("claves", 5 * r, 120),
                c("tambourin", 5 * r, 115),
                c("bongo_aigu", 5 * r, 120),
            ),
            0.9,
            -1,
        ),
        "promotion-a-lente": (
            jouer(
                *[
                    c(k, i * 0.11, 95 + 6 * i)
                    for i, k in enumerate(["tumba", "conga", "quinto", "bongo_grave", "bongo_aigu"])
                ],
                c("claves", 0.55, 120),
                c("tambourin", 0.55, 115),
                c("bongo_aigu", 0.55, 120),
            ),
            1.15,
            -1,
        ),
        "promotion-b-montee-impact": (
            jouer(
                *[
                    c(k, i * r, 95 + 6 * i)
                    for i, k in enumerate(["tumba", "conga", "quinto", "bongo_grave", "bongo_aigu"])
                ],
                c("geant_main", 5 * r, 120),
                c("claves", 5 * r, 120),
                c("tambourin", 5 * r, 115),
            ),
            1.0,
            -1,
        ),
        "promotion-c-maracas": (
            jouer(
                *[c("maracas", i * 0.05, 70 + 7 * i) for i in range(8)],
                *[
                    c(k, 0.1 + i * 0.1, 95 + 8 * i)
                    for i, k in enumerate(["conga", "quinto", "bongo_aigu"])
                ],
                c("claves", 0.42, 120),
                c("tambourin", 0.42, 110),
            ),
            0.95,
            -1,
        ),
        # temps faible : un avertissement, une seule fois
        "temps-a-tambourin-claves": (
            jouer(c("tambourin", 0, 115), c("claves", 0.18, 115), c("claves", 0.36, 120)),
            0.8,
            -1,
        ),
        "temps-b-maracas-qui-monte": (
            jouer(*[c("maracas", i * 0.05, 70 + 7 * i) for i in range(8)], c("claves", 0.42, 120)),
            0.8,
            -1,
        ),
        # tic : le plus discret de tous (compte à rebours)
        "tic-a-claves": (jouer(c("claves", 0, 70)), 0.15, -8),
        "tic-b-bongo": (jouer(c("bongo_aigu", 0, 75)), 0.15, -8),
        "tic-c-conga-etouffee": (jouer(c("tap_quinto", 0, 100)), 0.15, -6),
        # collection : ouvrir une carte
        "carte-a-maracas-bongo": (
            jouer(c("maracas_secoue", 0, 100), c("bongo_aigu", 0.05, 80)),
            0.45,
            -4,
        ),
        "carte-b-tambourin": (jouer(c("tambourin", 0, 95)), 0.5, -5),
        "carte-c-tik-tok": (jouer(c("tap_quinto", 0, 100), c("claves", 0.09, 85)), 0.35, -4),
    }


if __name__ == "__main__":
    b = vsco.banque()
    ins = instruments(b)
    ins["tap_quinto"] = perc("Percussion/Quinto-Tap1_*.wav", gain=-4, pan=0.2)
    ins["maracas_secoue"] = perc("VSCO 1 Percussion/varWood/maraca_shake.wav", gain=-10)
    j = Jeu(b, ins)
    for nom, (f, longueur, crete) in sons(j).items():
        mix = np.zeros((SR * 2, 2), np.float32)
        f(mix)
        exporter(nom, mix, longueur, crete)
        print(nom)
