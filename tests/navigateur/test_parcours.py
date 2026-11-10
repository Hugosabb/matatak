"""Parcours de joueur dans Chromium, à relancer avant chaque déploiement.

Chaque test raconte ce qu'un joueur fait et vérifie ce qu'il doit voir. Ils couvrent ce qui a déjà
cassé ou ce qui casserait le plus de parties : pages, Solo, Draft (ordinateur et entre amis),
sécurité de la WebSocket, éditeur, analyse, fin de partie, installation de l'appli.
"""

import pyffish as sf
import pytest

from conftest import (
    attendre,
    couleur_du_joueur,
    debug,
    dernier_plateau,
    ecouter_partie,
    envoyer,
    id_partie,
    jouer_un_coup,
    ouvrir,
)

pytestmark = pytest.mark.asyncio

PAGES = [
    "/",
    "/jouer",
    "/confidentialite",
    "/collection",
    "/palmares",
    "/tutorial/1",
    "/puzzle/campaign/matatakmini",
    "/editor/matatakmini",
    "/editor/matatak",
    "/analysis/matatakmini",
    "/analysis/matatak",
]


@pytest.mark.parametrize("telephone", [False, True], ids=["ordinateur", "telephone"])
async def test_pages_sans_erreur_ni_defilement_horizontal(site, chromium, telephone):
    page = await ouvrir(chromium, site, telephone)
    problemes = []
    for chemin in PAGES:
        reponse = await page.goto(site + chemin)
        await page.wait_for_timeout(800)
        if reponse.status != 200:
            problemes.append(f"{chemin} : statut {reponse.status}")
        if await page.evaluate("document.documentElement.scrollWidth > innerWidth + 1"):
            problemes.append(f"{chemin} : défilement horizontal")
    assert not problemes, problemes
    assert not page.erreurs, page.erreurs


async def partie_solo(chromium, site, niveau=1, telephone=False):
    page = await ouvrir(chromium, site, telephone)
    await page.goto(f"{site}/jouer/solo?variant=matatakmini&level={niveau}")
    await page.wait_for_selector("cg-board")
    game_id = id_partie(page)
    await ecouter_partie(page, game_id)
    return page, game_id


async def test_solo_l_ordinateur_repond_et_montre_qu_il_reflechit(site, chromium):
    page, game_id = await partie_solo(chromium, site, niveau=3)
    moi = await couleur_du_joueur(page)
    reflechit = False
    for _ in range(3):
        n = await page.evaluate("window.__msgs.length")
        if (await dernier_plateau(page))["fen"].split(" ")[1] == moi:
            await jouer_un_coup(page, game_id)
        # L'ordinateur réfléchit (losanges après son nom), puis rend la main
        reflechit |= await attendre(page, "document.body.className.includes('ordi-reflechit')", 5000)
        assert await attendre(
            page,
            "([n, moi]) => window.__msgs.slice(n).some(m => m.type === 'board' && m.fen.split(' ')[1] === moi)",
            12000,
            [n, moi],
        ), "l'ordinateur n'a pas joué"
    assert reflechit, "les losanges « réfléchit » ne se sont jamais affichés"
    assert not page.erreurs, page.erreurs


async def test_reculer_pendant_que_l_ordinateur_reflechit_ne_perd_pas_son_coup(site, chromium):
    """Bug d'Hugo (03/11/2026) : reculer dans les coups pendant que l'ordinateur réfléchit lui
    faisait jeter son coup (comparaison avec le coup affiché) : il ne jouait plus jamais."""
    page, game_id = await partie_solo(chromium, site, niveau=3)
    moi = await couleur_du_joueur(page)
    # Au moins deux demi-coups, pour pouvoir reculer
    while (await dernier_plateau(page))["ply"] < 2 or (await dernier_plateau(page))["fen"].split(" ")[1] != moi:
        n = await page.evaluate("window.__msgs.length")
        if (await dernier_plateau(page))["fen"].split(" ")[1] == moi:
            await jouer_un_coup(page, game_id)
        await attendre(page, "n => window.__msgs.slice(n).some(m => m.type === 'board')", 12000, n)
    n = await page.evaluate("window.__msgs.length")
    plateau = await jouer_un_coup(page, game_id)
    assert await attendre(page, "document.body.className.includes('ordi-reflechit')", 5000)
    await page.get_by_role("button", name="Coup précédent").click()
    await page.get_by_role("button", name="Coup précédent").click()
    assert await attendre(
        page,
        "([n, moi]) => window.__msgs.slice(n).some(m => m.type === 'board' && m.fen.split(' ')[1] === moi)",
        12000,
        [n, moi],
    ), "l'ordinateur n'a pas joué"
    # Son coup s'affiche : la liste des coups est revenue au dernier
    dernier = plateau["ply"] + 2
    assert await attendre(page, f"document.querySelector('#movelist move.active')?.getAttribute('ply') === '{dernier}'", 5000)
    assert not page.erreurs, page.erreurs


async def test_pre_coup_contre_l_ordinateur(site, chromium):
    """Pré-coup (Hugo, 03/11/2026) : un seul, actif par défaut, aussi contre l'ordinateur. Posé
    pendant qu'il réfléchit, il part tout seul après sa réponse s'il est encore possible."""
    page, game_id = await partie_solo(chromium, site, niveau=3)
    moi = await couleur_du_joueur(page)
    if (await dernier_plateau(page))["fen"].split(" ")[1] != moi:
        assert await attendre(page, "m => window.__msgs.some(x => x.type === 'board' && x.fen.split(' ')[1] === m)", 12000, moi)
    plateau = await jouer_un_coup(page, game_id)
    assert await attendre(page, "document.body.className.includes('ordi-reflechit')", 5000)
    # Un coup à moi, comme si c'était mon tour (même position, trait inversé)
    fen = (await dernier_plateau(page))["fen"]
    parts = fen.split(" ")
    parts[1] = moi
    coup = sf.legal_moves("matatakmini", " ".join(parts), [])[0]
    bb = await page.locator("cg-board").first.bounding_box()
    noir = moi == "b"

    def centre(case):
        f, r = ord(case[0]) - 97, int(case[1:]) - 1
        x = (3 - f if noir else f) + 0.5
        y = (r if noir else 7 - r) + 0.5
        return bb["x"] + x * bb["width"] / 4, bb["y"] + y * bb["height"] / 8

    for case in (coup[:2], coup[2:4]):
        await page.mouse.click(*centre(case))
        await page.wait_for_timeout(150)
    reponse = plateau["ply"] + 2
    # Posé, ou déjà parti si l'ordinateur a répondu très vite (pendant les clics, sous la charge de la
    # suite complète : le coup part alors en pré-coup ou comme un coup normal, les deux sont justes)
    joue = "([p, c]) => window.__msgs.some(m => m.type === 'board' && m.ply === p && m.lastMove && (m.lastMove.join ? m.lastMove.join('') : m.lastMove).startsWith(c))"
    pose = await page.locator("square.current-premove").count() >= 1
    assert pose or await attendre(page, joue, 3000, [reponse + 1, coup[:4]]), "pré-coup non posé"
    # L'ordinateur répond, puis le pré-coup part (s'il est encore possible dans la nouvelle position)
    assert await attendre(page, f"window.__msgs.some(m => m.type === 'board' && m.ply === {reponse})", 12000)
    apres = [m for m in await page.evaluate("window.__msgs") if m.get("type") == "board" and m.get("ply") == reponse][-1]
    if coup in sf.legal_moves("matatakmini", apres["fen"], []):
        assert await attendre(page, f"window.__msgs.some(m => m.type === 'board' && m.ply === {reponse + 1})", 15000), "pré-coup non joué"
    assert not page.erreurs, page.erreurs


async def test_reglage_des_pre_coups_dans_le_menu(site, chromium):
    """Pré-coups réglables dans le menu ⋯ (Hugo, 10/11/2026) ; le choix est gardé pour la partie suivante."""
    page, _ = await partie_solo(chromium, site, niveau=1, telephone=True)
    await page.locator('#barre-partie button[aria-haspopup="menu"]').tap()
    reglage = page.locator(".barre-action.reglage")
    await reglage.wait_for(state="visible", timeout=5000)
    assert await reglage.get_attribute("aria-checked") == "true"  # pas d'Aventure commencée : activés
    await reglage.tap()
    assert await attendre(page, "document.querySelector('.barre-action.reglage')?.getAttribute('aria-checked') === 'false'", 3000)
    assert await page.evaluate("localStorage.getItem('matatak_precoups')") == "non"
    assert not page.erreurs, page.erreurs


async def test_abandon_confirme_dans_le_menu_sans_fenetre_du_navigateur(site, chromium):
    """Abandonner : confirmation dans le menu ⋯ de la partie, plus de confirm() du navigateur (23/10/2026)."""
    page, game_id = await partie_solo(chromium, site, niveau=1, telephone=True)
    page.on("dialog", lambda d: (_ for _ in ()).throw(AssertionError("fenêtre du navigateur : " + d.message)))
    moi = await couleur_du_joueur(page)
    # « Abandonner » n'apparaît qu'après 2 demi-coups (avant : « Annuler la partie »)
    for _ in range(3):
        if len([m for m in await page.evaluate("window.__msgs") if m.get("type") == "board"]) and (
            await dernier_plateau(page)
        )["ply"] >= 2:
            break
        if (await dernier_plateau(page))["fen"].split(" ")[1] == moi:
            await jouer_un_coup(page, game_id)
        await attendre(page, "window.__msgs.some(m => m.type === 'board' && m.ply >= 2)", 12000)
    await page.locator("#barre-partie .barre-btn").first.click()
    await page.locator(".barre-action", has_text="Abandonner").click()
    assert await page.locator(".barre-question").inner_text() == "Vraiment abandonner ?"
    await page.locator(".barre-action", has_text="Oui, abandonner").click()
    await page.wait_for_selector(".fin-partie", timeout=10000)
    assert "Vous avez abandonné" in await page.locator(".fin-partie").inner_text()
    assert not page.erreurs, page.erreurs


async def une_etape_de_draft(page, choix_groupe=0):
    """Fait l'étape affichée à ce joueur, s'il a la main. Renvoie le titre vu."""
    if not await page.locator(".dr-titre").count():
        return ""
    titre = await page.locator(".dr-titre").inner_text()
    bouton = page.locator(".dr-valider")
    if not await bouton.count() or (not titre.startswith("Choisissez") and not await bouton.is_enabled()):
        return titre
    if titre.startswith("Choisissez"):
        await page.locator(".dr-zone.choix").nth(choix_groupe).click()
    elif titre.startswith("Formez"):
        # Toucher deux cartes de groupes différents les échange (la 2e carte : jamais un Roi)
        groupe1 = page.locator(".dr-zone").nth(0).locator("button.dr-carte").nth(1)
        groupe2 = page.locator(".dr-zone").nth(1).locator("button.dr-carte").nth(1)
        piece = lambda carte: carte.locator("piece").get_attribute("class")  # noqa: E731
        avant = [await piece(groupe1), await piece(groupe2)]
        await groupe1.click()
        await groupe2.click()
        assert [await piece(groupe1), await piece(groupe2)] == avant[::-1], "pas d'échange"
    elif titre.startswith("Placez"):
        rangee = page.locator(".dr-rangee").first.locator("button.dr-carte")
        await rangee.nth(0).click()
        await rangee.nth(2).click()  # échange deux Pions
    if await bouton.is_enabled():
        await bouton.click()
    return titre


async def en_draft(page):
    return await page.evaluate("document.body.classList.contains('en-draft')")


async def lancer_draft_solo(page, site):
    await page.evaluate(
        "localStorage.setItem('jouer_choix', JSON.stringify({adv: 'ia', variant: 'matatakmini', level: 2}))"
    )
    await page.goto(site + "/jouer")
    # L'onglet Solo ouvre l'Aventure : le Draft contre l'ordinateur est dans « Partie libre »
    await page.locator(".av-lien", has_text="Partie libre").click()
    await page.click("button.plus")
    await page.locator("label.interrupteur").first.click()
    await page.locator("button.lancer").dispatch_event("click")
    await page.wait_for_selector("#draft-ecran .draft", timeout=15000)


@pytest.mark.parametrize("telephone", [False, True], ids=["ordinateur", "telephone"])
async def test_draft_contre_l_ordinateur_jusqu_au_plateau(site, chromium, telephone):
    page = await ouvrir(chromium, site, telephone)
    await lancer_draft_solo(page, site)
    vu = []
    for _ in range(40):
        if not await en_draft(page):
            break
        titre = await une_etape_de_draft(page)
        if titre and titre not in vu:
            vu.append(titre)
        await page.wait_for_timeout(500)
    assert not await en_draft(page), vu
    # Une étape de chaque sorte, et le choix de l'ordinateur montré
    assert any(t.startswith("Formez") for t in vu), vu
    assert any(t.startswith("Choisissez") for t in vu), vu
    assert any(t.startswith("Placez") for t in vu), vu
    assert any("prend ce groupe" in t for t in vu), vu
    # Plateau : 2 équipes de 6 Personnages
    game_id = id_partie(page)
    await ecouter_partie(page, game_id)
    fen = (await dernier_plateau(page))["fen"].split(" ")[0]
    assert sum(c.isalpha() for c in fen) == 12, fen
    assert not page.erreurs, page.erreurs


async def inviter_un_ami(chromium, site, draft=False):
    """Hôte sur ordinateur, invité sur téléphone ; renvoie les deux pages sur la partie."""
    hote = await ouvrir(chromium, site)
    await hote.evaluate(
        "localStorage.setItem('jouer_choix', JSON.stringify({adv: 'ami', variant: 'matatakmini'}))"
    )
    await hote.goto(site + "/jouer")
    if draft:
        await hote.click("button.plus")
        await hote.locator("label.interrupteur").first.click()
    await hote.locator("button.lancer").dispatch_event("click")
    await hote.wait_for_url("**/invite/**", timeout=15000)
    ami = await ouvrir(chromium, site, telephone=True)
    await ami.goto(hote.url)
    await ami.click("text=Rejoindre la partie")
    for page in (hote, ami):
        # « attached » : pendant un Draft, le plateau est là mais caché par l'écran du Draft
        await page.wait_for_selector("cg-board", state="attached", timeout=15000)
    return hote, ami


async def test_draft_entre_amis(site, chromium):
    hote, ami = await inviter_un_ami(chromium, site, draft=True)
    for page in (hote, ami):
        assert await attendre(page, "document.body.classList.contains('en-draft')", 10000), "pas d'écran de Draft"
    for _ in range(30):
        if not (await en_draft(hote) or await en_draft(ami)):
            break
        for page in (hote, ami):
            if await en_draft(page):
                await une_etape_de_draft(page)
        await hote.wait_for_timeout(800)
    for page in (hote, ami):
        assert not await en_draft(page)
        assert not page.erreurs, page.erreurs


async def test_un_spectateur_ne_peut_rien_faire_a_la_place_des_joueurs(site, chromium):
    hote, ami = await inviter_un_ami(chromium, site)
    game_id = id_partie(hote)
    curieux = await ouvrir(chromium, site)
    await curieux.goto(f"{site}/{game_id}")
    await curieux.wait_for_selector("cg-board")
    await ecouter_partie(curieux, game_id)
    for message in ({"type": "resign"}, {"type": "abort"}, {"type": "delete"}, {"type": "draw"}):
        await envoyer(curieux, {**message, "gameId": game_id})
    await curieux.wait_for_timeout(1500)
    await ecouter_partie(hote, game_id)
    plateau = await dernier_plateau(hote)
    assert plateau["status"] < 0, debug(plateau)  # partie toujours en cours (pas annulée ni perdue)


async def test_fin_de_partie_puis_rejouer_contre_l_ordinateur(site, chromium):
    page, game_id = await partie_solo(chromium, site, niveau=1, telephone=True)
    await envoyer(page, {"type": "resign", "gameId": game_id})
    await page.wait_for_selector(".fin-partie", timeout=10000)
    texte = await page.locator(".fin-partie").inner_text()
    assert "Défaite" in texte and "Vous avez abandonné" in texte, texte
    await page.locator(".fin-partie .mt-btn-or").click()
    await page.wait_for_url(lambda url: id_partie_url(url) != game_id, timeout=10000)
    await page.wait_for_selector("cg-board")
    assert not page.erreurs, page.erreurs


def id_partie_url(url):
    return url.rstrip("/").split("/")[-1].split("?")[0]


async def test_barre_du_bas_modes_balayage_et_plus(site, chromium):
    """Téléphone en portrait (Hugo, 10/11/2026) : une rangée Aventure · Défier un ami · Arène · Plus ;
    les modes changent sur place, balayer passe au mode voisin, « Plus » ouvre toutes les pages (plus de
    page Apprendre ni de « Le jeu » dans la barre), le compte et « Installer l'appli »."""
    page = await ouvrir(chromium, site, telephone=True)
    await page.goto(site + "/jouer?mode=ami")
    await page.wait_for_selector(".jouer-page .grille")
    visibles = await page.evaluate("[...document.querySelectorAll('.mt-tab > *')].filter(e => e.offsetParent).map(e => e.textContent.trim())")
    assert visibles == ["Aventure", "Défier un ami", "Arène", "Plus"], visibles
    actif = "() => [...document.querySelectorAll('.mt-tab a.actif')].filter(e => e.offsetParent).map(e => e.dataset.mode)"
    assert await page.evaluate(actif) == ["ami"]
    assert await page.locator(".choix-adv-bas").is_hidden()  # plus de seconde rangée
    assert await page.locator(".bandeau-installer").count() == 0
    # Toucher « Arène » : même page, onglet changé
    url = page.url
    await page.locator('.mt-tab a[data-mode="classee"]').tap()
    assert await attendre(page, "() => document.querySelector('.mt-tab a[data-mode=classee]').classList.contains('actif')", 3000)
    assert page.url.split("?")[0] == url.split("?")[0]
    # Balayer vers la droite : retour à « Défier un ami »
    await page.evaluate("""() => { const el = document.querySelector('.jouer-page');
        const t = (type, x) => el.dispatchEvent(new TouchEvent(type, {bubbles: true,
            touches: type === 'touchend' ? [] : [new Touch({identifier: 1, target: el, clientX: x, clientY: 300})],
            changedTouches: [new Touch({identifier: 1, target: el, clientX: x, clientY: 300})]}));
        t('touchstart', 60); t('touchend', 260); }""")
    assert await attendre(page, "() => document.querySelector('.mt-tab a[data-mode=ami]').classList.contains('actif')", 3000)
    # « Plus »
    await page.locator(".mt-tab .mt-plus-bouton").tap()
    panneau = page.locator("#mt-plus")
    await panneau.wait_for(state="visible", timeout=3000)
    texte = await panneau.inner_text()
    for mot in ("Tutoriel", "Collection", "Puzzles", "Palmarès", "Analyse", "Éditeur", "Le jeu de société", "Se connecter"):
        assert mot in texte, (mot, texte)
    assert "Apprendre" not in texte, texte
    await page.locator(".mt-plus-fond").tap(position={"x": 20, "y": 20})
    await panneau.wait_for(state="hidden", timeout=3000)
    # Depuis une autre page, l'onglet mène au bon mode de /jouer
    await page.goto(site + "/collection")
    await page.locator('.mt-tab a[data-mode="classee"]').tap()
    await page.wait_for_url("**/jouer**")
    assert await attendre(page, "() => document.querySelector('.mt-tab a[data-mode=classee]')?.classList.contains('actif')", 5000)
    assert not page.erreurs, page.erreurs


@pytest.mark.parametrize("bouton,mode", [("#challengeAI", "ia"), ("#createseek", "ami")])
async def test_editeur_vers_jouer_avec_la_position(site, chromium, bouton, mode):
    """Plus de champ FEN dans /jouer (Hugo, 10/11/2026) : l'éditeur envoie sa position au nouvel écran
    (avant : l'ancien salon de pychess, en anglais)."""
    page = await ouvrir(chromium, site)
    await page.goto(site + "/editor/matatakmini")
    await page.wait_for_selector(".ed-carte")
    await page.locator(bouton).click()
    await page.wait_for_selector(".position-editeur", timeout=8000)
    assert await page.locator("#jouer-fen").count() == 0
    actif = f'.mt-onglets a.actif, .choix-adv button.on, .mt-tab a[data-mode="{mode}"].actif'
    assert await page.locator(actif).count() >= 1
    assert await page.locator(".jouer-page .lancer").count() >= 1
    assert not page.erreurs, page.erreurs


async def test_balayer_vers_l_arene_ne_fait_pas_bouger_la_barre_du_bas(site, chromium):
    """La grille qui arrive par la droite débordait : la page s'élargissait et la barre fixée en bas descendait
    le temps de l'animation, dans un seul sens (Hugo, 10/11/2026)."""
    page = await ouvrir(chromium, site, telephone=True)
    await page.goto(site + "/jouer?mode=ami")
    await page.wait_for_selector(".jouer-page .grille")
    await page.evaluate("""() => { window.__hauts = new Set(); const t = document.querySelector('.mt-tab');
        const f = () => { window.__hauts.add(Math.round(t.getBoundingClientRect().top)); requestAnimationFrame(f); }; f(); }""")
    await page.evaluate("""() => { const el = document.querySelector('.jouer-page');
        const t = (type, x) => el.dispatchEvent(new TouchEvent(type, {bubbles: true,
            touches: type === 'touchend' ? [] : [new Touch({identifier: 1, target: el, clientX: x, clientY: 300})],
            changedTouches: [new Touch({identifier: 1, target: el, clientX: x, clientY: 300})]}));
        t('touchstart', 300); t('touchend', 80); }""")
    assert await attendre(page, "() => document.querySelector('.mt-tab a[data-mode=classee]').classList.contains('actif')", 3000)
    await page.wait_for_timeout(700)
    hauts = await page.evaluate("[...window.__hauts]")
    assert len(hauts) == 1, hauts
    assert not page.erreurs, page.erreurs


async def test_editeur_toucher_pour_poser_et_gommer(site, chromium):
    page = await ouvrir(chromium, site, telephone=True)
    await page.goto(site + "/editor/matatakmini")
    await page.wait_for_selector(".ed-carte")
    avant = await page.input_value("#fen")
    await page.locator(".ed-carte").nth(5).tap()
    boite = await page.locator("cg-board").bounding_box()
    case = (boite["x"] + boite["width"] * 0.125, boite["y"] + boite["height"] * 0.4375)
    await page.touchscreen.tap(*case)
    posee = await page.input_value("#fen")
    assert posee != avant, "la carte n'a pas été posée"
    await page.locator(".gomme").tap()
    await page.touchscreen.tap(*case)
    assert (await page.input_value("#fen")).split(" ")[0].split("[")[0] == avant.split(" ")[0].split("[")[0]
    assert not page.erreurs, page.erreurs


async def test_analyse_d_une_partie_moteur_et_jauge(site, chromium):
    page, game_id = await partie_solo(chromium, site, niveau=1)
    await envoyer(page, {"type": "resign", "gameId": game_id})
    await page.wait_for_selector(".fin-partie", timeout=10000)
    await page.goto(f"{site}/{game_id}?ply=0")
    await page.wait_for_selector("cg-board")
    # Même Roi que pendant la partie : en Solo niveau 1, l'ordinateur est AZAR (image k1)
    assert await attendre(page, "(document.getElementById('rois-partie') || {}).textContent?.includes('k1.jpg')", 5000)
    await page.locator(".engine-toggle label").first.click()
    assert await attendre(page, "document.querySelector('#score') && document.querySelector('#score').textContent.trim() !== ''", 15000)
    assert await attendre(page, "getComputedStyle(document.getElementById('gauge')).getPropertyValue('--noirs') !== ''", 5000)
    assert not page.erreurs, page.erreurs


async def _poser_pre_coup_sur(page, game_id, cible, toucher=False):
    """Pendant que l'ordinateur réfléchit, cherche une de mes cartes A et une case B de sa portée
    (cible = 'alliee' : B tient une de mes cartes ; 'adverse' : une carte adverse), touche A puis B.
    Renvoie (A, B) ou None s'il n'y a pas de tel couple dans la position."""
    moi = await couleur_du_joueur(page)
    bb = await page.locator("cg-board").first.bounding_box()
    noir = moi == "b"
    fen = (await dernier_plateau(page))["fen"].split(" ")[0]
    larg = sum(int(c) if c.isdigit() else 1 for c in fen.split("/")[0])

    def centre(case):
        f, r = ord(case[0]) - 97, int(case[1:]) - 1
        x = (larg - 1 - f if noir else f) + 0.5
        y = (r if noir else 7 - r) + 0.5
        return bb["x"] + x * bb["width"] / larg, bb["y"] + y * bb["height"] / 8

    cases = {}
    for r, rang in enumerate(fen.split("/")):
        f = 0
        for c in rang:
            if c.isdigit():
                f += int(c)
                continue
            cases[f"{chr(97 + f)}{8 - r}"] = "w" if c.isupper() else "b"
            f += 1
    async def clic(case):
        if toucher:
            await page.touchscreen.tap(*centre(case))
        else:
            await page.mouse.click(*centre(case))

    mes_cases = [k for k, v in cases.items() if v == moi]
    voulues = [k for k, v in cases.items() if (v == moi) == (cible == "alliee")]
    for a in mes_cases:
        await clic(a)
        await page.wait_for_timeout(120)
        portee = await page.evaluate(
            "() => [...document.querySelectorAll('cg-board square.premove-dest')].map(s => s.cgKey)"
        )
        b = next((k for k in voulues if k in portee and k != a), None)
        if b:
            await clic(b)
            await page.wait_for_timeout(150)
            return a, b
        await clic(a)  # désélectionne
        await page.wait_for_timeout(80)
    return None


@pytest.mark.parametrize("cible", ["alliee"])
async def test_pre_coup_au_doigt_sur_une_carte(site, chromium, cible):
    """Bug d'Hugo (10/11/2026) : au doigt, pendant le tour adverse, toucher sa carte puis une case de
    sa portée tenue par une carte (alliée : recapture ; adverse : capture) doit poser le pré-coup,
    comme Lichess, et non sélectionner l'autre carte ou montrer ses déplacements. S'il devient
    légal après le coup adverse, il est joué."""
    hote, ami = await inviter_un_ami(chromium, site)
    game_id = id_partie(hote)
    for page in (hote, ami):
        await ecouter_partie(page, game_id)
    moi = await couleur_du_joueur(ami)
    # L'ami (téléphone) attend : c'est à l'hôte de jouer
    for _ in range(2):
        plateau = await dernier_plateau(hote)
        if plateau["fen"].split(" ")[1] != moi:
            break
        await jouer_un_coup(ami, game_id)
        await attendre(hote, "p => window.__msgs.some(m => m.type === 'board' && m.ply === p)", 8000, plateau["ply"] + 1)
    await ami.wait_for_timeout(500)
    couple = await _poser_pre_coup_sur(ami, game_id, cible, toucher=True)
    if couple is None:
        pytest.skip(f"pas de carte {cible} à portée dans cette position")
    a, b = couple
    assert await ami.locator("square.current-premove").count() >= 1, f"pré-coup {a}{b} non posé"
    await ami.wait_for_timeout(100)
    assert await ami.evaluate("() => !document.querySelector('cg-container [data-motif]')"), "motif de la carte touchée affiché"
    # L'hôte joue ; si le pré-coup est alors légal, il part tout seul
    plateau = await dernier_plateau(hote)
    variante = "matatakmini" if sum(int(c) if c.isdigit() else 1 for c in plateau["fen"].split("/")[0]) == 4 else "matatak"
    coups = sf.legal_moves(variante, plateau["fen"], [])
    coup = next((c for c in coups if c[2:4] == b), coups[0])  # prendre la carte visée si possible
    await envoyer(hote, {"type": "move", "gameId": game_id, "move": coup, "clocks": [300000, 300000], "ply": plateau["ply"] + 1})
    apres_ply = plateau["ply"] + 1
    assert await attendre(ami, "p => window.__msgs.some(m => m.type === 'board' && m.ply === p)", 8000, apres_ply)
    apres = [m for m in await ami.evaluate("window.__msgs") if m.get("type") == "board" and m.get("ply") == apres_ply][-1]
    legaux = sf.legal_moves(variante, apres["fen"], [])
    if any(c.startswith(a + b) for c in legaux):
        assert await attendre(ami, "p => window.__msgs.some(m => m.type === 'board' && m.ply === p)", 8000, apres_ply + 1), f"pré-coup {a}{b} non joué"
    for page in (hote, ami):
        assert not page.erreurs, page.erreurs


def _cases_du_fen(fen):
    cases = {}
    for r, rang in enumerate(fen.split(" ")[0].split("/")):
        f = 0
        for c in rang:
            if c.isdigit():
                f += int(c)
                continue
            cases[f"{chr(97 + f)}{8 - r}"] = "w" if c.isupper() else "b"
            f += 1
    return cases


def _variante(fen):
    largeur = sum(int(c) if c.isdigit() else 1 for c in fen.split("/")[0])
    return "matatakmini" if largeur == 4 else "matatak"


def _recapture_possible(fen):
    """Dans fen (trait à l'hôte), un coup de l'hôte qui prend une carte en B, après lequel l'autre
    peut reprendre en B depuis A. Renvoie (coup de l'hôte, A, B) ou None."""
    cases = _cases_du_fen(fen)
    for coup in sf.legal_moves(_variante(fen), fen, []):
        b = coup[2:4]
        if b not in cases:
            continue
        apres = sf.get_fen(_variante(fen), fen, [coup])
        reprise = next((c for c in sf.legal_moves(_variante(fen), apres, []) if c[2:4] == b and len(c) == 4), None)
        if reprise:
            return coup, reprise[:2], b
    return None


async def test_pre_coup_de_recapture_au_doigt(site, chromium):
    """Bug d'Hugo (10/11/2026) : pendant le tour adverse, toucher sa carte A puis sa carte B (à portée de A) ;
    l'adversaire prend B ; le pré-coup A×B doit partir tout seul (recapture, comme Lichess)."""
    hote, ami = await inviter_un_ami(chromium, site)
    game_id = id_partie(hote)
    for page in (hote, ami):
        await ecouter_partie(page, game_id)
    moi = await couleur_du_joueur(ami)
    trouve = None
    for _ in range(40):  # on joue jusqu'à une position où l'hôte peut prendre une carte reprenable
        plateau = await dernier_plateau(hote)
        au_trait = plateau["fen"].split(" ")[1]
        if au_trait != moi:
            trouve = _recapture_possible(plateau["fen"])
            if trouve:
                break
        joueur = ami if au_trait == moi else hote
        coups = sf.legal_moves(_variante(plateau["fen"]), plateau["fen"], [])
        # éviter les captures pour garder des cartes sur le plateau
        cases = _cases_du_fen(plateau["fen"])
        sans_prise = [c for c in coups if c[2:4] not in cases] or coups
        coup = sans_prise[(plateau["ply"] * 7) % len(sans_prise)]
        await envoyer(joueur, {"type": "move", "gameId": game_id, "move": coup, "clocks": [300000, 300000], "ply": plateau["ply"] + 1})
        assert await attendre(hote, "p => window.__msgs.some(m => m.type === 'board' && m.ply === p)", 8000, plateau["ply"] + 1)
        if (await dernier_plateau(hote))["status"] >= 0:
            pytest.skip("partie finie avant une position de recapture")
    if not trouve:
        pytest.skip("pas de position de recapture trouvée")
    coup_hote, a, b = trouve
    await attendre(ami, "p => window.__msgs.some(m => m.type === 'board' && m.ply === p)", 8000, plateau["ply"])
    await ami.wait_for_timeout(400)
    bb = await ami.locator("cg-board").first.bounding_box()
    noir = moi == "b"
    larg = 4 if _variante(plateau["fen"]) == "matatakmini" else 8

    def centre(case):
        f, r = ord(case[0]) - 97, int(case[1:]) - 1
        x = (larg - 1 - f if noir else f) + 0.5
        y = (r if noir else 7 - r) + 0.5
        return bb["x"] + x * bb["width"] / larg, bb["y"] + y * bb["height"] / 8

    for case in (a, b):
        await ami.touchscreen.tap(*centre(case))
        await ami.wait_for_timeout(200)
    assert await ami.locator("square.current-premove").count() >= 1, f"pré-coup {a}{b} non posé"
    await envoyer(hote, {"type": "move", "gameId": game_id, "move": coup_hote, "clocks": [300000, 300000], "ply": plateau["ply"] + 1})
    assert await attendre(
        ami, "p => window.__msgs.some(m => m.type === 'board' && m.ply === p)", 8000, plateau["ply"] + 2
    ), f"recapture {a}{b} non jouée après {coup_hote}"
    for page in (hote, ami):
        assert not page.erreurs, page.erreurs


async def test_pre_coup_de_capture_au_doigt_sans_motif_adverse(site, chromium):
    """Pendant le tour adverse, toucher sa carte A puis une carte adverse B à sa portée pose le pré-coup
    A×B ; le motif de déplacement de B (losanges transparents) ne s'affiche pas (Hugo, 10/11/2026)."""
    hote, ami = await inviter_un_ami(chromium, site)
    game_id = id_partie(hote)
    for page in (hote, ami):
        await ecouter_partie(page, game_id)
    moi = await couleur_du_joueur(ami)
    trouve = None
    for _ in range(40):
        plateau = await dernier_plateau(hote)
        fen = plateau["fen"]
        au_trait = fen.split(" ")[1]
        cases = _cases_du_fen(fen)
        if au_trait != moi:
            parts = fen.split(" ")
            parts[1] = moi
            inverse = " ".join(parts)
            trouve = next((c for c in sf.legal_moves(_variante(fen), inverse, []) if c[2:4] in cases and len(c) == 4), None)
            if trouve:
                break
        joueur = ami if au_trait == moi else hote
        coups = sf.legal_moves(_variante(fen), fen, [])
        sans_prise = [c for c in coups if c[2:4] not in cases] or coups
        coup = sans_prise[(plateau["ply"] * 7) % len(sans_prise)]
        await envoyer(joueur, {"type": "move", "gameId": game_id, "move": coup, "clocks": [300000, 300000], "ply": plateau["ply"] + 1})
        assert await attendre(hote, "p => window.__msgs.some(m => m.type === 'board' && m.ply === p)", 8000, plateau["ply"] + 1)
    if not trouve:
        pytest.skip("pas de position de capture trouvée")
    a, b = trouve[:2], trouve[2:4]
    await attendre(ami, "p => window.__msgs.some(m => m.type === 'board' && m.ply === p)", 8000, plateau["ply"])
    await ami.wait_for_timeout(400)
    bb = await ami.locator("cg-board").first.bounding_box()
    noir = moi == "b"
    larg = 4 if _variante(fen) == "matatakmini" else 8

    def centre(case):
        f, r = ord(case[0]) - 97, int(case[1:]) - 1
        x = (larg - 1 - f if noir else f) + 0.5
        y = (r if noir else 7 - r) + 0.5
        return bb["x"] + x * bb["width"] / larg, bb["y"] + y * bb["height"] / 8

    for case in (a, b):
        await ami.touchscreen.tap(*centre(case))
        await ami.wait_for_timeout(200)
    assert await ami.locator("square.current-premove").count() >= 1, f"pré-coup {a}{b} non posé"
    assert await ami.evaluate("() => !document.querySelector('cg-container [data-motif]')"), "motif de la carte adverse affiché"
    for page in (hote, ami):
        assert not page.erreurs, page.erreurs


def _niveau_de_campagne(n, variant="matatakmini"):
    import json as _json

    niveaux = _json.load(open(f"server/campaign_{variant}.json"))
    return next(x for x in niveaux if x["level"] == n)


async def _toucher_coup(page, coup, noir=False, largeur=4):
    bb = await page.locator("cg-board").first.bounding_box()
    for case in (coup[:2], coup[2:4]):
        f, r = ord(case[0]) - 97, int(case[1:]) - 1
        x = (largeur - 1 - f if noir else f) + 0.5
        y = (r if noir else 7 - r) + 0.5
        await page.mouse.click(bb["x"] + x * bb["width"] / largeur, bb["y"] + y * bb["height"] / 8)
        await page.wait_for_timeout(150)


async def test_puzzle_rate_le_bon_coup_se_joue_et_niveau_suivant(site, chromium):
    """Puzzles (Hugo, 03/11/2026) : un mauvais coup, la carte revient, le bon coup se joue tout seul avec
    une flèche, « Raté » et « Niveau suivant » ; le niveau reste à refaire."""
    niveau = _niveau_de_campagne(1)
    page = await ouvrir(chromium, site, telephone=True)
    await page.goto(site + "/puzzle/matatakmini/level/1")
    await page.wait_for_selector("cg-board")
    bon = niveau["moves"].split(",")[0]
    mauvais = next(c for c in sf.legal_moves("matatakmini", niveau["fen"], []) if c != bon)
    await _toucher_coup(page, mauvais, noir=niveau["fen"].split()[1] == "b")
    fin = page.locator(".fin-puzzle")
    await fin.wait_for(timeout=5000)
    texte = await fin.inner_text()
    assert "Raté" in texte and "reste à refaire" in texte, texte
    assert (await fin.locator(".mt-btn-or").inner_text()).lower() == "niveau suivant"
    assert await fin.locator("button.fin-lien", has_text="Réessayer").count() == 1
    # Le bon coup a été joué (dernier coup) et la flèche le montre
    assert await page.locator(f"cg-board square.last-move").count() >= 1
    assert await page.locator("cg-container svg line, cg-container svg path").count() >= 1
    resolus = await page.evaluate("JSON.parse(localStorage.getItem('matatak_campaign_solved_matatakmini') || '[]')")
    assert 1 not in resolus
    assert not page.erreurs, page.erreurs


async def test_puzzle_indice_montre_la_carte_sans_faire_recommencer(site, chromium):
    niveau = _niveau_de_campagne(1)
    page = await ouvrir(chromium, site, telephone=True)
    await page.goto(site + "/puzzle/matatakmini/level/1")
    await page.wait_for_selector("cg-board")
    await page.locator("a.hint").wait_for(state="visible", timeout=8000)
    await page.locator("a.hint").click()
    await page.wait_for_timeout(300)
    bon = niveau["moves"].split(",")[0]
    # Un cercle sur la carte à jouer, pas de flèche vers la case d'arrivée
    assert await page.locator("cg-container svg circle").count() >= 1
    for i, coup in enumerate(niveau["moves"].split(",")):
        if i % 2 == 0:
            await _toucher_coup(page, coup, noir=niveau["fen"].split()[1] == "b")
            await page.wait_for_timeout(300)
    fin = page.locator(".fin-puzzle")
    await fin.wait_for(timeout=5000)
    texte = await fin.inner_text()
    assert "Réussi" in texte and "avec un indice" in texte, texte
    resolus = await page.evaluate("JSON.parse(localStorage.getItem('matatak_campaign_solved_matatakmini') || '[]')")
    assert 1 in resolus
    assert bon
    assert not page.erreurs, page.erreurs


async def test_partie_en_cours_fenetre_du_site_et_pas_du_navigateur(site, chromium):
    """Nettoyage (10/11/2026) : « Vous avez une partie en cours » est une fenêtre du site (client/fenetre.ts),
    plus un confirm() du navigateur ; « La reprendre » ramène à la partie."""
    page, game_id = await partie_solo(chromium, site, niveau=1, telephone=True)
    page.on("dialog", lambda d: (_ for _ in ()).throw(AssertionError("fenêtre du navigateur : " + d.message)))
    moi = await couleur_du_joueur(page)
    if (await dernier_plateau(page))["fen"].split(" ")[1] != moi:
        assert await attendre(page, "m => window.__msgs.some(x => x.type === 'board' && x.fen.split(' ')[1] === m)", 12000, moi)
    await jouer_un_coup(page, game_id)
    # Au moins deux coups : sinon la partie est annulée au lieu d'être signalée (wsl.abort_if_not_started)
    assert await attendre(page, "() => window.__msgs.some(m => m.type === 'board' && m.ply >= 2)", 15000)
    await page.goto(site + "/jouer?mode=classee")
    fenetre = page.locator("dialog.mt-fenetre")
    # Signalée dès l'arrivée, ou en lançant une recherche
    if not await attendre(page, "() => !!document.querySelector('dialog.mt-fenetre[open]')", 3000):
        await page.locator("button.lancer", has_text="Arène").click()
    await fenetre.wait_for(timeout=5000)
    assert "partie en cours" in (await fenetre.inner_text()).lower()
    await fenetre.locator(".mt-btn-or", has_text="La reprendre").click()
    await page.wait_for_url(f"**/{game_id}", timeout=5000)
    assert not page.erreurs, page.erreurs
