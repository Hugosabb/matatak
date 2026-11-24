"""Précommande du jeu de société : paiement par Stripe Checkout, commandes enregistrées par webhook.

    POST /precommande/paiement   {"panier": [{"cle": "quatre", "n": 1}, ...]}  ->  {"url": <page Stripe>}
    POST /precommande/webhook    appelé par Stripe (signé) ; enregistre la commande dans la collection `commande`

Le panier vient du navigateur : on n'en garde que les clés connues et des quantités raisonnables, et les
montants viennent de Stripe (prix trouvés par lookup_key), comparés au fichier privé des prix affichés sur
la page (static/data/precommande.json) : si les deux diffèrent, on refuse plutôt que de faire payer un autre
prix que celui affiché.

Clés : variables d'environnement STRIPE_SECRET_KEY et STRIPE_WEBHOOK_SECRET, jamais dans le dépôt. Sans
elles, la page s'affiche mais « Passer au paiement » répond que le paiement n'est pas encore ouvert.
Pas de bibliothèque Stripe : deux appels HTTP (aiohttp) et une signature HMAC suffisent.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import time
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import aiohttp
from aiohttp import web

from pychess_global_app_state_utils import get_app_state
from settings import PROD, URI

log = logging.getLogger(__name__)

API = "https://api.stripe.com/v1"
# images déjà en ligne en prod (le serveur de test n'est pas joignable par Stripe, qui les télécharge)
# icône carrée (l'étoile et les yeux) : le logo large chevauchait la flèche de retour sur téléphone (Hugo, 20/11)
ICONE = "https://matatak.org/static/favicon/android-icon-512x512.png"
BOITE = "https://matatak.org/static/images/background/precommande/boite.jpg"  # JPG : Stripe ignore le WebP du site
MODES_LIVRAISON = ("relais", "retrait")
# Moyens de paiement montrés : carte (avec Apple Pay et Google Pay) et Link ; PayPal s'il est activé dans le
# tableau de bord. Retirés (décision d'Hugo, 20/11) : les moyens étrangers (on ne livre qu'en France) et ceux
# qui coûtent bien plus cher sans servir à des paniers de quelques dizaines d’euros (Klarna 4,99 % + 0,40 €, Amazon Pay).
MOYENS_EXCLUS = ("amazon_pay", "bancontact", "eps", "klarna", "mb_way", "satispay")
FICHIER_PRIX = Path(__file__).resolve().parents[1] / "static" / "data" / "precommande.json"
SAISONS = {"printemps": "Printemps", "ete": "Été", "automne": "Automne", "hiver": "Hiver"}
ORDRE_SAISONS = tuple(SAISONS)
N_MAX = 20  # par ligne
LIGNES_MAX = 12  # jeu, quatre, 6 paires de Saisons, 4 extensions
TOLERANCE_WEBHOOK = 300  # secondes : au-delà, une signature est trop vieille (rejeu)
EVENEMENTS = (
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
)


def cle_stripe() -> str:
    cle = os.getenv("STRIPE_SECRET_KEY", "")
    if not PROD and "_live_" in cle:
        # serveur de test : jamais de vrai paiement, même si une clé live traîne dans l'environnement
        return ""
    return cle


def secret_webhook() -> str:
    return os.getenv("STRIPE_WEBHOOK_SECRET", "")


def lire_prix() -> dict:
    return json.loads(FICHIER_PRIX.read_text(encoding="utf-8"))


def centimes(euros: float) -> int:
    return int(round(euros * 100))


# ---------- panier ----------


def lookup(cle: str) -> str:
    """Clé du panier -> lookup_key du prix Stripe."""
    if cle == "jeu":
        return "matatak_jeu"
    if cle == "quatre":
        return "matatak_jeu_quatre"
    if cle.startswith("deux:"):
        return "matatak_jeu_deux"
    return "matatak_ext_" + cle[4:]


def cle_valide(cle) -> bool:
    if not isinstance(cle, str):
        return False
    if cle in ("jeu", "quatre"):
        return True
    if cle.startswith("ext:"):
        return cle[4:] in SAISONS
    if cle.startswith("deux:"):
        paire = cle[5:].split(",")
        return (
            len(paire) == 2
            and all(s in SAISONS for s in paire)
            and ORDRE_SAISONS.index(paire[0]) < ORDRE_SAISONS.index(paire[1])
        )
    return False


def analyser_panier(lignes) -> list[tuple[str, int]]:
    """[(clé, quantité)] sans doublon, ou ValueError. La quantité est bornée (pas de commande de 10 000 jeux)."""
    if not isinstance(lignes, list) or not 0 < len(lignes) <= LIGNES_MAX:
        raise ValueError("panier")
    panier: dict[str, int] = {}
    for ligne in lignes:
        if not isinstance(ligne, dict):
            raise ValueError("ligne")
        cle, n = ligne.get("cle"), ligne.get("n")
        if (
            not cle_valide(cle)
            or not isinstance(n, int)
            or isinstance(n, bool)
            or not 0 < n <= N_MAX
        ):
            raise ValueError("ligne")
        panier[cle] = min(N_MAX, panier.get(cle, 0) + n)
    return list(panier.items())


def texte_panier(panier: list[tuple[str, int]]) -> str:
    """Panier en une ligne pour les métadonnées Stripe (500 caractères au plus) : « quatre*1;deux:ete,hiver*2 »."""
    return ";".join("%s*%d" % (cle, n) for cle, n in panier)


def lire_texte_panier(texte: str) -> list[dict]:
    lignes = []
    for morceau in (texte or "").split(";"):
        if "*" in morceau:
            cle, n = morceau.rsplit("*", 1)
            if cle_valide(cle) and n.isdigit():
                lignes.append({"cle": cle, "n": int(n)})
    return lignes


def nom_ligne(cle: str) -> str:
    if cle.startswith("deux:"):
        a, b = cle[5:].split(",")
        return "MATATAK, le jeu + 2 extensions (%s, %s)" % (SAISONS[a], SAISONS[b])
    return ""  # les autres gardent le nom du produit Stripe


def prix_affiche(prix: dict, cle: str) -> int:
    """Prix unitaire affiché sur la page, en centimes."""
    if cle == "jeu":
        return centimes(prix["jeu"])
    if cle == "quatre":
        return centimes(prix["packs"]["jeu_quatre"])
    if cle.startswith("deux:"):
        return centimes(prix["packs"]["jeu_deux"])
    return centimes(prix["extension"])


# ---------- Stripe ----------


def aplatir(valeur, prefixe: str = "") -> list[tuple[str, str]]:
    """{"a": {"b": [1, 2]}} -> [("a[b][0]", "1"), ("a[b][1]", "2")] : le format des formulaires de l'API Stripe."""
    if isinstance(valeur, dict):
        paires = []
        for k, v in valeur.items():
            paires += aplatir(v, "%s[%s]" % (prefixe, k) if prefixe else k)
        return paires
    if isinstance(valeur, (list, tuple)):
        paires = []
        for i, v in enumerate(valeur):
            paires += aplatir(v, "%s[%d]" % (prefixe, i))
        return paires
    if isinstance(valeur, bool):
        return [(prefixe, "true" if valeur else "false")]
    return [(prefixe, str(valeur))]


async def stripe(methode: str, chemin: str, params=None) -> dict:
    """Un appel à l'API Stripe ; lève RuntimeError avec le message de Stripe en cas d'erreur."""
    entetes = {"Authorization": "Bearer " + cle_stripe()}
    donnees = aplatir(params or {})
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as session:
        if methode == "GET":
            requete = session.get(API + chemin, params=donnees, headers=entetes)
        else:
            requete = session.post(API + chemin, data=donnees, headers=entetes)
        async with requete as rep:
            corps = await rep.json(content_type=None)
            if rep.status >= 400:
                raise RuntimeError(corps.get("error", {}).get("message", "erreur %d" % rep.status))
            return corps


async def prix_stripe(lookup_keys: list[str]) -> dict[str, dict]:
    """lookup_key -> prix Stripe actif."""
    rep = await stripe(
        "GET", "/prices", {"lookup_keys": sorted(set(lookup_keys)), "active": True, "limit": 20}
    )
    return {p["lookup_key"]: p for p in rep.get("data", [])}


def adresse_retour(request: web.Request) -> str:
    """Où Stripe renvoie le client : le site en prod ; en test, l'adresse tapée (téléphone sur le Wi-Fi)."""
    if PROD:
        return URI.rstrip("/")
    return str(request.url.origin())


async def creer_session(
    request: web.Request, panier: list[tuple[str, int]], mode: str = "relais", code: str = ""
) -> dict:
    prix = lire_prix()
    remise = remise_code(prix, code)
    remise_totale = 0
    stripe_prix = await prix_stripe([lookup(cle) for cle, _ in panier])
    lignes, articles = [], 0
    for cle, n in panier:
        p = stripe_prix.get(lookup(cle))
        attendu = prix_affiche(prix, cle)
        if p is None or p.get("unit_amount") != attendu or p.get("currency") != "eur":
            # la page afficherait un autre prix que celui payé : on n'ouvre pas le paiement
            log.error("Précommande : prix Stripe %s absent ou différent de la page", lookup(cle))
            raise RuntimeError("prix")
        articles += attendu * n
        if cle.startswith("deux:"):
            # le nom porte les 2 Saisons choisies (le client les voit sur la page de paiement)
            lignes.append(
                {
                    "quantity": n,
                    "price_data": {
                        "currency": "eur",
                        "unit_amount": attendu,
                        "tax_behavior": "inclusive",
                        "product_data": {
                            "name": nom_ligne(cle),
                            "images": [BOITE],
                            "metadata": {"matatak": cle},
                        },
                    },
                }
            )
        elif cle == "jeu" and remise:
            # code de l'offre (Hugo, 20/11) : une remise sur chaque Essentiel (le jeu seul) ; la ligne le dit
            remise_totale += remise * n
            lignes.append(
                {
                    "quantity": n,
                    "price_data": {
                        "currency": "eur",
                        "unit_amount": attendu - remise,
                        "tax_behavior": "inclusive",
                        "product_data": {
                            "name": "L'Essentiel : MATATAK, le jeu",
                            "description": "Code %s appliqué : %s économisés par jeu."
                            % (code.strip().upper(), euros_texte(remise)),
                            "images": [BOITE],
                            "metadata": {"matatak": "jeu", "code": code.strip().upper()},
                        },
                    },
                }
            )
        else:
            lignes.append({"quantity": n, "price": p["id"]})

    liv = prix["livraison"]
    retrait = prix.get("retrait") or {}
    if mode == "retrait":
        # retrait gratuit en boutique : pas d'adresse de livraison à demander
        nom = "Retrait gratuit à la boutique %s, %s" % (
            retrait.get("nom", "boutique"),
            retrait.get("ville", ""),
        )
        montant, etiquette = 0, "retrait"
    else:
        offerte = articles >= centimes(liv["offerte_des"])
        nom = liv["mode"] + (" : offerte" if offerte else "")
        montant = 0 if offerte else centimes(liv["prix"])
        etiquette = "offerte" if offerte else "payante"
    livraison = {
        "shipping_rate_data": {
            "type": "fixed_amount",
            "display_name": nom,
            "fixed_amount": {"amount": montant, "currency": "eur"},
            "tax_behavior": "inclusive",
            "metadata": {"matatak": etiquette},
        }
    }
    retour = adresse_retour(request)
    texte = texte_panier(panier)
    expedition = prix.get("dates", {}).get("objectif", "")
    params = {
        "mode": "payment",
        "locale": "fr",
        "line_items": lignes,
        "shipping_options": [livraison],
        # Chronopost prévient le client par SMS ; la boutique l'appelle quand le jeu est arrivé
        "phone_number_collection": {"enabled": True},
        "excluded_payment_method_types": list(MOYENS_EXCLUS),
        "allow_promotion_codes": True,  # autres codes (essais, partenaires) : chez Stripe
        # page de paiement aux couleurs du site (le logo doit être en ligne : Stripe le télécharge)
        "branding_settings": {
            "display_name": "MATATAK",
            "background_color": "#12100e",
            "button_color": "#eac45a",
            "font_family": "nunito",
            "border_style": "rounded",
            "icon": {"type": "url", "url": ICONE},
        },
        "success_url": retour + "/precommande/merci?session_id={CHECKOUT_SESSION_ID}",
        "cancel_url": retour + "/precommande?annule=1#panier",
        "metadata": {"panier": texte, "origine": "precommande", "livraison": mode},
        "payment_intent_data": {
            "description": "Précommande MATATAK",
            "metadata": {"panier": texte},
        },
    }
    if mode == "retrait":
        # nom du client pour le retrait (sans adresse de livraison, Stripe ne le demanderait pas)
        params["name_collection"] = {"individual": {"enabled": True}}
    else:
        params["shipping_address_collection"] = {"allowed_countries": ["FR"]}
    message = []
    if remise_totale:
        # un seul code à la fois : pas de second code à taper chez Stripe
        del params["allow_promotion_codes"]
        code = code.strip().upper()
        params["metadata"].update({"code": code, "remise": str(remise_totale)})
        params["payment_intent_data"]["description"] = "Précommande MATATAK, code %s (−%s)" % (
            code,
            euros_texte(remise_totale),
        )
        params["payment_intent_data"]["metadata"]["code"] = code
        message.append(
            "Code promo %s appliqué sur L'Essentiel : %s économisés."
            % (code, euros_texte(remise_totale))
        )
    if expedition:
        message.append(
            "Précommande : livraison %s. Vous recevrez un e-mail à chaque étape." % expedition
        )
    if message:
        params["custom_text"] = {"submit": {"message": " ".join(message)}}
    return await stripe("POST", "/checkout/sessions", params)


# ---------- offre de lancement contre l'inscription à la newsletter ----------

# un e-mail plausible, sans plus : on ne vérifie pas l'adresse (choix d'Hugo, 20/11 : le code est le même pour tous)
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}$")
CONSENTEMENT = (
    "En recevant votre code, vous vous abonnez à la newsletter de MATATAK : les nouvelles du jeu, "
    "désinscription en un clic. Vous avez 15 ans ou plus, ou l'accord d'un parent."
)


def euros_texte(montant: int) -> str:
    """400 -> « 4 € », 890 -> « 8,90 € » (montant en centimes)."""
    if montant % 100 == 0:
        return "%d €" % (montant // 100)
    return ("%.2f €" % (montant / 100)).replace(".", ",")


def jour_paris() -> date:
    return datetime.now(ZoneInfo("Europe/Paris")).date()


def _date(texte) -> date | None:
    try:
        return date.fromisoformat(texte)
    except (TypeError, ValueError):
        return None


def offre_newsletter(prix: dict, jour: date | None = None) -> dict | None:
    """Le palier en cours de l'offre de la newsletter, ou None quand elle est finie.

    `newsletter.paliers` : liste {code, remise, fin, fin_texte}, dans l'ordre ; le palier en cours est le premier
    dont la date de fin (incluse, heure de Paris) n'est pas passée. Dégressif seulement : un palier suivant ne
    rend jamais plus que le précédent (sinon la fin annoncée serait fausse : L121-4 du code de la consommation).
    Ancien format accepté : un seul palier écrit directement dans `newsletter`.
    """
    offre = prix.get("newsletter") or {}
    paliers = offre.get("paliers") or ([offre] if offre.get("code") else [])
    jour = jour or jour_paris()
    for palier in paliers:
        fin = _date(palier.get("fin"))
        if palier.get("code") and fin and jour <= fin:
            return palier
    return None


def remise_code(prix: dict, code: str, jour: date | None = None) -> int:
    """Remise par jeu seul (en centimes) si le code est valable aujourd'hui, sinon 0.

    Codes valables : celui du palier en cours de la newsletter, et les codes de `codes` (créateurs de contenu,
    partenaires : {code, remise, debut, fin, qui}) entre leur début et leur fin. Le code est vérifié ici, jamais
    par la page : le navigateur n'envoie que le texte tapé.
    """
    if not isinstance(code, str) or not code.strip():
        return 0
    code = code.strip().upper()
    jour = jour or jour_paris()
    valables = []
    offre = offre_newsletter(prix, jour)
    if offre:
        valables.append(offre)
    for c in prix.get("codes") or []:
        debut, fin = _date(c.get("debut")) or date.min, _date(c.get("fin"))
        if c.get("code") and fin and debut <= jour <= fin:
            valables.append(c)
    for c in valables:
        if code == c["code"].upper():
            return min(centimes(c.get("remise", 0)), centimes(prix["jeu"]))
    return 0


# ---------- routes ----------


async def paiement(request: web.Request) -> web.Response:
    """Crée la session Checkout du panier envoyé par la page et renvoie l'adresse de la page Stripe."""
    if not cle_stripe():
        return web.json_response({"erreur": "Le paiement n'est pas encore ouvert."}, status=503)
    try:
        corps = await request.json()
        panier = analyser_panier(corps.get("panier") if isinstance(corps, dict) else None)
        mode = corps.get("livraison", "relais")
        if mode not in MODES_LIVRAISON:
            raise ValueError("livraison")
        code = corps.get("code") or ""
        if not isinstance(code, str) or len(code) > 40:
            raise ValueError("code")
    except (ValueError, json.JSONDecodeError):
        return web.json_response({"erreur": "Panier invalide."}, status=400)
    if code and not remise_code(lire_prix(), code):
        # code tapé dans le panier mais plus valable (fin de l'offre entre-temps) : la page le retire
        return web.json_response(
            {
                "erreur": "Le code %s n'est plus valable." % code.strip().upper(),
                "code_refuse": True,
            },
            status=400,
        )
    try:
        session = await creer_session(request, panier, mode, code)
    except (RuntimeError, aiohttp.ClientError, TimeoutError) as e:
        log.error("Précommande : session Stripe refusée (%s)", e)
        return web.json_response(
            {
                "erreur": "Le paiement est indisponible pour le moment. Réessayez dans quelques minutes."
            },
            status=502,
        )
    return web.json_response({"url": session["url"]})


def signature_valide(
    corps: bytes, entete: str, secret: str, maintenant: float | None = None
) -> bool:
    """Vérifie l'en-tête Stripe-Signature (t=<horodatage>,v1=<HMAC-SHA256 de « t.corps »>)."""
    if not secret or not entete:
        return False
    morceaux = [m.split("=", 1) for m in entete.split(",") if "=" in m]
    horodatages = [v for k, v in morceaux if k == "t"]
    signatures = [v for k, v in morceaux if k == "v1"]
    if len(horodatages) != 1 or not horodatages[0].isdigit() or not signatures:
        return False
    t = int(horodatages[0])
    if abs((maintenant if maintenant is not None else time.time()) - t) > TOLERANCE_WEBHOOK:
        return False
    attendu = hmac.new(secret.encode(), b"%d." % t + corps, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(attendu, s) for s in signatures)


def commande_depuis_session(s: dict) -> dict:
    """Ce qu'on garde d'une session Checkout payée (voir docs/RGPD.md : données nécessaires à la livraison)."""
    client = s.get("customer_details") or {}
    # API récentes : collected_information.shipping_details ; anciennes : shipping_details
    livraison = (
        (s.get("collected_information") or {}).get("shipping_details")
        or s.get("shipping_details")
        or {}
    )
    cout = s.get("shipping_cost") or {}
    remises = (s.get("total_details") or {}).get("amount_discount", 0)
    return {
        "panier": lire_texte_panier((s.get("metadata") or {}).get("panier", "")),
        "mode_livraison": (s.get("metadata") or {}).get("livraison", "relais"),
        "total": s.get("amount_total"),
        "articles": s.get("amount_subtotal"),
        "livraison": cout.get("amount_total", 0),
        "remise": remises or int((s.get("metadata") or {}).get("remise") or 0),
        "code": (s.get("metadata") or {}).get("code"),
        "devise": s.get("currency"),
        "paiement": s.get("payment_status"),
        "payment_intent": s.get("payment_intent"),
        "email": client.get("email"),
        "telephone": client.get("phone"),
        "nom": livraison.get("name") or client.get("individual_name") or client.get("name"),
        "adresse": livraison.get("address") or client.get("address"),
        "test": not s.get("livemode", False),
    }


async def webhook(request: web.Request) -> web.Response:
    """Stripe nous dit qu'une session est payée (ou qu'un paiement différé a abouti ou échoué)."""
    corps = await request.read()
    if not signature_valide(corps, request.headers.get("Stripe-Signature", ""), secret_webhook()):
        return web.Response(status=400, text="signature")
    try:
        evenement = json.loads(corps)
    except ValueError:
        return web.Response(status=400, text="json")
    genre = evenement.get("type")
    session = (evenement.get("data") or {}).get("object") or {}
    if genre not in EVENEMENTS or session.get("object") != "checkout.session":
        return web.Response(text="ignoré")
    if (session.get("metadata") or {}).get("origine") != "precommande":
        return web.Response(text="ignoré")

    commande = commande_depuis_session(session)
    statut = {
        "checkout.session.completed": "payee" if commande["paiement"] == "paid" else "en_attente",
        "checkout.session.async_payment_succeeded": "payee",
        "checkout.session.async_payment_failed": "echouee",
    }[genre]
    maintenant = datetime.now(timezone.utc)
    db = get_app_state(request.app).db
    if db is None:
        log.error("Précommande : pas de base, commande %s non enregistrée", session.get("id"))
        return web.Response(status=503, text="base")
    # même session reçue deux fois (Stripe réessaie) : on met à jour, sans doublon
    await db.commande.update_one(
        {"_id": session["id"]},
        {
            "$set": {**commande, "statut": statut, "maj": maintenant},
            "$setOnInsert": {"cree": maintenant, "expedition": None},
            "$push": {"evenements": {"id": evenement.get("id"), "type": genre, "le": maintenant}},
        },
        upsert=True,
    )
    log.info("Précommande %s : %s", session["id"], statut)
    return web.Response(text="ok")


async def commande(request, session_id: str) -> dict | None:
    """La commande enregistrée pour cette session (page de remerciement), ou None si le webhook n'est pas encore passé."""
    db = get_app_state(request.app).db
    if db is None or not isinstance(session_id, str) or not session_id.startswith("cs_"):
        return None
    return await db.commande.find_one({"_id": session_id})


async def newsletter(request: web.Request) -> web.Response:
    """Inscription à la newsletter depuis la page de précommande ; renvoie le code de l'offre de lancement.

    L'adresse n'est pas vérifiée (le code est le même pour tous). On garde la preuve du consentement :
    la date et la phrase affichée. Un champ caché (« site ») attrape les robots.
    """
    try:
        corps = await request.json()
        email = (corps.get("email") or "").strip().lower() if isinstance(corps, dict) else ""
        robot = isinstance(corps, dict) and bool(corps.get("site"))
    except (ValueError, json.JSONDecodeError, AttributeError):
        return web.json_response({"erreur": "Adresse invalide."}, status=400)
    if not isinstance(email, str) or len(email) > 254 or not EMAIL.match(email):
        return web.json_response(
            {"erreur": "Cette adresse e-mail ne semble pas valide."}, status=400
        )
    try:
        offre = offre_newsletter(lire_prix())
    except (OSError, ValueError):
        offre = None
    if not robot:
        db = get_app_state(request.app).db
        if db is None:
            return web.json_response({"erreur": "Inscription indisponible."}, status=503)
        maintenant = datetime.now(timezone.utc)
        await db.newsletter.update_one(
            {"_id": email},
            {
                "$setOnInsert": {"inscrit_le": maintenant, "source": "precommande"},
                "$set": {
                    "consentement": CONSENTEMENT,
                    "consenti_le": maintenant,
                    "desinscrit": False,
                },
            },
            upsert=True,
        )
    if not offre:
        return web.json_response({"ok": True})
    return web.json_response(
        {"code": offre["code"], "remise": offre.get("remise", 0), "fin": offre.get("fin_texte", "")}
    )


async def verifier_code(request: web.Request) -> web.Response:
    """Le code tapé dans le panier : la remise par jeu seul s'il est valable, sinon un message."""
    try:
        corps = await request.json()
        code = corps.get("code") if isinstance(corps, dict) else ""
    except (ValueError, json.JSONDecodeError):
        code = ""
    if not isinstance(code, str) or not code.strip() or len(code) > 40:
        return web.json_response({"erreur": "Tapez votre code."}, status=400)
    try:
        prix = lire_prix()
    except (OSError, ValueError):
        return web.json_response({"erreur": "Codes indisponibles."}, status=503)
    remise = remise_code(prix, code)
    if not remise:
        return web.json_response(
            {
                "erreur": "Ce code n'existe pas ici. Un autre code promo se tape sur la page de paiement."
            },
            status=404,
        )
    return web.json_response({"code": code.strip().upper(), "remise": remise / 100})
