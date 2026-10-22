"""Draft en ligne de MATATAK (livret, page 8 ; choix d'Hugo du 22/10/2026).

Le serveur tient tout l'état : la réserve tirée au hasard, les groupes, les choix et le placement.
Le navigateur n'envoie que des indices et des ordres, que l'on vérifie : il ne peut plus imposer une
position (AUDIT P1-6, les FEN du Draft venaient du client).

Déroulement (le premier joueur = les Blancs) :
1. PIONS_FORMER     les Blancs forment 2 groupes de 3 Pions (2 Pions restent de côté) ;
2. PIONS_CHOISIR    les Noirs en prennent un, les Blancs ont l'autre ;
3. CHAMPIONS_FORMER les Noirs forment 2 groupes de 2 Champions + 1 Roi (2 Champions de côté) ;
4. CHAMPIONS_CHOISIR les Blancs en prennent un, les Noirs ont l'autre ;
5. PLACEMENT        chacun échange ses Personnages d'une même rangée (le Roi reste sur sa case),
                    puis « Prêt » ; quand les deux sont prêts, la partie commence (FINI).
"""

from __future__ import annotations

import random
from itertools import combinations

from fairy.fairy_board import FairyBoard

PIONS = "abefgjlmpq"
CHAMPIONS = "cdhinorstwxyz"
ROIS = ("printemps", "ete", "automne", "hiver")  # MOJO, AZAR, SHANS, KARMA

PIONS_FORMER = "PIONS_FORMER"
PIONS_CHOISIR = "PIONS_CHOISIR"
CHAMPIONS_FORMER = "CHAMPIONS_FORMER"
CHAMPIONS_CHOISIR = "CHAMPIONS_CHOISIR"
PLACEMENT = "PLACEMENT"
FINI = "FINI"

# Qui agit à chaque étape (None : les deux joueurs, chacun pour son équipe)
ACTEUR = {
    PIONS_FORMER: "white",
    PIONS_CHOISIR: "black",
    CHAMPIONS_FORMER: "black",
    CHAMPIONS_CHOISIR: "white",
    PLACEMENT: None,
}


class DraftErreur(ValueError):
    pass


def etoiles(lettre: str) -> int:
    return FairyBoard.FORCE[lettre][1]


def autre(couleur: str) -> str:
    return "black" if couleur == "white" else "white"


class Draft:
    def __init__(self, variant: str, rng: random.Random | None = None):
        rng = rng or random.Random()
        self.mini = variant == "matatakmini"
        # Toujours au hasard (Hugo) : 8 Pions, 6 Champions, 2 Rois différents ; des doublons de
        # Pions ou de Champions sont possibles, la boîte a 4 exemplaires de chaque Personnage.
        self.pions = [rng.choice(PIONS) for _ in range(8)]
        self.champions = [rng.choice(CHAMPIONS) for _ in range(6)]
        self.rois = rng.sample(ROIS, 2)
        self.phase = PIONS_FORMER
        # Groupes formés : listes d'indices. Pour les Champions, 0-5 = self.champions, 6-7 = self.rois.
        self.groupes: dict[str, list[list[int]] | None] = {"pions": None, "champions": None}
        self.choix: dict[str, int | None] = {"pions": None, "champions": None}
        # Équipe de chaque camp, vue par son joueur, de gauche à droite :
        # pions = 3 lettres (rangée de devant), arriere = [Champion, "k", Champion], roi = Saison
        self.equipes: dict[str, dict | None] = {"white": None, "black": None}
        self.pret = {"white": False, "black": False}
        self.dernier: dict | None = None  # dernière action, pour l'afficher (choix de l'adversaire)

    # ---------- Actions ----------

    def acteur(self) -> str | None:
        return ACTEUR.get(self.phase)

    def _verifier(self, couleur: str, phase: str):
        if self.phase != phase:
            raise DraftErreur("Ce n'est pas l'étape %s" % phase)
        if ACTEUR[phase] is not None and ACTEUR[phase] != couleur:
            raise DraftErreur("Ce n'est pas à %s de jouer" % couleur)

    def former(self, couleur: str, groupes) -> None:
        if self.phase == PIONS_FORMER:
            self._verifier(couleur, PIONS_FORMER)
            self.groupes["pions"] = self._groupes_valides(groupes, range(8), taille=3)
            self.phase = PIONS_CHOISIR
            self.dernier = {"action": "former", "type": "pions", "couleur": couleur}
        elif self.phase == CHAMPIONS_FORMER:
            self._verifier(couleur, CHAMPIONS_FORMER)
            valides = self._groupes_valides(groupes, range(8), taille=3)
            for groupe in valides:
                if sum(1 for i in groupe if i >= 6) != 1:
                    raise DraftErreur("Chaque groupe a 2 Champions et 1 Roi")
            self.groupes["champions"] = valides
            self.phase = CHAMPIONS_CHOISIR
            self.dernier = {"action": "former", "type": "champions", "couleur": couleur}
        else:
            raise DraftErreur("Pas de groupe à former à l'étape %s" % self.phase)

    @staticmethod
    def _groupes_valides(groupes, indices, taille: int) -> list[list[int]]:
        try:
            valides = [[int(i) for i in groupe] for groupe in groupes]
        except (TypeError, ValueError):
            raise DraftErreur("Groupes illisibles")
        tous = [i for groupe in valides for i in groupe]
        if (
            len(valides) != 2
            or any(len(groupe) != taille for groupe in valides)
            or len(set(tous)) != len(tous)
            or any(i not in indices for i in tous)
        ):
            raise DraftErreur("Il faut 2 groupes de %d cartes différentes" % taille)
        return valides

    def choisir(self, couleur: str, groupe) -> None:
        if groupe not in (0, 1):
            raise DraftErreur("Groupe 0 ou 1")
        if self.phase == PIONS_CHOISIR:
            self._verifier(couleur, PIONS_CHOISIR)
            self.choix["pions"] = groupe
            self.phase = CHAMPIONS_FORMER
            self.dernier = {
                "action": "choisir",
                "type": "pions",
                "couleur": couleur,
                "groupe": groupe,
            }
        elif self.phase == CHAMPIONS_CHOISIR:
            self._verifier(couleur, CHAMPIONS_CHOISIR)
            self.choix["champions"] = groupe
            self.dernier = {
                "action": "choisir",
                "type": "champions",
                "couleur": couleur,
                "groupe": groupe,
            }
            self._composer_equipes()
            self.phase = PLACEMENT
        else:
            raise DraftErreur("Pas de groupe à choisir à l'étape %s" % self.phase)

    def _composer_equipes(self):
        # Les Noirs ont choisi les Pions, les Blancs les Champions ; chacun a l'autre groupe de l'autre étape
        pions = {
            "black": self.groupes["pions"][self.choix["pions"]],
            "white": self.groupes["pions"][1 - self.choix["pions"]],
        }
        champions = {
            "white": self.groupes["champions"][self.choix["champions"]],
            "black": self.groupes["champions"][1 - self.choix["champions"]],
        }
        for couleur in ("white", "black"):
            roi = next(i for i in champions[couleur] if i >= 6)
            autres = [self.champions[i] for i in champions[couleur] if i < 6]
            self.equipes[couleur] = {
                "pions": [self.pions[i] for i in pions[couleur]],
                "arriere": [autres[0], "k", autres[1]],
                "roi": self.rois[roi - 6],
            }

    def placer(self, couleur: str, pions, arriere) -> None:
        self._verifier(couleur, PLACEMENT)
        equipe = self.equipes[couleur]
        pions, arriere = list(pions or []), list(arriere or [])
        # On n'échange qu'à l'intérieur d'une rangée, et le Roi reste au milieu (sa case de départ)
        if sorted(pions) != sorted(equipe["pions"]):
            raise DraftErreur("Ce ne sont pas vos Pions")
        if len(arriere) != 3 or arriere[1] != "k" or sorted(arriere) != sorted(equipe["arriere"]):
            raise DraftErreur("Ce ne sont pas vos Champions, ou le Roi a bougé")
        equipe["pions"], equipe["arriere"] = pions, arriere
        self.pret[couleur] = True
        if all(self.pret.values()):
            self.phase = FINI

    # ---------- Ordinateur (Solo) ----------

    def jouer_ordinateur(self, couleur: str, rng: random.Random | None = None) -> None:
        """L'ordinateur fait son étape : groupes équilibrés en étoiles, choix du groupe le plus
        fort, placement tel quel."""
        rng = rng or random.Random()
        if self.phase == PIONS_FORMER:
            self.former(
                couleur,
                self._groupes_equilibres(list(range(8)), [etoiles(p) for p in self.pions], rng),
            )
        elif self.phase == CHAMPIONS_FORMER:
            forces = [etoiles(c) for c in self.champions]
            gardes = self._groupes_equilibres(list(range(6)), forces, rng, taille=2)
            self.former(couleur, [gardes[0] + [6], gardes[1] + [7]])
        elif self.phase in (PIONS_CHOISIR, CHAMPIONS_CHOISIR):
            type_ = "pions" if self.phase == PIONS_CHOISIR else "champions"
            noms = self.pions if type_ == "pions" else self.champions
            force = [sum(etoiles(noms[i]) for i in g if i < len(noms)) for g in self.groupes[type_]]
            self.choisir(couleur, 0 if force[0] >= force[1] else 1)
        elif self.phase == PLACEMENT and not self.pret[couleur]:
            equipe = self.equipes[couleur]
            self.placer(couleur, equipe["pions"], equipe["arriere"])

    @staticmethod
    def _groupes_equilibres(indices, forces, rng, taille: int = 3) -> list[list[int]]:
        """Garde les 2 * taille cartes les plus fortes (un peu de hasard à égalité), puis les répartit
        pour que les deux groupes aient le même nombre d'étoiles, ou presque."""
        melange = indices[:]
        rng.shuffle(melange)
        gardes = sorted(melange, key=lambda i: -forces[i])[: 2 * taille]
        meilleur = None
        for groupe in combinations(gardes, taille):
            reste = [i for i in gardes if i not in groupe]
            ecart = abs(sum(forces[i] for i in groupe) - sum(forces[i] for i in reste))
            if meilleur is None or ecart < meilleur[0]:
                meilleur = (ecart, list(groupe), reste)
        return [meilleur[1], meilleur[2]]

    # ---------- Position de départ ----------

    def fen(self) -> str:
        """Les cases de départ du livret : 8x8 Roi en e1 (Champions d1, f1, Pions d2-f2) ; Mini
        Roi en c1 (Champions b1, d1, Pions b2-d2). Les Noirs sont tournés d'un demi-tour."""
        blanc, noir = self.equipes["white"], self.equipes["black"]
        b_arr = "".join(blanc["arriere"]).upper()
        b_pions = "".join(blanc["pions"]).upper()
        n_arr = "".join(reversed(noir["arriere"])).lower()
        n_pions = "".join(reversed(noir["pions"])).lower()
        if self.mini:
            rangees = [n_arr + "1", n_pions + "1", "4", "4", "4", "4", "1" + b_pions, "1" + b_arr]
        else:
            rangees = (
                ["2" + n_arr + "3", "2" + n_pions + "3"]
                + ["8"] * 4
                + ["3" + b_pions + "2", "3" + b_arr + "2"]
            )
        return "/".join(rangees) + " w - - 0 1"

    # ---------- Pour le navigateur ----------

    def etat(self) -> dict:
        return {
            "phase": self.phase,
            "acteur": self.acteur(),
            "pions": self.pions,
            "champions": self.champions,
            "rois": self.rois,
            "etoiles": {lettre: etoiles(lettre) for lettre in set(self.pions + self.champions)},
            "groupes": self.groupes,
            "choix": self.choix,
            "equipes": self.equipes,
            "pret": self.pret,
            "dernier": self.dernier,
            "fen": self.fen() if self.phase == FINI else None,
        }


def tourner(fen: str) -> str:
    """Même position vue de l'autre côté : chaque joueur garde son équipe quand les couleurs
    s'échangent (revanche d'un Draft, « Gardez vos équipes et enchaînez ! »)."""
    placement = fen.split(" ")[0].split("[")[0]
    rangees = [r[::-1].swapcase() for r in reversed(placement.split("/"))]
    return "/".join(rangees) + " w - - 0 1"
