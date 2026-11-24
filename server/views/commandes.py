"""Commandes de la précommande, pour Hugo : la liste, l'export CSV (expédition, boutique) et les nouvelles aux
clients (fabrication, expédition avec numéro de suivi, retrait en boutique, retard). Réservé aux comptes de la
variable ADMINS ; les autres reçoivent un 404, comme si la page n'existait pas.

    GET  /precommande/commandes          la liste
    GET  /precommande/commandes.csv      l'export (séparateur « ; », UTF-8 avec BOM : Excel l'ouvre tel quel)
    POST /precommande/commandes/nouvelle {ids: [...], etape, suivi?, texte?}  -> envoie un e-mail à chacune
"""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone

import aiohttp_jinja2
from aiohttp import web

import boutique
import courriels
from pychess_global_app_state_utils import get_app_state
from settings import ADMINS
from views import get_user_context


async def _admin(request):
    user, context = await get_user_context(request)
    if user.anon or user.username not in ADMINS:
        raise web.HTTPNotFound()
    return user, context


def _ligne(c: dict) -> dict:
    a = c.get("adresse") or {}
    relais = c.get("relais") or {}
    return {
        "id": c["_id"],
        "numero": str(c["_id"])[-8:].upper(),
        "cree": c.get("cree"),
        "nom": c.get("nom") or "",
        "email": c.get("email") or "",
        "telephone": c.get("telephone") or "",
        "articles": " ; ".join(
            "%d × %s" % (x.get("n", 1), courriels.nom_article(x.get("cle", "")))
            for x in c.get("panier", [])
        ),
        "mode": (
            "Retrait en boutique" if c.get("mode_livraison") == "retrait" else "Chronopost Relais"
        ),
        "relais": " ".join(x for x in (relais.get("id"), relais.get("nom")) if x),
        "adresse": ", ".join(
            x
            for x in (
                a.get("line1"),
                a.get("line2"),
                a.get("postal_code"),
                a.get("city"),
                a.get("country"),
            )
            if x
        ),
        "total": boutique.euros_texte(c["total"]) if c.get("total") is not None else "",
        "code": c.get("code") or "",
        "statut": c.get("statut") or "",
        "etape": c.get("etape") or "",
        "suivi": c.get("suivi") or "",
        "test": bool(c.get("test")),
    }


async def _commandes(db) -> list[dict]:
    if db is None:
        return []
    return [_ligne(c) async for c in db.commande.find({}).sort("cree", -1)]


@aiohttp_jinja2.template("page_commandes.html")
async def liste(request):
    _user, context = await _admin(request)
    db = get_app_state(request.app).db
    commandes = await _commandes(db)
    attente = (
        await db.courriel.count_documents({"statut": {"$in": ["en_attente", "echec"]}})
        if db is not None
        else 0
    )
    context.update(
        {
            "view": "commandes",
            "view_css": "commandes.css",
            "title": "Commandes · MATATAK",
            "commandes": commandes,
            "nb_payees": sum(1 for c in commandes if c["statut"] == "payee"),
            "courriels_en_attente": attente,
            "smtp_pret": courriels.reglages() is not None,
            "etapes": courriels.ETAPES,
        }
    )
    return context


async def export_csv(request):
    await _admin(request)
    commandes = await _commandes(get_app_state(request.app).db)
    colonnes = [
        ("numero", "Commande"),
        ("cree", "Date"),
        ("statut", "Paiement"),
        ("etape", "Étape"),
        ("nom", "Nom"),
        ("email", "E-mail"),
        ("telephone", "Téléphone"),
        ("articles", "Articles"),
        ("mode", "Livraison"),
        ("relais", "Point relais"),
        ("adresse", "Adresse"),
        ("total", "Total"),
        ("code", "Code"),
        ("suivi", "Suivi"),
        ("test", "Test"),
    ]
    sortie = io.StringIO()
    w = csv.writer(sortie, delimiter=";")
    w.writerow([titre for _cle, titre in colonnes])
    for c in commandes:
        ligne = []
        for cle, _titre in colonnes:
            v = c[cle]
            if isinstance(v, datetime):
                v = v.strftime("%d/%m/%Y %H:%M")
            elif isinstance(v, bool):
                v = "oui" if v else ""
            ligne.append(v)
        w.writerow(ligne)
    return web.Response(
        body=("﻿" + sortie.getvalue()).encode("utf-8"),
        content_type="text/csv",
        charset="utf-8",
        headers={"Content-Disposition": 'attachment; filename="commandes-matatak.csv"'},
    )


async def nouvelle(request):
    """Envoie la nouvelle d'une étape aux commandes choisies ; garde l'étape (et le suivi) sur chacune."""
    await _admin(request)
    try:
        corps = await request.json()
        ids = corps["ids"]
        etape = corps["etape"]
        suivi = (corps.get("suivi") or "").strip()
        texte = (corps.get("texte") or "").strip()
        if (
            not isinstance(ids, list)
            or not ids
            or not all(isinstance(i, str) for i in ids)
            or etape not in courriels.ETAPES
            or (etape == "expediee" and (len(ids) != 1 or not suivi))
            or (etape in ("retard", "nouvelle") and not texte)
            or len(suivi) > 40
            or len(texte) > 2000
        ):
            raise ValueError
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return web.json_response({"erreur": "Demande invalide."}, status=400)
    db = get_app_state(request.app).db
    prix = boutique.lire_prix()
    resultats = {}
    for i in ids:
        c = await db.commande.find_one({"_id": i, "statut": "payee"})
        if not c or not c.get("email"):
            resultats[i] = "introuvable"
            continue
        msg = courriels.nouvelle(c, etape, prix, suivi=suivi, texte=texte)
        resultats[i] = await courriels.envoyer(db, msg, i, etape)
        maj = {"etape": etape, "etape_le": datetime.now(timezone.utc)}
        if suivi:
            maj["suivi"] = suivi
        await db.commande.update_one({"_id": i}, {"$set": maj})
    return web.json_response({"resultats": resultats})
