"""Sons de partie Matatak avec la palette retenue par Hugo.

Ta-ka-ta-ka : congas (quinto / conga / tumba). Impacts : tambour géant (main), tambour ethnique
grave, tumba. Par-dessus : maracas, tambourin, claves, bongos. Défaite : timbale.

Usage : python3 -I final.py CHEMIN/VERS/VSCO-2-CE
"""

import os
import sys

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
import vsco  # noqa: E402
from catalogue import instruments  # noqa: E402
from vsco import DC, SR, n, np, timbale  # noqa: E402

vsco.SORTIE = os.path.join(ICI, "rendu-final")
TAKA = ["quinto", "conga", "quinto", "conga", "tumba", "conga", "tumba", "tumba"]


class Jeu:
    def __init__(self, b, ins):
        self.b, self.ins = b, ins

    def __getitem__(self, cle):
        return self.ins.get(cle) or self.b[cle]

    def coup(self, mix, cle, pos, vel, dc=DC):
        t = max(0.0, pos * dc + vsco.rng.normal(0, 0.004))
        self[cle].jouer(mix, t, int(np.clip(vel + vsco.rng.integers(-4, 5), 1, 127)))

    def taka(self, mix, debut, coups, vel0, vel1, dc=DC):
        for i in range(coups):
            v = vel0 + (vel1 - vel0) * i / max(1, coups - 1) + (12 if i % 4 == 0 else 0)
            self.coup(mix, TAKA[i % 8], debut + i, min(127, v), dc)

    def impact(self, mix, pos, vel=127, dc=DC):
        for cle, dv in (("geant_main", 0), ("ethnique_grave", -8), ("tumba", 0)):
            self.coup(mix, cle, pos, vel + dv, dc)


def debut(j):
    """Début de partie : ta-ka-ta-ka avec maracas, puis l'impact."""
    mix = np.zeros((SR * 4, 2), np.float32)
    j.taka(mix, 0, 8, 72, 105)
    for p in range(8):
        j.coup(mix, "maracas", p, 85 + 3 * p)
    j.impact(mix, 8)
    j.coup(mix, "tambourin", 8, 105)
    return mix


def victoire(j):
    """Victoire : deux mesures de ta-ka-ta-ka qui montent, claves en clave 3-2, bongos en
    contretemps, tambourin sur les temps, puis l'impact et une petite queue de maracas."""
    mix = np.zeros((SR * 5, 2), np.float32)
    j.taka(mix, 0, 16, 70, 112)
    for p in (0, 3, 6, 10, 12):  # clave 3-2
        j.coup(mix, "claves", p, 110)
    for p in (2, 6, 10, 14):
        j.coup(mix, "bongo_aigu", p, 105)
    for p in (0, 4, 8, 12):
        j.coup(mix, "tambourin", p, 100)
    for p in range(16):
        j.coup(mix, "maracas", p, 80 + 2 * p)
    j.impact(mix, 16)
    j.coup(mix, "claves", 16, 120)
    j.coup(mix, "tambourin", 16, 115)
    for p in (18, 19, 20):
        j.coup(mix, "maracas", p, 90 - 10 * (p - 18))
    return mix


def victoire_tresillo(j):
    """Victoire, variante : un temps de ta-ka-ta-ka, puis trois impacts en 3-3-2 avec claves et
    bongos dans les trous, et le dernier impact, plus fort."""
    mix = np.zeros((SR * 5, 2), np.float32)
    j.taka(mix, 0, 8, 72, 108)
    for p in range(8):
        j.coup(mix, "maracas", p, 85)
    for i, p in enumerate((8, 11, 14)):
        j.impact(mix, p, 110 + 5 * i)
        j.coup(mix, "claves", p, 115)
        j.coup(mix, "bongo_aigu", p + 1, 95)
        j.coup(mix, "bongo_grave", p + 2, 95)
    j.impact(mix, 16)
    j.coup(mix, "tambourin", 16, 118)
    return mix


def defaite(j):
    """Défaite : le ta-ka-ta-ka qui ralentit et s'éteint, puis deux timbales qui descendent
    (« pom... pom »)."""
    mix = np.zeros((SR * 5, 2), np.float32)
    t = 0.0
    for i in range(6):
        dc = DC * (1 + 0.22 * i)  # chaque coup un peu plus loin que le précédent
        j["quinto" if i % 2 == 0 else "conga"].jouer(mix, t, int(100 - 9 * i))
        t += dc
    timbale(j.b, mix, t + 0.08, n("C2"), 105, coupe=1.0)
    timbale(j.b, mix, t + 0.08 + 0.42, n("G1"), 112, coupe=1.6)
    return mix


def nulle(j):
    """Partie nulle : un ta-ka-ta-ka court, deux claves, une tumba moyenne. Ni joie ni tristesse."""
    mix = np.zeros((SR * 4, 2), np.float32)
    j.taka(mix, 0, 4, 80, 95)
    j.coup(mix, "claves", 4, 105)
    j.coup(mix, "claves", 6, 105)
    j.coup(mix, "tumba", 6, 105)
    j.coup(mix, "ethnique_grave", 6, 95)
    return mix


if __name__ == "__main__":
    b = vsco.banque()
    j = Jeu(b, instruments(b))
    for nom, f, duree in (
        ("1-debut", debut, 2.4),
        ("2-victoire", victoire, 3.4),
        ("3-victoire-tresillo", victoire_tresillo, 3.2),
        ("4-defaite", defaite, 3.0),
        ("5-nulle", nulle, 2.0),
    ):
        vsco.exporter(nom, f(j), duree)
