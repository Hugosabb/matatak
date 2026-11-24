"""Choix du point relais Chronopost avant le paiement (Hugo, 24/11) : lecture de la réponse du service, faux
relais sans compte, champs du relais choisi vérifiés."""

import os
import unittest
from unittest import mock

import relais

REPONSE = """<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
<ns1:recherchePointChronopostInterResponse xmlns:ns1="http://cxf.rechercheBt.soap.chronopost.fr/"><return>
<errorCode>0</errorCode>
<listePointRelais><identifiant>8455R</identifiant><nom>LOIN</nom><adresse1>2 rue B</adresse1>
  <codePostal>14000</codePostal><localite>CAEN</localite><distanceEnMetre>900</distanceEnMetre></listePointRelais>
<listePointRelais><identifiant>1234A</identifiant><nom>PRES</nom><adresse1>1 rue A</adresse1><adresse2>Bat 2</adresse2>
  <codePostal>14000</codePostal><localite>CAEN</localite><distanceEnMetre>120</distanceEnMetre>
  <listeHoraireOuverture><jour>1</jour><horairesAsString>09:00-12:00 14:00-19:00</horairesAsString></listeHoraireOuverture>
</listePointRelais>
</return></ns1:recherchePointChronopostInterResponse></soap:Body></soap:Envelope>"""


class RelaisTest(unittest.TestCase):
    def test_reponse_triee_par_distance(self):
        r = relais.lire_reponse(REPONSE)
        self.assertEqual([x["id"] for x in r], ["1234A", "8455R"])
        self.assertEqual(r[0]["adresse"], "1 rue A Bat 2")
        self.assertEqual(r[0]["horaires"], [["lundi", "09:00-12:00 14:00-19:00"]])

    def test_sans_compte(self):
        with mock.patch.dict(os.environ, {"CHRONOPOST_COMPTE": "", "CHRONOPOST_MOT_DE_PASSE": ""}):
            self.assertIsNone(relais.identifiants())
            with mock.patch.object(relais, "PROD", True):
                self.assertFalse(relais.actif())
            with mock.patch.object(relais, "PROD", False):
                self.assertTrue(relais.actif())
        self.assertEqual(len(relais.faux_relais("14000", "Caen")), 5)

    def test_relais_choisi_verifie(self):
        bon = {
            "id": "1234A",
            "nom": "PRES",
            "adresse": "1 rue A",
            "code_postal": "14000",
            "ville": "CAEN",
        }
        self.assertEqual(relais.relais_valide(bon), bon)
        for mauvais in (
            None,
            {},
            {**bon, "id": "x" * 20},
            {**bon, "code_postal": "1400"},
            {**bon, "nom": "n" * 200},
        ):
            self.assertIsNone(relais.relais_valide(mauvais), mauvais)
