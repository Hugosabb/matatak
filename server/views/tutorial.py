import json
from datetime import datetime
from aiohttp import web
import aiohttp_jinja2

from views import get_user_context
from tutorial_data import TUTORIAL_STEPS

@aiohttp_jinja2.template("analysis.html")
async def tutorial(request):
    user, context = await get_user_context(request)
    
    step_id = request.match_info.get("stepId", "1")
    
    if step_id not in TUTORIAL_STEPS:
        # Redirect to first step if invalid or done
        raise web.HTTPFound("/tutorial/1")

    step_data = TUTORIAL_STEPS[step_id]

    # Convert the tutorial step data into a format that the frontend (puzzleCtrl) expects
    puzzle = {
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
        "title": step_data.get("title", "")
    }

    context["view_css"] = "analysis.css"
    context["view"] = "tutorial"
    context["variant"] = step_data["variant"]
    context["fen"] = step_data["fen"]
    context["wrating"] = 1500
    context["brating"] = 1500
    context["puzzle"] = json.dumps(puzzle, default=datetime.isoformat)

    return context
