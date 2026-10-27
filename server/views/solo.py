from aiohttp import web

from const import STARTED
from pychess_global_app_state_utils import get_app_state
from utils import load_game
from views import get_user_context
from wsl import abort_if_not_started, creer_partie_solo


async def solo(request):
    """/jouer/solo?variant=matatakmini&level=1 : crée une partie Solo et y mène directement.

    Utilisé à la fin du tutoriel et par la page des équipes (« Première partie ») : avant, le lien
    passait par /jouer?auto_ai=1, qui affichait le menu un instant avant de repartir.
    L'Aventure s'en sert aussi pour « Partie suivante » : `fen`, `color` (w ou b) et les Rois `rw` / `rb`
    (Saison de chaque camp) ; la position est validée par utils.new_game, les Rois par creer_partie_solo."""
    user, _context = await get_user_context(request)
    app_state = get_app_state(request.app)

    variant = request.query.get("variant", "matatakmini")
    if variant not in ("matatak", "matatakmini"):
        variant = "matatakmini"
    try:
        level = min(20, max(1, int(request.query.get("level", "1"))))
    except ValueError:
        level = 1

    # Une partie commencée en cours : on y retourne ; une partie pas commencée est annulée
    if user.game_in_progress is not None:
        game = await load_game(app_state, user.game_in_progress)
        if game is not None and game.status <= STARTED and not await abort_if_not_started(game, user):
            raise web.HTTPFound("/" + game.id)
        user.game_in_progress = None

    color = request.query.get("color", "r")
    if color not in ("w", "b"):
        color = "r"
    rw, rb = request.query.get("rw"), request.query.get("rb")
    data = {
        "variant": variant, "fen": request.query.get("fen", "")[:200], "color": color,
        "minutes": 0, "increment": 0,
        "byoyomiPeriod": 0, "rated": False, "level": level, "chess960": False, "rm": False,
        "draft": False, "boost": 0,
    }
    if rw and rb:
        data["rois"] = {"white": rw, "black": rb}
    response = await creer_partie_solo(app_state, user, data)
    if response.get("type") == "new_game":
        raise web.HTTPFound("/" + response["gameId"])
    raise web.HTTPFound("/jouer")
