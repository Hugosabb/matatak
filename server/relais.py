"""Points relais Chronopost proches d'une adresse, pour que le client choisisse le sien AVANT de payer (Stripe
Checkout ne sait pas le faire). Demande d'Hugo (24/11) : comme sur chronopost.fr, on donne son adresse, puis on
choisit parmi les relais proches.

    GET /precommande/relais?cp=14000&ville=Caen&adresse=13 rue de Bras  ->  {"relais": [...]}

La recherche passe par notre serveur : la page ne charge rien depuis un autre site (promesse de /confidentialite).
Pas de carte pour la même raison (les tuiles d'une carte viendraient d'ailleurs) : une liste, triée par distance.

Service web Chronopost « PointRelaisServiceWS », méthode recherchePointChronopostInter (appel GET de CXF). Il faut
un compte Chronopost : celui du Pion Magique (Hugo, 24/11, à voir avec eux). Réglages, hors du dépôt :
    CHRONOPOST_COMPTE, CHRONOPOST_MOT_DE_PASSE
⚠️ Les noms des paramètres et des champs de la réponse viennent de modules publics qui utilisent ce service
(Thelia, PrestaShop) : à vérifier au premier essai avec le vrai compte (lecture tolérante ci-dessous).

Sans compte : de faux relais sur le serveur de test (PROD faux) pour voir l'écran ; en prod, la recherche est
fermée et le paiement se fait comme avant (adresse demandée par Stripe).
"""

from __future__ import annotations

import logging
import os
import re
import xml.etree.ElementTree as ET
from datetime import date, timedelta

import aiohttp
from aiohttp import web

from settings import PROD

log = logging.getLogger(__name__)

ADRESSE_WS = (
    "https://ws.chronopost.fr/recherchebt-ws-cxf/PointRelaisServiceWS/recherchePointChronopostInter"
)
CP = re.compile(r"^\d{5}$")
ID_RELAIS = re.compile(r"^[A-Za-z0-9]{1,12}$")
JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]


def identifiants() -> tuple[str, str] | None:
    compte = os.environ.get("CHRONOPOST_COMPTE", "").strip()
    mot_de_passe = os.environ.get("CHRONOPOST_MOT_DE_PASSE", "")
    return (compte, mot_de_passe) if compte and mot_de_passe else None


def actif() -> bool:
    """Le choix du relais est proposé : vrai compte, ou faux relais hors de la prod."""
    return identifiants() is not None or not PROD


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _texte(el, *noms) -> str:
    for enfant in el:
        if _local(enfant.tag) in noms and (enfant.text or "").strip():
            return enfant.text.strip()
    return ""


def lire_reponse(xml: str) -> list[dict]:
    """Les relais d'une réponse du service (XML SOAP), quels que soient les espaces de noms."""
    racine = ET.fromstring(xml)
    relais = []
    for el in racine.iter():
        if _local(el.tag) != "listePointRelais":
            continue
        ident = _texte(el, "identifiant")
        if not ident:
            continue
        horaires = []
        for h in el:
            if _local(h.tag) != "listeHoraireOuverture":
                continue
            jour = _texte(h, "jour")
            plages = [
                _texte(p, "debut") + "–" + _texte(p, "fin")
                for p in h
                if _local(p.tag) == "listeHoraireOuverture" and _texte(p, "debut")
            ]
            texte = _texte(h, "horairesAsString")
            if jour.isdigit() and 1 <= int(jour) <= 7:
                horaires.append([JOURS[int(jour) - 1], texte or " · ".join(plages)])
        distance = _texte(el, "distanceEnMetre")
        relais.append(
            {
                "id": ident,
                "nom": _texte(el, "nom"),
                "adresse": " ".join(
                    x for x in (_texte(el, "adresse1"), _texte(el, "adresse2")) if x
                ),
                "code_postal": _texte(el, "codePostal"),
                "ville": _texte(el, "localite"),
                "distance": int(distance) if distance.isdigit() else None,
                "horaires": horaires,
            }
        )
    relais.sort(key=lambda r: r["distance"] if r["distance"] is not None else 10**9)
    return relais


def faux_relais(cp: str, ville: str) -> list[dict]:
    """Pour le serveur de test (pas de compte Chronopost) : 5 relais inventés autour de l'adresse."""
    noms = [
        "Tabac de la Gare",
        "Librairie du Centre",
        "Pressing des Halles",
        "Épicerie Fine",
        "Fleurs & Cie",
    ]
    return [
        {
            "id": "ESSAI%d" % (k + 1),
            "nom": "%s (exemple)" % n,
            "adresse": "%d rue de l'Exemple" % (3 + 7 * k),
            "code_postal": cp,
            "ville": ville or "Ville",
            "distance": 250 + 420 * k,
            "horaires": [[j, "9:00–12:30 · 14:00–19:00"] for j in JOURS[:6]],
        }
        for k, n in enumerate(noms)
    ]


async def chercher(cp: str, ville: str, adresse: str = "") -> list[dict]:
    ids = identifiants()
    if ids is None:
        return [] if PROD else faux_relais(cp, ville)
    demain = (date.today() + timedelta(days=1)).strftime("%d/%m/%Y")
    params = {
        "accountNumber": ids[0],
        "password": ids[1],
        "address": adresse,
        "zipCode": cp,
        "city": ville,
        "countryCode": "FR",
        "type": "P",
        "productCode": "86",  # Chrono Relais ⚠️ à confirmer avec le contrat
        "service": "T",
        "weight": "1500",  # grammes : une boîte (⚠️ à peser)
        "shippingDate": demain,
        "maxPointChronopost": "10",
        "maxDistanceSearch": "15",
        "holidayTolerant": "1",
        "language": "FR",
        "version": "2.0",
    }
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as s:
        async with s.get(ADRESSE_WS, params=params) as rep:
            texte = await rep.text()
            if rep.status != 200:
                raise RuntimeError("Chronopost %s" % rep.status)
    return lire_reponse(texte)


async def recherche(request: web.Request) -> web.Response:
    cp = request.query.get("cp", "").strip()
    ville = request.query.get("ville", "").strip()[:60]
    adresse = request.query.get("adresse", "").strip()[:120]
    if not CP.match(cp):
        return web.json_response({"erreur": "Code postal à 5 chiffres."}, status=400)
    if not actif():
        return web.json_response({"erreur": "Choix du relais indisponible."}, status=503)
    try:
        trouves = await chercher(cp, ville, adresse)
    except (RuntimeError, aiohttp.ClientError, TimeoutError, ET.ParseError) as e:
        log.error("Relais Chronopost : %s", e)
        return web.json_response(
            {"erreur": "La recherche des relais ne répond pas. Réessayez dans un instant."},
            status=502,
        )
    return web.json_response({"relais": trouves[:10], "exemple": identifiants() is None})


def relais_valide(r) -> dict | None:
    """Le relais choisi, envoyé par la page avec le panier : seulement des champs courts et attendus."""
    if not isinstance(r, dict) or not ID_RELAIS.match(str(r.get("id", ""))):
        return None
    propre = {"id": str(r["id"])}
    for cle, n in (("nom", 80), ("adresse", 120), ("code_postal", 5), ("ville", 60)):
        v = r.get(cle, "")
        if not isinstance(v, str) or len(v) > n:
            return None
        propre[cle] = v.strip()
    if not CP.match(propre["code_postal"]):
        return None
    return propre
