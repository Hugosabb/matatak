import json
from pathlib import Path

import aiohttp_jinja2
from aiohttp import web

import boutique
import relais
from lang import LOCALE

SAISONS = tuple(boutique.SAISONS.items())

# Biome de chaque extension (skill matatak) ; sa règle n'est pas sur cette page, seulement ce qu'est un Biome (Hugo, 20/11)
BIOMES = {"printemps": "Forêt", "ete": "Acide", "automne": "Tunnel", "hiver": "Glace"}
COLLECTION = Path(__file__).resolve().parents[2] / "static" / "data" / "collection.json"


def _extensions():
    """Les 4 extensions : nom, Personnages (Collection, « boite: extension ») et Biome."""
    try:
        persos = json.loads(COLLECTION.read_text(encoding="utf-8"))["personnages"]
    except (OSError, ValueError, KeyError):
        persos = []
    ordre_echecs = {"dame": 0, "tour": 1, "fou": 2, "cavalier": 3}

    def cartes(cle):
        """Les cartes qui sortent du sachet, avec leurs deux faces (sombre devant, claire au dos ; le Biome a pour
        dos les feuilles de la boîte) : le nouveau Champion, le nouveau Pion, les 3 des échecs, puis le Biome.
        """
        siens = [p for p in persos if p.get("boite") == "extension" and p.get("saison") == cle]

        # ordre (Hugo, 20/11) : le nouveau Champion, le nouveau Pion, les Personnages des échecs, puis le Biome
        def rang(p):
            if p.get("echecs") in ordre_echecs:
                return (2, ordre_echecs[p["echecs"]])
            return (0 if p.get("rang") == "champion" else 1, 0)

        siens.sort(key=lambda p: (rang(p), p["nom"]))
        col = "/static/images/background/collection/"
        pre = "/static/images/background/precommande/"
        # 720 px sur les écrans fins (comme l'Aventure) : une carte qui bouge est dessinée une fois, autant qu'elle soit nette
        faces = [
            {
                "avant": col + "sombre/" + p["image"],
                "avant2x": col + "sombre-720/" + p["image"],
                "dos": col + "clair/" + p["image"],
                "dos2x": col + "clair-720/" + p["image"],
            }
            for p in siens
        ]
        biome = pre + "biome-%s.webp" % cle
        dos = pre + "biome-dos.webp"
        return faces + [{"avant": biome, "avant2x": biome, "dos": dos, "dos2x": dos}]

    return [
        {
            "cle": cle,
            "nom": nom,
            "cartes": cartes(cle),
            "personnages": sorted(
                p["nom"] for p in persos if p.get("boite") == "extension" and p.get("saison") == cle
            ),
            "biome": BIOMES[cle],
        }
        for cle, nom in SAISONS
    ]


def euros(montant):
    """25 -> « 25 € », 8.9 -> « 8,90 € » (espace insécable)."""
    if abs(montant - round(montant)) < 0.005:
        return "%d €" % round(montant)
    return ("%.2f €" % montant).replace(".", ",")


def _prix():
    # Prix et conditions : fichier privé (dépôt site-prive, copié par outils/assets-depuis-jeu.sh), pas dans ce dépôt
    try:
        return boutique.lire_prix()
    except (OSError, ValueError):
        raise web.HTTPNotFound()


@aiohttp_jinja2.template("page_precommande.html")
async def precommande(request):
    """Page de précommande du jeu de société ; le paiement passe par Stripe Checkout (server/boutique.py)."""
    prix = _prix()
    ext = prix["extension"]
    jeu = prix["jeu"]
    packs = prix["packs"]
    # packs à prix réduit ; les extensions à l'unité n'ont pas de remise (choix d'Hugo, 20/11)
    offres = {
        "jeu": {"prix": euros(jeu)},
        "deux": {
            "prix": euros(packs["jeu_deux"]),
            "eco": euros(jeu + 2 * ext - packs["jeu_deux"]),
        },
        "quatre": {
            "prix": euros(packs["jeu_quatre"]),
            "eco": euros(jeu + 4 * ext - packs["jeu_quatre"]),
        },
    }
    return {
        "lang": LOCALE.get(),
        "title": "Précommander MATATAK",
        "prix": prix,
        "prix_json": json.dumps(prix),
        "offres": offres,
        "saisons": SAISONS,
        "extensions": _extensions(),
        "euros": euros,
        "paiement_ouvert": bool(boutique.cle_stripe()),
        "ext_dispo": boutique.extensions_dispo(prix),
        "relais_actif": relais.actif(),
        "offre": boutique.offre_newsletter(prix),
        "consentement": boutique.CONSENTEMENT,
        "consentement_prevenir": boutique.CONSENTEMENT_PREVENIR,
        "annule": "annule" in request.query,
    }


@aiohttp_jinja2.template("page_precommande_merci.html")
async def merci(request):
    """Retour de Stripe après le paiement. La commande est enregistrée par le webhook, parfois quelques
    secondes après : sans elle, on remercie quand même (Stripe n'envoie ici qu'après un paiement accepté).
    """
    prix = _prix()
    commande = await boutique.commande(request, request.query.get("session_id", ""))
    lignes = []
    if commande:
        noms = {"jeu": "MATATAK, le jeu", "quatre": "Le jeu + les 4 extensions"}
        for ligne in commande.get("panier", []):
            cle = ligne["cle"]
            if cle.startswith("deux:"):
                a, b = cle[5:].split(",")
                nom = "Le jeu + 2 extensions (%s, %s)" % (boutique.SAISONS[a], boutique.SAISONS[b])
            elif cle.startswith("ext:"):
                nom = "Extension " + boutique.SAISONS[cle[4:]]
            else:
                nom = noms[cle]
            lignes.append({"nom": nom, "n": ligne["n"]})
    return {
        "lang": LOCALE.get(),
        "title": "Merci ! · MATATAK",
        "prix": prix,
        "commande": commande,
        "lignes": lignes,
        "euros": euros,
    }
