# -*- coding: utf-8 -*-
"""Limite de débit des WebSockets (AUDIT P2-6, 10/11/2026)."""

from websocket_utils import Debit


def test_au_dela_de_la_limite_les_messages_sont_ignores_puis_reprennent():
    d = Debit(nombre=3, secondes=1.0)
    assert [d.accepte(0.0), d.accepte(0.1), d.accepte(0.2)] == [True, True, True]
    assert d.accepte(0.3) is False  # 4e message dans la même seconde
    assert d.accepte(1.15) is True  # le 1er est sorti de la fenêtre


def test_une_vraie_partie_passe_largement():
    d = Debit()
    # 6 messages par seconde pendant 10 s (bien plus qu'un joueur pressé)
    assert all(d.accepte(i / 6) for i in range(60))
