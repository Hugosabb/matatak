"""Un seul classement pour le Mini et le 8×8 (décision d'Hugo du 02/11/2026).

Les deux plateaux lisent et écrivent la même entrée de `perfs` (et du highscore) : « matatak ».
Pas de reprise des anciens classements Mini : personne n'avait encore joué en classé (Hugo).
"""

CLASSEMENT_UNIQUE = ("matatak", "matatakmini")
CLE_CLASSEMENT = "matatak"


def cle_perf(variant: str, chess960: bool = False) -> str:
    """Clé de `perfs` (et du highscore) d'une variante."""
    if variant in CLASSEMENT_UNIQUE:
        return CLE_CLASSEMENT
    return variant + ("960" if chess960 else "")
