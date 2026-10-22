"""Parcours de joueur dans Chromium, à relancer avant chaque déploiement.

Chaque test raconte ce qu'un joueur fait et vérifie ce qu'il doit voir. Ils couvrent ce qui a déjà
cassé ou ce qui casserait le plus de parties : pages, Solo, Draft (ordinateur et entre amis),
sécurité de la WebSocket, éditeur, analyse, fin de partie, installation de l'appli.
"""

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
    "/apprendre",
    "/collection",
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
        await page.wait_for_selector("cg-board", timeout=15000)
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


async def test_bandeau_installation_apres_une_partie_et_croix(site, chromium):
    page, game_id = await partie_solo(chromium, site, niveau=1, telephone=True)
    await page.goto(site + "/jouer")
    assert await page.locator(".bandeau-installer").count() == 0  # pas avant une partie finie
    page2, game_id = await partie_solo(chromium, site, niveau=1, telephone=True)
    await envoyer(page2, {"type": "resign", "gameId": game_id})
    await page2.wait_for_selector(".fin-partie", timeout=10000)
    await page2.goto(site + "/jouer")
    await page2.wait_for_selector(".bandeau-installer", timeout=5000)
    await page2.click(".bandeau-installer .fermer")
    await page2.goto(site + "/jouer")
    await page2.wait_for_timeout(800)
    assert await page2.locator(".bandeau-installer").count() == 0  # plus jamais après la croix


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
    await page.locator(".engine-toggle label").first.click()
    assert await attendre(page, "document.querySelector('#score') && document.querySelector('#score').textContent.trim() !== ''", 15000)
    assert await attendre(page, "getComputedStyle(document.getElementById('gauge')).getPropertyValue('--noirs') !== ''", 5000)
    assert not page.erreurs, page.erreurs
