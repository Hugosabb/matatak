"""E-mails aux clients de la précommande : confirmation de commande (avec les CGV, art. L221-13 du Code de la
consommation) et nouvelles à chaque étape (fabrication, expédition, retrait en boutique, retard).

Envoi par le serveur SMTP de contact@matatak.org (IONOS). Réglages : variables d'environnement, comme les clés
Stripe, jamais dans le dépôt :
    SMTP_HOTE (ex. smtp.ionos.fr), SMTP_PORT (465 par défaut, SSL), SMTP_UTILISATEUR, SMTP_MOT_DE_PASSE,
    COURRIEL_DE (par défaut « MATATAK <contact@matatak.org> »).
Sans elles, rien ne part : chaque e-mail est gardé dans la collection `courriel` avec le statut « en_attente »,
et `envoyer_en_attente` les enverra quand le SMTP sera réglé. Tout e-mail (envoyé ou non) y laisse une trace.

Les CGV viennent du dépôt privé (static/data/cgv.html, copié par outils/assets-depuis-jeu.sh) : la page /cgv et
la pièce jointe de la confirmation lisent le même fichier.
"""

from __future__ import annotations

import asyncio
import html
import logging
import os
import smtplib
import ssl
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path

import boutique

log = logging.getLogger(__name__)

FICHIER_CGV = Path(__file__).resolve().parents[1] / "static" / "data" / "cgv.html"
DE_DEFAUT = formataddr(("MATATAK", "contact@matatak.org"))
CONTACT = "contact@matatak.org"
SUIVI_CHRONOPOST = "https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=%s"


# ---------- réglages ----------


def reglages() -> dict | None:
    """Les réglages SMTP, ou None s'ils manquent (on garde alors les e-mails « en_attente »)."""
    hote = os.environ.get("SMTP_HOTE", "").strip()
    utilisateur = os.environ.get("SMTP_UTILISATEUR", "").strip()
    mot_de_passe = os.environ.get("SMTP_MOT_DE_PASSE", "")
    if not (hote and utilisateur and mot_de_passe):
        return None
    try:
        port = int(os.environ.get("SMTP_PORT", "465"))
    except ValueError:
        port = 465
    return {
        "hote": hote,
        "port": port,
        "utilisateur": utilisateur,
        "mot_de_passe": mot_de_passe,
        "de": os.environ.get("COURRIEL_DE", "").strip() or DE_DEFAUT,
    }


def cgv_html() -> str | None:
    try:
        return FICHIER_CGV.read_text(encoding="utf-8")
    except OSError:
        return None


# ---------- contenu ----------

NOMS = {
    "jeu": "MATATAK, le jeu",
    "quatre": "MATATAK, le jeu + les 4 extensions",
}


def nom_article(cle: str) -> str:
    if cle in NOMS:
        return NOMS[cle]
    if cle.startswith("deux:"):
        return boutique.nom_ligne(cle)
    if cle.startswith("ext:"):
        return "Extension %s" % boutique.SAISONS.get(cle[4:], cle[4:])
    return cle


def _lignes(commande: dict) -> list[str]:
    return [
        "%d × %s" % (ligne.get("n", 1), nom_article(ligne.get("cle", "")))
        for ligne in commande.get("panier", [])
    ]


def _livraison(commande: dict, prix: dict) -> str:
    if commande.get("mode_livraison") == "retrait":
        r = prix.get("retrait") or {}
        return (
            "Retrait gratuit à la boutique %s, %s, %s %s. Nous vous écrivons quand le jeu vous y attend."
            % (
                r.get("nom", ""),
                r.get("adresse", ""),
                r.get("code_postal", ""),
                r.get("ville", ""),
            )
        )
    relais = commande.get("relais") or {}
    if relais.get("nom"):
        return "Point relais Chronopost : %s, %s, %s %s." % (
            relais.get("nom"),
            relais.get("adresse", ""),
            relais.get("code_postal", ""),
            relais.get("ville", ""),
        )
    a = commande.get("adresse") or {}
    morceaux = [
        a.get("line1"),
        a.get("line2"),
        " ".join(x for x in (a.get("postal_code"), a.get("city")) if x),
    ]
    return "Chronopost, livraison à : %s." % ", ".join(m for m in morceaux if m)


def _montants(commande: dict) -> list[str]:
    e = boutique.euros_texte
    out = []
    if commande.get("articles") is not None:
        out.append("Articles : %s" % e(commande["articles"]))
    if commande.get("remise"):
        out.append(
            "Remise%s : −%s"
            % (
                " (code %s)" % commande["code"] if commande.get("code") else "",
                e(commande["remise"]),
            )
        )
    out.append(
        "Livraison : %s"
        % ("offerte" if not commande.get("livraison") else e(commande["livraison"]))
    )
    if commande.get("total") is not None:
        out.append("Total payé : %s TTC" % e(commande["total"]))
    return out


def _numero(commande: dict) -> str:
    """Numéro court lisible : les 8 derniers caractères de la session Stripe, en capitales."""
    return str(commande.get("_id", ""))[-8:].upper()


def _message(
    destinataire: str, sujet: str, paragraphes: list, de: str | None = None
) -> EmailMessage:
    """Texte brut + HTML sobre (aucune image ni ressource chargée d'ailleurs). Un paragraphe = une chaîne, ou une
    liste de lignes (affichées en liste)."""
    msg = EmailMessage()
    msg["Subject"] = sujet
    msg["From"] = de or DE_DEFAUT
    msg["To"] = destinataire
    msg["Reply-To"] = CONTACT
    msg["Message-ID"] = make_msgid(domain="matatak.org")
    texte, corps = [], []
    for p in paragraphes:
        if isinstance(p, list):
            texte.append("\n".join("  - " + x for x in p))
            corps.append("<ul>%s</ul>" % "".join("<li>%s</li>" % html.escape(x) for x in p))
        else:
            texte.append(p)
            corps.append("<p>%s</p>" % html.escape(p))
    msg.set_content("\n\n".join(texte) + "\n")
    msg.add_alternative(
        '<!DOCTYPE html><html lang="fr"><body style="font-family:Arial,sans-serif;font-size:15px;'
        'line-height:1.5;color:#241805;max-width:560px">%s</body></html>' % "".join(corps),
        subtype="html",
    )
    return msg


SIGNATURE = "À très vite sur le plateau,\nHugo, pour l'équipe MATATAK"


def confirmation(commande: dict, prix: dict) -> EmailMessage:
    """Confirmation de commande, avec les CGV en pièce jointe (support durable)."""
    objectif = (prix.get("dates") or {}).get("objectif") or "dès que possible"
    paragraphes = [
        "Bonjour %s," % (commande.get("nom") or ""),
        "Merci pour votre précommande de MATATAK ! Elle est bien enregistrée et payée.",
        "Commande n° %s :" % _numero(commande),
        _lignes(commande),
        _montants(commande),
        _livraison(commande, prix),
        "Livraison prévue : %s. Nous vous écrivons à chaque étape : fabrication, expédition, livraison."
        % objectif,
        "Vous pouvez changer d'avis : vous avez 14 jours après la réception pour nous retourner le jeu, et vous "
        "êtes remboursé. Nos conditions générales de vente sont jointes à cet e-mail.",
        "Une question ? Répondez simplement à cet e-mail (%s)." % CONTACT,
        SIGNATURE,
    ]
    msg = _message(
        commande.get("email", ""), "Votre précommande MATATAK est confirmée", paragraphes
    )
    cgv = cgv_html()
    if cgv:
        msg.add_attachment(
            cgv.encode("utf-8"),
            maintype="text",
            subtype="html",
            filename="MATATAK-conditions-generales-de-vente.html",
        )
    return msg


# Nouvelles à chaque étape : (sujet, texte). {suivi} et {texte} sont remplis si l'étape en a besoin.
ETAPES = {
    "fabrication": (
        "Votre MATATAK est en fabrication",
        "Bonne nouvelle : votre jeu est en cours de fabrication chez notre imprimeur en Europe. Nous vous "
        "écrivons dès qu'il part.",
    ),
    "expediee": (
        "Votre MATATAK est parti",
        "Votre jeu vient de partir ! Numéro de suivi Chronopost : {suivi}. Suivre le colis : {lien}",
    ),
    "boutique": (
        "Votre MATATAK vous attend en boutique",
        "Votre jeu vous attend à la boutique {boutique}. Présentez-vous avec votre nom ou ce numéro de "
        "commande.",
    ),
    "retard": (
        "Des nouvelles de votre MATATAK",
        "{texte} Si ce nouveau délai ne vous convient pas, répondez à cet e-mail : nous vous remboursons.",
    ),
    "nouvelle": ("Des nouvelles de votre MATATAK", "{texte}"),
}


def nouvelle(
    commande: dict, etape: str, prix: dict, suivi: str = "", texte: str = ""
) -> EmailMessage:
    if etape not in ETAPES:
        raise ValueError(etape)
    sujet, modele = ETAPES[etape]
    r = prix.get("retrait") or {}
    corps = modele.format(
        suivi=suivi,
        lien=SUIVI_CHRONOPOST % suivi,
        boutique="%s, %s, %s" % (r.get("nom", ""), r.get("adresse", ""), r.get("ville", "")),
        texte=texte.strip(),
    )
    paragraphes = [
        "Bonjour %s," % (commande.get("nom") or ""),
        corps,
        "Commande n° %s :" % _numero(commande),
        _lignes(commande),
        "Une question ? Répondez simplement à cet e-mail (%s)." % CONTACT,
        SIGNATURE,
    ]
    return _message(commande.get("email", ""), sujet, paragraphes)


# ---------- envoi ----------


def _envoyer_smtp(msg: EmailMessage, r: dict) -> None:
    contexte = ssl.create_default_context()
    if r["port"] == 465:
        with smtplib.SMTP_SSL(r["hote"], r["port"], context=contexte, timeout=20) as s:
            s.login(r["utilisateur"], r["mot_de_passe"])
            s.send_message(msg)
    else:
        with smtplib.SMTP(r["hote"], r["port"], timeout=20) as s:
            s.starttls(context=contexte)
            s.login(r["utilisateur"], r["mot_de_passe"])
            s.send_message(msg)


async def envoyer(db, msg: EmailMessage, commande_id: str, genre: str) -> str:
    """Envoie (ou garde « en_attente » sans SMTP) et laisse une trace dans `courriel`. Renvoie le statut."""
    r = reglages()
    statut, erreur = "en_attente", None
    if r:
        msg.replace_header("From", r["de"])
        try:
            await asyncio.get_running_loop().run_in_executor(None, _envoyer_smtp, msg, r)
            statut = "envoye"
        except (OSError, smtplib.SMTPException) as e:
            statut, erreur = "echec", str(e)[:300]
            log.error("Courriel %s pour %s : échec (%s)", genre, commande_id, erreur)
    if db is not None:
        await db.courriel.insert_one(
            {
                "commande": commande_id,
                "genre": genre,
                "a": msg["To"],
                "sujet": msg["Subject"],
                "statut": statut,
                "erreur": erreur,
                "le": datetime.now(timezone.utc),
                # gardé tant qu'il n'est pas parti, pour l'envoyer plus tard tel quel
                "brut": msg.as_bytes() if statut != "envoye" else None,
            }
        )
    return statut


async def confirmer(db, commande_id: str, prix: dict) -> str | None:
    """Envoie la confirmation une seule fois par commande payée (Stripe peut rappeler le webhook)."""
    if db is None:
        return None
    commande = await db.commande.find_one_and_update(
        {"_id": commande_id, "statut": "payee", "confirmation": {"$exists": False}},
        {"$set": {"confirmation": datetime.now(timezone.utc)}},
    )
    if not commande or not commande.get("email"):
        return None
    return await envoyer(db, confirmation(commande, prix), commande_id, "confirmation")


async def envoyer_en_attente(db) -> dict:
    """Envoie les e-mails gardés « en_attente » ou en « echec » (quand le SMTP est enfin réglé)."""
    r = reglages()
    compte = {"envoye": 0, "echec": 0}
    if not r or db is None:
        return compte
    from email import message_from_bytes, policy

    async for doc in db.courriel.find(
        {"statut": {"$in": ["en_attente", "echec"]}, "brut": {"$ne": None}}
    ):
        msg = message_from_bytes(doc["brut"], policy=policy.default)
        try:
            msg.replace_header("From", r["de"])
            await asyncio.get_running_loop().run_in_executor(None, _envoyer_smtp, msg, r)
            maj = {"statut": "envoye", "brut": None, "envoye_le": datetime.now(timezone.utc)}
            compte["envoye"] += 1
        except (OSError, smtplib.SMTPException) as e:
            maj = {"statut": "echec", "erreur": str(e)[:300]}
            compte["echec"] += 1
        await db.courriel.update_one({"_id": doc["_id"]}, {"$set": maj})
    return compte
