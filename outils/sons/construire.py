"""Fabrique le thème sonore « matatak » du site dans static/sound/matatak/.

Le dossier ne contient que les sons propres au thème (percussions composées ici avec VSCO 2
Community Edition, CC0) ; pour les autres (coup, tic…), client/sound.ts va chercher ceux du thème
« standard ».

Usage : python3 -I outils/sons/construire.py CHEMIN/VERS/VSCO-2-CE
"""

import os
import sys

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
import courts  # noqa: E402
import vsco  # noqa: E402
from catalogue import instruments, perc  # noqa: E402
from final import Jeu, debut, defaite, nulle, victoire_tresillo  # noqa: E402
from vsco import SR, np  # noqa: E402

SON = os.path.join(ICI, "..", "..", "static", "sound")
DEST = os.path.join(SON, "matatak")

# sons longs : volume intégré (LUFS) ; sons courts : crête en dB
LONGS = {
    "GenericNotify": (debut, 2.4, -18),
    "Victory": (victoire_tresillo, 3.2, -18),
    "Defeat": (defaite, 3.0, -20),
    "Draw": (nulle, 2.0, -20),
}
# la prise n'a pas le renfort de basses mais un peu de présence : sinon elle paraît plus discrète
# qu'un coup (son énergie était toute dans le grave)
PRESENCE = (
    "bass=g=-3:f=120,equalizer=f=2500:t=o:w=1.5:g=8,volume=8dB,alimiter=limit=0.89:level=false"
)
COURTS = {
    "Capture": ("prise-d-claquee", -1, PRESENCE),
    "Check": ("echec-a-ta-ka-TA", -1, None),
    "LowTime": ("temps-b-maracas-qui-monte", -1, None),
    "Promotion": ("promotion-a-lente", -1, None),
}

if __name__ == "__main__":
    os.makedirs(DEST, exist_ok=True)
    for ancien in os.listdir(DEST):  # repart de zéro : seuls les sons du thème restent
        os.remove(os.path.join(DEST, ancien))
    b = vsco.banque()
    ins = instruments(b)
    ins["tap_quinto"] = perc("Percussion/Quinto-Tap1_*.wav", gain=-4, pan=0.2)
    ins["maracas_secoue"] = perc("VSCO 1 Percussion/varWood/maraca_shake.wav", gain=-10)
    j = Jeu(b, ins)

    vsco.SORTIE = DEST
    for nom, (f, longueur, integre) in LONGS.items():
        vsco.exporter(nom, f(j), longueur, integre)

    courts.SORTIE = DEST
    catalogue = courts.sons(j)
    for nom, (cle, crete, eq) in COURTS.items():
        f, longueur, _ = catalogue[cle]
        mix = np.zeros((SR * 2, 2), np.float32)
        f(mix)
        courts.exporter(nom, mix, longueur, crete, **({"eq": eq} if eq else {}))
        print(os.path.join(DEST, nom + ".ogg"))

    with open(os.path.join(DEST, "license.txt"), "w") as fichier:
        fichier.write(
            f"{' '.join(list(LONGS) + list(COURTS))} : composés avec VSCO 2 Community "
            "Edition (CC0), https://versilian-studios.com/vsco-community/ ; scripts dans "
            "outils/sons/\n"
        )
    print(
        "Sons du thème (à recopier dans client/sound.ts, MATATAK_TRACKS) :",
        ", ".join(list(LONGS) + list(COURTS)),
    )
