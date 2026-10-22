import json
from datetime import datetime

import aiohttp_jinja2
from aiohttp import web

from puzzle import (
    get_puzzle,
    next_puzzle,
    get_daily_puzzle,
    default_puzzle_perf,
)
from variants import VARIANTS
from views import get_user_context
from campaign import get_level, get_total_levels, load_campaign


@aiohttp_jinja2.template("analysis.html")
async def puzzle(request):
    user, context = await get_user_context(request)

    variant = request.match_info.get("variant", "matatakmini")
    level_str = request.match_info.get("level")

    if "/campaign" in request.path:
        context["view"] = "campaign"
        context["variant"] = variant
        context["view_css"] = "analysis.css"
        context["extra_css"] = "puzzle.css"
        return context

    if request.path.endswith("/daily"):
        puzzle = await get_daily_puzzle(request)
    elif level_str is not None:
        try:
            level_num = int(level_str)
        except ValueError:
            raise web.HTTPNotFound()

        level_data = get_level(variant, level_num)
        if not level_data:
            raise web.HTTPNotFound()

        puzzle = {
            "_id": level_data["puzzle_id"],
            "fen": level_data["fen"],
            "moves": level_data["moves"],
            "eval": level_data["eval"],
            "type": level_data["type"],
            "variant": level_data["variant"],
            "level": level_data["level"],
            "total_levels": get_total_levels(variant),
        }
        if "intro" in level_data:
            puzzle["intro"] = level_data["intro"]

        user.puzzle_variant = variant
    else:
        puzzleId = request.match_info.get("puzzleId")

        if puzzleId in VARIANTS:
            user.puzzle_variant = puzzleId
            puzzleId = None
        elif variant in VARIANTS:
            user.puzzle_variant = variant
        else:
            user.puzzle_variant = None

        if puzzleId is None:
            puzzle = await next_puzzle(request, user)
        else:
            puzzle = await get_puzzle(request, puzzleId)
            if puzzle is None:
                raise web.HTTPNotFound()

    color = puzzle["fen"].split()[1]
    chess960 = False
    dafault_perf = default_puzzle_perf(puzzle["eval"])
    puzzle_rating = int(round(puzzle.get("perf", dafault_perf)["gl"]["r"], 0))
    variant = puzzle["variant"]
    if color == "w":
        wrating = int(round(user.get_puzzle_rating(variant, chess960).mu, 0))
        brating = puzzle_rating
    else:
        brating = int(round(user.get_puzzle_rating(variant, chess960).mu, 0))
        wrating = puzzle_rating

    context["view_css"] = "analysis.css"
    context["extra_css"] = "puzzle.css"
    context["variant"] = variant
    context["fen"] = puzzle["fen"]
    context["wrating"] = wrating
    context["brating"] = brating
    context["puzzle"] = json.dumps(puzzle, default=datetime.isoformat)

    return context


async def api_campaign_levels(request):
    variant = request.match_info.get("variant", "matatak")
    levels = load_campaign(variant)
    return web.json_response(levels)

