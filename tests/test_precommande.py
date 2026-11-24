# -*- coding: utf-8 -*-
"""Précommande avec Stripe Checkout (server/boutique.py, 20/11/2026) : panier contrôlé par le serveur, prix
de Stripe comparés à ceux de la page, livraison offerte dès un seuil, webhook signé, commande enregistrée une fois.
Stripe est simulé : aucun appel réseau, aucune vraie clé."""
import hashlib
import hmac
import json
import os
import time
import unittest
from unittest import mock

from aiohttp.test_utils import AioHTTPTestCase
from mongomock_motor import AsyncMongoMockClient

import boutique
from pychess_global_app_state_utils import get_app_state
from server import make_app

PRIX = {
    "jeu": 20.0,
    "packs": {"jeu_deux": 30.0, "jeu_quatre": 40.0},
    "extension": 7.5,
    "livraison": {"prix": 4.5, "offerte_des": 40.0, "mode": "Chronopost Relais", "zone": "France"},
    "retrait": {
        "nom": "Le Pion Magique",
        "adresse": "13 rue de Bras",
        "code_postal": "14000",
        "ville": "Caen",
        "logo": "",
    },
    "dates": {"objectif": "avant Noël", "expedition": "", "au_plus_tard": ""},
    "newsletter": {
        "paliers": [
            {"code": "ESSAI4", "remise": 4.0, "fin": "2999-12-25", "fin_texte": "25 décembre"}
        ]
    },
    "codes": [
        {"code": "CREA4", "remise": 4.0, "debut": "2000-01-01", "fin": "2999-12-31", "qui": "essai"}
    ],
    "maquette": True,
}
SECRET = "whsec_essai"
MONTANTS = {
    "matatak_jeu": 2000,
    "matatak_jeu_deux": 3000,
    "matatak_jeu_quatre": 4000,
    **{"matatak_ext_" + s: 750 for s in boutique.SAISONS},
}


def faux_stripe(montants=MONTANTS, appels=None):
    async def stripe(methode, chemin, params=None):
        if appels is not None:
            appels.append((methode, chemin, params))
        if chemin == "/prices":
            return {
                "data": [
                    {
                        "id": "price_" + k,
                        "lookup_key": k,
                        "unit_amount": montants[k],
                        "currency": "eur",
                    }
                    for k in params["lookup_keys"]
                    if k in montants
                ]
            }
        if chemin == "/checkout/sessions":
            return {"id": "cs_test_1", "url": "https://checkout.stripe.com/c/pay/cs_test_1"}
        raise AssertionError(chemin)

    return stripe


def signer(corps: bytes, t=None, secret=SECRET):
    t = int(time.time()) if t is None else t
    sig = hmac.new(secret.encode(), b"%d." % t + corps, hashlib.sha256).hexdigest()
    return "t=%d,v1=%s" % (t, sig)


def session_payee(**autres):
    s = {
        "id": "cs_test_1",
        "object": "checkout.session",
        "livemode": False,
        "payment_status": "paid",
        "amount_total": 4750,
        "amount_subtotal": 4750,
        "currency": "eur",
        "payment_intent": "pi_1",
        "metadata": {"panier": "quatre*1;ext:hiver*1", "origine": "precommande"},
        "customer_details": {"email": "client@example.org", "phone": "+33600000000", "name": "A B"},
        "collected_information": {
            "shipping_details": {
                "name": "A B",
                "address": {
                    "line1": "1 rue",
                    "postal_code": "14000",
                    "city": "Caen",
                    "country": "FR",
                },
            }
        },
        "shipping_cost": {"amount_total": 0},
        "total_details": {"amount_discount": 0},
    }
    s.update(autres)
    return s


class PanierTestCase(unittest.TestCase):
    def test_panier_valide(self):
        self.assertEqual(
            boutique.analyser_panier(
                [
                    {"cle": "quatre", "n": 1},
                    {"cle": "deux:ete,hiver", "n": 2},
                    {"cle": "quatre", "n": 1},
                ]
            ),
            [("quatre", 2), ("deux:ete,hiver", 2)],
        )

    def test_panier_refuse(self):
        for lignes in (
            [],
            None,
            [{"cle": "inconnu", "n": 1}],
            [{"cle": "deux:ete,ete", "n": 1}],
            [{"cle": "deux:hiver,ete", "n": 1}],  # toujours dans l'ordre des Saisons
            [{"cle": "ext:lune", "n": 1}],
            [{"cle": "jeu", "n": 0}],
            [{"cle": "jeu", "n": True}],
            [{"cle": "jeu", "n": 21}],
            [{"cle": "jeu", "n": "2"}],
            [{"cle": "jeu", "n": 1}] * 13,
        ):
            with self.assertRaises(ValueError, msg=lignes):
                boutique.analyser_panier(lignes)

    def test_texte_du_panier_aller_retour(self):
        panier = [("quatre", 1), ("deux:printemps,ete", 2), ("ext:hiver", 3)]
        texte = boutique.texte_panier(panier)
        self.assertEqual(boutique.lire_texte_panier(texte), [{"cle": c, "n": n} for c, n in panier])

    def test_aplatir(self):
        self.assertEqual(
            boutique.aplatir({"a": [{"b": 1}], "c": True, "d": {"e": "x"}}),
            [("a[0][b]", "1"), ("c", "true"), ("d[e]", "x")],
        )

    def test_signature(self):
        corps = b'{"id": "evt"}'
        self.assertTrue(boutique.signature_valide(corps, signer(corps), SECRET))
        self.assertFalse(boutique.signature_valide(corps, signer(corps, secret="autre"), SECRET))
        self.assertFalse(boutique.signature_valide(corps + b" ", signer(corps), SECRET))
        self.assertFalse(
            boutique.signature_valide(corps, signer(corps, t=int(time.time()) - 600), SECRET)
        )
        self.assertFalse(boutique.signature_valide(corps, "", SECRET))
        self.assertFalse(boutique.signature_valide(corps, signer(corps), ""))


class PrecommandeTestCase(AioHTTPTestCase):
    async def get_application(self):
        return make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True)

    def setUp(self):
        super().setUp()
        self.prix = mock.patch.object(boutique, "lire_prix", lambda: PRIX)
        self.prix.start()
        self.addCleanup(self.prix.stop)

    def cles(self, secrete="sk_test_essai", webhook=SECRET):
        return mock.patch.dict(
            os.environ, {"STRIPE_SECRET_KEY": secrete, "STRIPE_WEBHOOK_SECRET": webhook}
        )

    async def payer(self, lignes):
        return await self.client.post("/precommande/paiement", json={"panier": lignes})

    async def test_page(self):
        rep = await self.client.get("/precommande")
        self.assertEqual(rep.status, 200)
        texte = await rep.text()
        self.assertIn("20 €", texte)
        self.assertNotIn("Prix de lancement", texte)
        # de la moins chère à la plus chère (choix d'Hugo, 20/11)
        self.assertLess(texte.index('data-offre="jeu"'), texte.index('data-offre="deux"'))
        self.assertLess(texte.index('data-offre="deux"'), texte.index('data-offre="quatre"'))

    async def test_sans_cle_le_paiement_est_ferme(self):
        with mock.patch.dict(os.environ, {"STRIPE_SECRET_KEY": ""}):
            rep = await self.payer([{"cle": "jeu", "n": 1}])
        self.assertEqual(rep.status, 503)

    async def test_panier_invalide(self):
        with self.cles(), mock.patch.object(boutique, "stripe", faux_stripe()):
            rep = await self.payer([{"cle": "jeu", "n": 500}])
        self.assertEqual(rep.status, 400)

    async def test_session_avec_livraison_payante(self):
        appels = []
        with self.cles(), mock.patch.object(boutique, "stripe", faux_stripe(appels=appels)):
            rep = await self.payer([{"cle": "jeu", "n": 1}, {"cle": "deux:ete,hiver", "n": 1}])
        self.assertEqual(rep.status, 200)
        self.assertEqual((await rep.json())["url"], "https://checkout.stripe.com/c/pay/cs_test_1")
        params = appels[-1][2]
        self.assertEqual(params["mode"], "payment")
        self.assertTrue(params["allow_promotion_codes"])
        self.assertEqual(params["shipping_address_collection"], {"allowed_countries": ["FR"]})
        self.assertEqual(params["line_items"][0], {"quantity": 1, "price": "price_matatak_jeu"})
        deux = params["line_items"][1]["price_data"]
        self.assertEqual(deux["unit_amount"], 3000)
        self.assertIn("Été, Hiver", deux["product_data"]["name"])
        # sous le seuil : livraison payante
        appels.clear()
        with self.cles(), mock.patch.object(boutique, "stripe", faux_stripe(appels=appels)):
            await self.payer([{"cle": "jeu", "n": 1}])
        livraison = appels[-1][2]["shipping_options"][0]["shipping_rate_data"]
        self.assertEqual(livraison["fixed_amount"], {"amount": 450, "currency": "eur"})
        self.assertEqual(
            appels[-1][2]["metadata"],
            {"panier": "jeu*1", "origine": "precommande", "livraison": "relais"},
        )

    async def test_livraison_offerte_des_le_seuil(self):
        appels = []
        with self.cles(), mock.patch.object(boutique, "stripe", faux_stripe(appels=appels)):
            await self.payer([{"cle": "quatre", "n": 1}])
        livraison = appels[-1][2]["shipping_options"][0]["shipping_rate_data"]
        self.assertEqual(livraison["fixed_amount"]["amount"], 0)

    async def test_prix_stripe_different_de_la_page(self):
        autres = {**MONTANTS, "matatak_jeu": 1990}
        with self.cles(), mock.patch.object(boutique, "stripe", faux_stripe(autres)):
            rep = await self.payer([{"cle": "jeu", "n": 1}])
        self.assertEqual(rep.status, 502)

    async def envoyer(self, evenement, signature=None):
        corps = json.dumps(evenement).encode()
        return await self.client.post(
            "/precommande/webhook",
            data=corps,
            headers={
                "Stripe-Signature": signature or signer(corps),
                "Content-Type": "application/json",
            },
        )

    async def test_webhook_enregistre_la_commande_une_fois(self):
        evenement = {
            "id": "evt_1",
            "type": "checkout.session.completed",
            "data": {"object": session_payee()},
        }
        with self.cles():
            self.assertEqual((await self.envoyer(evenement)).status, 200)
            self.assertEqual((await self.envoyer(evenement)).status, 200)  # Stripe réessaie
        db = get_app_state(self.app).db
        self.assertEqual(await db.commande.count_documents({}), 1)
        c = await db.commande.find_one({"_id": "cs_test_1"})
        self.assertEqual(c["statut"], "payee")
        self.assertEqual(c["email"], "client@example.org")
        self.assertEqual(c["adresse"]["city"], "Caen")
        self.assertEqual(c["panier"], [{"cle": "quatre", "n": 1}, {"cle": "ext:hiver", "n": 1}])
        self.assertEqual(c["total"], 4750)
        self.assertTrue(c["test"])

        with self.cles():
            rep = await self.client.get("/precommande/merci?session_id=cs_test_1")
        texte = await rep.text()
        self.assertIn("client@example.org", texte)
        self.assertIn("Le jeu + les 4 extensions", texte)
        self.assertIn("47,50", texte)

    async def test_webhook_refuse_une_fausse_signature(self):
        evenement = {
            "id": "evt_1",
            "type": "checkout.session.completed",
            "data": {"object": session_payee()},
        }
        with self.cles():
            rep = await self.envoyer(evenement, signature="t=1,v1=00")
        self.assertEqual(rep.status, 400)
        self.assertEqual(await get_app_state(self.app).db.commande.count_documents({}), 0)

    async def test_webhook_ignore_les_autres_paiements(self):
        autre = session_payee(metadata={"origine": "ailleurs"})
        with self.cles():
            rep = await self.envoyer(
                {"id": "evt_2", "type": "checkout.session.completed", "data": {"object": autre}}
            )
        self.assertEqual(rep.status, 200)
        self.assertEqual(await get_app_state(self.app).db.commande.count_documents({}), 0)

    async def test_paiement_differe_en_attente_puis_paye(self):
        attente = session_payee(payment_status="unpaid")
        with self.cles():
            await self.envoyer(
                {"id": "e1", "type": "checkout.session.completed", "data": {"object": attente}}
            )
            db = get_app_state(self.app).db
            self.assertEqual((await db.commande.find_one({}))["statut"], "en_attente")
            await self.envoyer(
                {
                    "id": "e2",
                    "type": "checkout.session.async_payment_succeeded",
                    "data": {"object": session_payee()},
                }
            )
        c = await db.commande.find_one({})
        self.assertEqual(c["statut"], "payee")
        self.assertEqual(len(c["evenements"]), 2)

    async def test_retrait_gratuit_sans_adresse(self):
        appels = []
        with self.cles(), mock.patch.object(boutique, "stripe", faux_stripe(appels=appels)):
            rep = await self.client.post(
                "/precommande/paiement",
                json={"panier": [{"cle": "jeu", "n": 1}], "livraison": "retrait"},
            )
        self.assertEqual(rep.status, 200)
        params = appels[-1][2]
        livraison = params["shipping_options"][0]["shipping_rate_data"]
        self.assertEqual(livraison["fixed_amount"]["amount"], 0)  # même sous le seuil
        self.assertIn("Le Pion Magique", livraison["display_name"])
        self.assertNotIn("shipping_address_collection", params)
        self.assertEqual(params["metadata"]["livraison"], "retrait")
        self.assertTrue(params["name_collection"]["individual"]["enabled"])

    async def test_mode_de_livraison_inconnu(self):
        with self.cles(), mock.patch.object(boutique, "stripe", faux_stripe()):
            rep = await self.client.post(
                "/precommande/paiement",
                json={"panier": [{"cle": "jeu", "n": 1}], "livraison": "drone"},
            )
        self.assertEqual(rep.status, 400)

    async def test_moyens_de_paiement_inutiles_retires(self):
        appels = []
        with self.cles(), mock.patch.object(boutique, "stripe", faux_stripe(appels=appels)):
            await self.payer([{"cle": "jeu", "n": 1}])
        exclus = appels[-1][2]["excluded_payment_method_types"]
        for moyen in ("klarna", "amazon_pay", "bancontact", "mb_way", "eps", "satispay"):
            self.assertIn(moyen, exclus)
        self.assertNotIn("card", exclus)


class OffreLancementTestCase(AioHTTPTestCase):
    """Offre de lancement (Hugo, 20/11) : 4 € sur le jeu seul contre l'inscription à la newsletter."""

    async def get_application(self):
        return make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True)

    def setUp(self):
        super().setUp()
        self.prix = mock.patch.object(boutique, "lire_prix", lambda: PRIX)
        self.prix.start()
        self.addCleanup(self.prix.stop)

    def test_offre_terminee_apres_sa_date(self):
        from datetime import date

        prix = {"newsletter": {"code": "ESSAI4", "fin": "2026-12-25"}}
        self.assertIsNotNone(boutique.offre_newsletter(prix, date(2026, 12, 25)))
        self.assertIsNone(boutique.offre_newsletter(prix, date(2026, 12, 26)))
        self.assertIsNone(boutique.offre_newsletter({}, date(2026, 12, 1)))

    async def test_inscription_donne_le_code_et_garde_le_consentement(self):
        rep = await self.client.post("/precommande/newsletter", json={"email": " Hugo@Exemple.fr "})
        self.assertEqual(rep.status, 200)
        self.assertEqual((await rep.json())["code"], "ESSAI4")
        # deux fois la même adresse : une seule inscription
        await self.client.post("/precommande/newsletter", json={"email": "hugo@exemple.fr"})
        db = get_app_state(self.app).db
        self.assertEqual(await db.newsletter.count_documents({}), 1)
        inscrit = await db.newsletter.find_one({"_id": "hugo@exemple.fr"})
        self.assertIn("15 ans", inscrit["consentement"])
        self.assertFalse(inscrit["desinscrit"])

    async def test_adresse_invalide_ou_robot(self):
        for email in ("", "pas-une-adresse", "a@b", "x" * 300 + "@exemple.fr"):
            rep = await self.client.post("/precommande/newsletter", json={"email": email})
            self.assertEqual(rep.status, 400, email)
        # champ caché rempli : réponse normale, rien d'enregistré
        rep = await self.client.post(
            "/precommande/newsletter", json={"email": "robot@exemple.fr", "site": "http://spam"}
        )
        self.assertEqual(rep.status, 200)
        self.assertEqual(await get_app_state(self.app).db.newsletter.count_documents({}), 0)

    async def test_code_tape_dans_le_panier(self):
        rep = await self.client.post("/precommande/code", json={"code": " essai4 "})
        self.assertEqual(rep.status, 200)
        self.assertEqual(await rep.json(), {"code": "ESSAI4", "remise": 4.0})
        rep = await self.client.post("/precommande/code", json={"code": "AUTRE"})
        self.assertEqual(rep.status, 404)
        rep = await self.client.post("/precommande/code", json={"code": ""})
        self.assertEqual(rep.status, 400)

    async def test_code_4_euros_sur_chaque_jeu(self):
        appels = []
        cles = mock.patch.dict(os.environ, {"STRIPE_SECRET_KEY": "sk_test_essai"})
        with cles, mock.patch.object(boutique, "stripe", faux_stripe(appels=appels)):
            rep = await self.client.post(
                "/precommande/paiement",
                json={
                    "panier": [{"cle": "jeu", "n": 3}, {"cle": "quatre", "n": 1}],
                    "code": "essai4",
                },
            )
        self.assertEqual(rep.status, 200)
        params = appels[-1][2]
        jeu = params["line_items"][0]
        # 20 € - 4 € = 16 € pour chacun des 3 jeux, même produit Stripe ; le pack garde son prix
        self.assertEqual(jeu["quantity"], 3)
        self.assertEqual(jeu["price_data"]["unit_amount"], 1600)
        self.assertIn(
            "Code ESSAI4 appliqué : 4 € économisés par jeu",
            jeu["price_data"]["product_data"]["description"],
        )
        self.assertEqual(
            params["payment_intent_data"]["description"], "Précommande MATATAK, code ESSAI4 (−12 €)"
        )
        self.assertEqual(params["branding_settings"]["icon"]["type"], "url")
        self.assertEqual(
            params["line_items"][1], {"quantity": 1, "price": "price_matatak_jeu_quatre"}
        )
        self.assertNotIn("allow_promotion_codes", params)
        self.assertEqual(params["metadata"]["code"], "ESSAI4")
        self.assertEqual(params["metadata"]["remise"], "1200")
        self.assertIn(
            "Code promo ESSAI4 appliqué sur L'Essentiel : 12 € économisés.",
            params["custom_text"]["submit"]["message"],
        )

    async def test_code_refuse_au_paiement(self):
        appels = []
        cles = mock.patch.dict(os.environ, {"STRIPE_SECRET_KEY": "sk_test_essai"})
        with cles, mock.patch.object(boutique, "stripe", faux_stripe(appels=appels)):
            rep = await self.client.post(
                "/precommande/paiement", json={"panier": [{"cle": "jeu", "n": 1}], "code": "FAUX"}
            )
        self.assertEqual(rep.status, 400)
        self.assertTrue((await rep.json())["code_refuse"])
        self.assertEqual(appels, [])

    async def test_sans_code_le_champ_stripe_reste(self):
        appels = []
        cles = mock.patch.dict(os.environ, {"STRIPE_SECRET_KEY": "sk_test_essai"})
        with cles, mock.patch.object(boutique, "stripe", faux_stripe(appels=appels)):
            await self.client.post(
                "/precommande/paiement", json={"panier": [{"cle": "jeu", "n": 1}]}
            )
        params = appels[-1][2]
        self.assertTrue(params["allow_promotion_codes"])
        self.assertEqual(params["line_items"][0], {"quantity": 1, "price": "price_matatak_jeu"})


class CodesTestCase(unittest.TestCase):
    """Paliers dégressifs de la newsletter et codes de créateurs (Hugo, 20/11)."""

    PRIX = {
        "jeu": 20.0,
        "newsletter": {
            "paliers": [
                {"code": "ESSAI4", "remise": 4, "fin": "2026-12-06"},
                {"code": "ESSAI2", "remise": 2, "fin": "2026-12-15"},
            ]
        },
        "codes": [{"code": "CREA4", "remise": 4, "debut": "2026-12-01", "fin": "2026-12-10"}],
    }

    def test_paliers(self):
        from datetime import date

        self.assertEqual(boutique.offre_newsletter(self.PRIX, date(2026, 12, 6))["code"], "ESSAI4")
        self.assertEqual(boutique.offre_newsletter(self.PRIX, date(2026, 12, 7))["code"], "ESSAI2")
        self.assertIsNone(boutique.offre_newsletter(self.PRIX, date(2026, 12, 16)))
        # un code de palier fini ne marche plus
        self.assertEqual(boutique.remise_code(self.PRIX, "essai4", date(2026, 12, 6)), 400)
        self.assertEqual(boutique.remise_code(self.PRIX, "ESSAI4", date(2026, 12, 7)), 0)
        self.assertEqual(boutique.remise_code(self.PRIX, "ESSAI2", date(2026, 12, 7)), 200)

    def test_code_de_createur_entre_ses_dates(self):
        from datetime import date

        self.assertEqual(boutique.remise_code(self.PRIX, "CREA4", date(2026, 11, 30)), 0)
        self.assertEqual(boutique.remise_code(self.PRIX, " crea4 ", date(2026, 12, 1)), 400)
        self.assertEqual(boutique.remise_code(self.PRIX, "CREA4", date(2026, 12, 10)), 400)
        self.assertEqual(boutique.remise_code(self.PRIX, "CREA4", date(2026, 12, 11)), 0)
        self.assertEqual(boutique.remise_code(self.PRIX, "", date(2026, 12, 5)), 0)

    def test_ancien_format_accepte(self):
        from datetime import date

        prix = {"jeu": 20.0, "newsletter": {"code": "ESSAI4", "remise": 4, "fin": "2026-12-15"}}
        self.assertEqual(boutique.remise_code(prix, "ESSAI4", date(2026, 12, 15)), 400)


class ExtensionsPlusTardTestCase(AioHTTPTestCase):
    """Hugo, 24/11 : les extensions sortent plus tard. Les offres avec extensions restent affichées avec leur prix,
    « Bientôt disponible » et « Prévenez-moi » ; seul le jeu se commande, le serveur refuse le reste.
    """

    PRIX = {**PRIX, "extensions_dispo": False, "extensions_sortie": "début 2027"}

    async def get_application(self):
        return make_app(db_client=AsyncMongoMockClient(), simple_cookie_storage=True)

    def setUp(self):
        super().setUp()
        self.prix = mock.patch.object(boutique, "lire_prix", lambda: self.PRIX)
        self.prix.start()
        self.addCleanup(self.prix.stop)

    async def test_page_offres_visibles_mais_pas_en_vente(self):
        texte = await (await self.client.get("/precommande")).text()
        self.assertIn("Bientôt disponible · début 2027", texte)
        self.assertIn("40 €", texte)  # le prix du pack reste affiché
        self.assertEqual(texte.count("mt-btn-large ajouter"), 1)  # seulement le jeu
        self.assertEqual(texte.count("mt-btn-large prevenir"), 2)
        self.assertNotIn('data-cle="ext:', texte)  # pas de compteur sur les extensions à l'unité

    async def test_seul_le_jeu_se_commande(self):
        appels = []
        cles = mock.patch.dict(os.environ, {"STRIPE_SECRET_KEY": "sk_test_essai"})
        with cles, mock.patch.object(boutique, "stripe", faux_stripe(appels=appels)):
            for lignes in (
                [{"cle": "quatre", "n": 1}],
                [{"cle": "jeu", "n": 1}, {"cle": "ext:ete", "n": 1}],
            ):
                rep = await self.client.post("/precommande/paiement", json={"panier": lignes})
                self.assertEqual(rep.status, 400, lignes)
                self.assertTrue((await rep.json())["pas_dispo"])
            self.assertEqual(appels, [])  # rien demandé à Stripe
            rep = await self.client.post(
                "/precommande/paiement", json={"panier": [{"cle": "jeu", "n": 2}]}
            )
        self.assertEqual(rep.status, 200)

    async def test_prevenez_moi_garde_l_interet(self):
        rep = await self.client.post(
            "/precommande/newsletter", json={"email": "a@exemple.fr", "interet": "extensions"}
        )
        self.assertEqual(rep.status, 200)
        inscrit = await get_app_state(self.app).db.newsletter.find_one({"_id": "a@exemple.fr"})
        self.assertEqual(inscrit["interets"], ["extensions"])
        self.assertIn(
            "En laissant votre e-mail", inscrit["consentement"]
        )  # la phrase affichée, pas celle du code
