import json
from datetime import datetime
from aiohttp import web
import aiohttp_jinja2

from views import get_user_context
from tutorial_data import CHAPITRES, TUTORIAL_STEPS


def etape(step_id):
    """Une étape du tutoriel, au format attendu par le client (puzzleCtrl / tutorialCtrl)."""
    step_data = TUTORIAL_STEPS[step_id]
    return {
        "_id": step_data["id"],
        "gameId": f"Tutoriel {step_data['id']}",
        "site": "Matatak",
        "played": 0,
        "type": "tutorial",
        "eval": "0",  # No eval
        "moves": step_data["moves"],
        "fen": step_data["fen"],
        "variant": step_data["variant"],
        "instruction": step_data["instruction"],
        "success_msg": step_data["success_msg"],
        "title": step_data.get("title", ""),
        "chapitre": step_data.get("chapitre", 0),
        "chapitre_nom": CHAPITRES.get(step_data.get("chapitre", 0), ""),
        "carte": step_data.get("carte", ""),
        "equipe": step_data.get("equipe", []),
        "cible": step_data.get("cible", ""),
        "total": len(TUTORIAL_STEPS),
    }


async def api_tutorial(request):
    """Étape suivante chargée sur place par le client, sans recharger la page (tutorialCtrl.ts)."""
    step_id = request.match_info.get("stepId", "")
    if step_id not in TUTORIAL_STEPS:
        # Réponse directe : une exception HTTPNotFound serait transformée en page 200 par le middleware
        return web.json_response({"erreur": "étape inconnue"}, status=404)
    return web.json_response(etape(step_id))


@aiohttp_jinja2.template("analysis.html")
async def tutorial(request):
    user, context = await get_user_context(request)

    step_id = request.match_info.get("stepId", "1")

    if step_id not in TUTORIAL_STEPS:
        # Redirect to first step if invalid or done
        raise web.HTTPFound("/tutorial/1")

    step_data = TUTORIAL_STEPS[step_id]
    puzzle = etape(step_id)

    context["view_css"] = "analysis.css"
    context["extra_css"] = "tutoriel.css"
    context["view"] = "tutorial"
    context["variant"] = step_data["variant"]
    context["fen"] = step_data["fen"]
    context["wrating"] = 1500
    context["brating"] = 1500
    context["puzzle"] = json.dumps(puzzle, default=datetime.isoformat)

    return context
