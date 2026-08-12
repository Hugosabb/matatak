"""
Module de gestion du Mode Aventure / Campagne pour Matatak.
"""

import json
import os
from typing import Dict, List, Any, Optional

CAMPAIGN_CACHE: Dict[str, List[Dict[str, Any]]] = {}

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def load_campaign(variant: str) -> List[Dict[str, Any]]:
    """Charge et met en cache la liste des niveaux pour une variante."""
    if variant in CAMPAIGN_CACHE:
        return CAMPAIGN_CACHE[variant]

    filename = f"campaign_{variant}.json"
    filepath = os.path.join(BASE_DIR, filename)

    if not os.path.exists(filepath):
        # Fallback sur matatakmini ou matatak
        filepath = os.path.join(BASE_DIR, "campaign_matatakmini.json")

    if not os.path.exists(filepath):
        return []

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            levels = json.load(f)
            CAMPAIGN_CACHE[variant] = levels
            return levels
    except Exception as e:
        print(f"[CAMPAIGN] Erreur de chargement {filepath}: {e}")
        return []


def get_level(variant: str, level_num: int) -> Optional[Dict[str, Any]]:
    """Récupère les détails d'un niveau spécifique (1-indexed)."""
    levels = load_campaign(variant)
    if 1 <= level_num <= len(levels):
        return levels[level_num - 1]
    return None


def get_total_levels(variant: str) -> int:
    """Retourne le nombre total de niveaux disponibles pour une variante."""
    return len(load_campaign(variant))
