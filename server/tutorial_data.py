# Tutoriel du site, sur le plateau Mini : le minimum pour jouer, en 8 étapes (« vous », vocabulaire
# du livret). Chaque étape attend un coup précis (« moves », vérifié : une seule bonne réponse).
# « cible » (facultatif) = case à atteindre, entourée sur le plateau. En ligne, les symboles des cartes
# sont trop petits pour être lus (Hugo) : on apprend à toucher un Personnage pour voir ses cases.
# Ensuite : /collection#equipes (les 4 équipes de départ), puis la première partie.

CHAPITRES = {}

TUTORIAL_STEPS = {
    "1": {
        "id": "1",
        "variant": "matatakmini",
        "title": "Se déplacer",
        "fen": "4/4/4/4/4/4/1L2/4 w - - 0 1",
        "moves": "b2d4",
        "cible": "d4",
        "instruction": "Touchez BONGO : les cases où il peut aller s'allument. Puis touchez "
        "la case entourée.",
        "success_msg": "Bravo ! Touchez toujours un Personnage pour voir ses déplacements.",
    },
    "2": {
        "id": "2",
        "variant": "matatakmini",
        "title": "Capturer",
        "fen": "4/4/4/4/2g1/4/2F1/4 w - - 0 1",
        "moves": "c2c4",
        "instruction": "Les cartes retournées sont à votre adversaire. Arrêtez votre Personnage "
        "sur l'une d'elles pour la capturer : capturez BASS avec TAMTAM.",
        "success_msg": "Capturé ! Le Personnage adverse quitte le plateau.",
    },
    "3": {
        "id": "3",
        "variant": "matatakmini",
        "title": "Le Roi",
        "fen": "4/4/4/4/4/4/4/2K1 w - - 0 1",
        "moves": "c1b2",
        "cible": "b2",
        "instruction": "Voici votre Roi, reconnaissable à son cadre doré : il avance d'une case, "
        "dans toutes les directions. Amenez-le sur la case entourée.",
        "success_msg": "C'est lui qu'il faut protéger : toute la partie se joue autour des Rois.",
    },
    "4": {
        "id": "4",
        "variant": "matatakmini",
        "title": "MATATAK !",
        "fen": "k3/1mm1/4/4/4/1B2/2B1/1IK1 w - - 0 1",
        "moves": "b1a1",
        "instruction": "Menacer de capturer le Roi adverse, c'est le mettre en échec : on "
        "annonce « MATATAK ! ». Mettez le Roi adverse en échec.",
        "success_msg": "MATATAK ! Votre adversaire doit maintenant sauver son Roi.",
    },
    "5": {
        "id": "5",
        "variant": "matatakmini",
        "title": "Sortir de l'échec",
        "fen": "4/1k2/1m2/2m1/1B1c/2IK/4/4 w - - 0 1",
        "moves": "d3c2",
        "instruction": "Votre Roi est en échec : il ne peut pas y rester. Déplacez-le sur une "
        "case où il n'est plus menacé.",
        "success_msg": "Votre Roi est sauvé ! Un Roi ne finit jamais son tour en échec.",
    },
    "6": {
        "id": "6",
        "variant": "matatakmini",
        "title": "Échec et mat",
        "fen": "2k1/3m/2B1/4/4/4/4/I1K1 w - - 0 1",
        "moves": "a1a8",
        "instruction": "Si le Roi en échec ne peut plus s'échapper, c'est échec et mat : la "
        "partie est gagnée. Faites échec et mat.",
        "success_msg": "Échec et mat ! C'est la première façon de gagner.",
    },
    "7": {
        "id": "7",
        "variant": "matatakmini",
        "title": "La Colline",
        "fen": "4/1k2/1cm1/1m2/4/1BK1/4/1I2 w - - 0 1",
        "moves": "c3b4",
        "instruction": "La deuxième façon de gagner : amener votre Roi sur la Colline, les "
        "4 cases cerclées d'or, sans y être en échec. Montez sur la Colline.",
        "success_msg": "Le Mananas est à vous : la partie est gagnée !",
    },
    "8": {
        "id": "8",
        "variant": "matatakmini",
        "title": "Votre premier défi",
        "fen": "4/4/2k1/m2m/4/2K1/4/I3 w - - 0 1",
        "moves": "a1a5,c6b6,c3b4",
        "instruction": "Le Roi adverse vise la Colline ! Bloquez-le, puis gagnez en deux coups.",
        "success_msg": "Vous savez jouer à MATATAK ! Découvrez maintenant les 4 équipes de départ.",
    },
}
