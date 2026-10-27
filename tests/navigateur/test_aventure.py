"""Parcours de l'Aventure (onglet Solo de /jouer, client/aventure/) : choix du Roi, route, partie."""

import os

import pytest

from conftest import attendre, dernier_plateau, ecouter_partie, envoyer, id_partie, ouvrir

pytestmark = pytest.mark.asyncio

# Captures d'écran pour relire la mise en page (facultatif)
CAPTURES = os.environ.get("MATATAK_CAPTURES")


async def capture(page, nom):
    if CAPTURES:
        await page.screenshot(path=os.path.join(CAPTURES, nom + ".png"))


@pytest.mark.parametrize("telephone", [False, True], ids=["ordinateur", "telephone"])
async def test_choisir_son_roi_puis_voir_la_route(site, chromium, telephone):
    page = await ouvrir(chromium, site, telephone)
    await page.evaluate("localStorage.setItem('jouer_choix', JSON.stringify({adv: 'ia', variant: 'matatakmini'}))")
    await page.goto(site + "/jouer")
    await page.wait_for_selector(".av-rois")
    assert await page.locator(".av-roi").count() == 4
    await capture(page, f"aventure-rois-{'tel' if telephone else 'pc'}")

    await page.locator(".av-roi", has_text="AZAR").click()
    await page.wait_for_selector(".av-route")
    # Même équipe de départ pour tous (DYSKO, TAMTAM, SHASHA) ; le premier rival est MOJO (le Printemps,
    # l'équipe la plus faible), avec BANJO
    assert (await page.locator("button.lancer").inner_text()).lower() == "niveau 1"
    assert "MOJO" in await page.locator(".av-guide").inner_text()
    assert "BANJO" in await page.locator(".av-guide").inner_text()
    assert await page.locator(".av-niveau.courant").count() == 1
    await capture(page, f"aventure-route-{'tel' if telephone else 'pc'}")

    await page.locator(".av-apercu").click()
    await page.wait_for_selector(".av-formation")
    assert await page.locator(".av-formation .av-case img").count() == 4  # Roi, DYSKO, TAMTAM, SHASHA
    # Toutes les recrues sont dans l'équipe : l'enclos attend les suivantes
    await page.wait_for_selector(".av-enclos-vide")
    await capture(page, f"aventure-equipe-{'tel' if telephone else 'pc'}")

    assert await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    assert not page.erreurs, page.erreurs


@pytest.mark.parametrize("telephone", [False, True], ids=["ordinateur", "telephone"])
async def test_une_partie_de_l_aventure_perdue_se_rejoue(site, chromium, telephone):
    page = await ouvrir(chromium, site, telephone)
    page.on("dialog", lambda d: d.accept())
    await page.evaluate(
        """localStorage.setItem('jouer_choix', JSON.stringify({adv: 'ia', variant: 'matatakmini'}));
        localStorage.setItem('matatak_aventure_plateau_auto', 'non');
        localStorage.setItem('matatak_aventure', JSON.stringify({
            version: 1, roi: 'AZAR', recrues: ['DYSKO', 'TAMTAM', 'SHASHA'], equipe: {champions: ['DYSKO'], pions: ['TAMTAM', 'SHASHA']},
            etape: 0, victoires: 0, niveauOrdi: 12, parties: 10, flamme: {jours: 0, dernier: ''}, plateau: 'matatakmini'}))"""
    )
    await page.goto(site + "/jouer")
    await page.wait_for_selector(".av-route")
    await page.locator("button.lancer").click()
    await page.wait_for_url(lambda url: "/jouer" not in url, timeout=15000)
    gid = id_partie(page)
    assert await page.evaluate("gid => JSON.parse(localStorage.getItem('matatak_aventure_partie')).gameId === gid", gid)

    # Position de l'Aventure : AZAR (le joueur, Blancs : DYSKO, TAMTAM, SHASHA) contre MOJO (DYSKO, BANJO ×2)
    await ecouter_partie(page, gid)
    assert await attendre(page, "() => window.__msgs.some(m => m.type === 'board')")
    plateau = await dernier_plateau(page)
    # (l'équipe de MOJO dépend de client/aventure/niveaux.ts, édité à la main)
    placement = plateau["fen"].split()[0]
    assert placement.startswith("1kc1/1") and "m" in placement.split("/")[1], plateau["fen"]
    assert placement.endswith("/4/4/4/4/1FB1/1CK1"), plateau["fen"]
    # Le bandeau de l'ordinateur porte le nom du Roi rival
    assert await attendre(page, "() => document.body.innerText.includes('MOJO')")
    if not telephone:  # panneau d'infos : le Roi rival MOJO, pas KARMA, le Roi du palier du niveau 12
        assert "MOJO" in await page.locator(".game-info").inner_text()
    # Le niveau de l'ordinateur reste caché dans l'Aventure
    assert "Niv." not in await page.evaluate("[...document.querySelectorAll('round-player0, round-player1')].map(e => e.innerText).join(' ')")
    await capture(page, f"aventure-partie-{'tel' if telephone else 'pc'}")

    await envoyer(page, {"type": "resign", "gameId": gid})
    await page.wait_for_selector(".fin-partie")
    # « Rejouer » crée la partie suivante tout de suite, sans repasser par /jouer
    principal = page.locator(".fin-partie .mt-btn-or")
    assert await principal.inner_text() == "Rejouer"
    await capture(page, f"aventure-fin-{'tel' if telephone else 'pc'}")
    progression = await page.evaluate("JSON.parse(localStorage.getItem('matatak_aventure'))")
    assert progression["parties"] == 11 and progression["etape"] == 0 and progression["niveauOrdi"] == 10
    # Recharger la page ne compte pas la défaite deux fois
    await page.reload()
    await page.wait_for_selector(".fin-partie")
    assert (await page.evaluate("JSON.parse(localStorage.getItem('matatak_aventure'))"))["parties"] == 11

    # « Rejouer » relance aussitôt la même étape
    await page.locator(".fin-partie .mt-btn-or").click()
    await page.wait_for_url(lambda url: "/jouer" not in url and gid not in url, timeout=15000)
    # La nouvelle partie est bien celle de l'Aventure (bug du 27/10 : jamais rattachée, elle ne comptait
    # pas et, annulée, montrait « Nouveau Draft »)
    gid2 = id_partie(page)
    assert await attendre(page, "gid => JSON.parse(localStorage.getItem('matatak_aventure_partie')).gameId === gid", argument=gid2)
    await ecouter_partie(page, gid2)
    await envoyer(page, {"type": "abort", "gameId": gid2})
    await page.wait_for_selector(".fin-partie")
    assert "Nouveau Draft" not in await page.locator(".fin-partie").inner_text()
    assert await page.locator(".fin-partie a.fin-lien", has_text="Voir l'Aventure").count() == 1
    assert not page.erreurs, page.erreurs


PHASE_2 = """localStorage.setItem('jouer_choix', JSON.stringify({adv: 'ia', variant: 'matatak'}));
localStorage.setItem('matatak_aventure', JSON.stringify({
    version: 1, roi: 'AZAR', recrues: ['KRAK', 'TAMTAM', 'SHASHA', 'ROKK', 'BONGO', 'FRANK', 'BANJO', 'DYSKO'],
    equipe: {champions: ['KRAK'], pions: ['TAMTAM', 'SHASHA', 'BONGO']},
    etape: 6, victoires: 1, niveauOrdi: 7, parties: 9, flamme: {jours: 3, dernier: '2026-10-23'}, plateau: 'matatak'}))"""


@pytest.mark.parametrize("telephone", [False, True], ids=["ordinateur", "telephone"])
async def test_mon_equipe_un_seul_exemplaire_et_changer_de_roi(site, chromium, telephone):
    page = await ouvrir(chromium, site, telephone)
    await page.evaluate(PHASE_2)
    await page.goto(site + "/jouer")
    await page.wait_for_selector(".av-route")
    assert "Encore 1 victoire" in await page.locator(".av-guide").inner_text()  # 1re victoire sur 2
    await capture(page, f"aventure-phase2-{'tel' if telephone else 'pc'}")
    await page.locator(".av-apercu").click()
    # 5 places : 1 Champion, 3 Pions, et le Roi (débloqué : la phase 1 est finie)
    assert await page.locator(".av-formation .av-case img").count() == 5
    # Dans l'enclos : les 4 recrues hors de l'équipe et les 3 autres Rois
    await page.wait_for_selector('.av-enclos [data-nom="BANJO"]')
    assert await page.locator(".av-enclos .av-perso").count() == 7
    lire = "JSON.parse(localStorage.getItem('matatak_aventure'))"
    # Sans animation, les Personnages ne se promènent pas : ils restent sous la souris du test
    await page.emulate_media(reduced_motion="reduce")

    async def glisser(de, vers):
        # Faire défiler jusqu'à ce que le Personnage soit vraiment sous le doigt : en haut, l'en-tête, les
        # onglets et le plateau de l'équipe restent collés ; en bas, les onglets sur téléphone
        await page.locator(de).evaluate("""e => {
            e.scrollIntoView({block: 'end', behavior: 'instant'});
            for (let i = 0; i < 30; i++) {
                const b = e.getBoundingClientRect();
                if (e.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2))) return;
                window.scrollBy({top: 40, behavior: 'instant'}); // le contenu remonte au-dessus des onglets du bas
            }
        }""")
        a, b = await page.locator(de).bounding_box(), await page.locator(vers).bounding_box()
        await page.mouse.move(a["x"] + a["width"] / 2, a["y"] + a["height"] / 2)
        await page.mouse.down()
        await page.mouse.move(a["x"] + a["width"] / 2 + 20, a["y"] + a["height"] / 2 + 20, steps=4)
        await page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2, steps=8)
        await page.mouse.up()

    # Glisser BANJO de l'enclos sur la 1re case de Pion : TAMTAM retourne dans l'enclos
    await glisser('.av-enclos [data-nom="BANJO"]', '.av-formation [data-rang="pion"][data-index="0"]')
    assert await page.evaluate(lire + ".equipe.pions") == ["BANJO", "SHASHA", "BONGO"]
    await page.wait_for_selector('.av-enclos [data-nom="TAMTAM"]')
    # Un Pion ne va pas sur une case de Champion
    await glisser('.av-enclos [data-nom="TAMTAM"]', '.av-formation [data-rang="champion"][data-index="0"]')
    assert await page.evaluate(lire + ".equipe.champions") == ["KRAK"]
    # Toucher puis toucher : deux Pions de l'équipe s'échangent
    await page.locator('.av-formation [data-rang="pion"][data-index="1"]').click()
    await page.locator('.av-formation [data-rang="pion"][data-index="0"]').click()
    assert await page.evaluate(lire + ".equipe.pions") == ["SHASHA", "BANJO", "BONGO"]
    await capture(page, f"aventure-rois-debloques-{'tel' if telephone else 'pc'}")
    # Changer de Roi : KARMA glissé sur la case du Roi
    await glisser('.av-enclos [data-nom="KARMA"]', '.av-formation [data-rang="roi"]')
    assert await page.evaluate(lire + ".roi") == "KARMA"
    await page.wait_for_selector('.av-enclos [data-nom="AZAR"]')
    assert await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    assert not page.erreurs, page.erreurs


@pytest.mark.parametrize("telephone", [False, True], ids=["ordinateur", "telephone"])
async def test_collection_montre_les_personnages_debloques(site, chromium, telephone):
    page = await ouvrir(chromium, site, telephone)
    await page.evaluate(PHASE_2)
    await page.goto(site + "/collection")
    await page.wait_for_selector(".carte-col")
    assert await page.locator(".carte-col.verrou").count() > 20
    await page.locator("button.puce", has_text="Débloqués").click()
    # 8 recrues + les 4 Rois (phase 1 finie)
    assert await page.locator(".carte-col").count() == 12
    assert await page.locator(".carte-col.verrou").count() == 0
    await page.locator("button.puce", has_text="Tous").click()
    await capture(page, f"aventure-collection-{'tel' if telephone else 'pc'}")
    assert not page.erreurs, page.erreurs


@pytest.mark.parametrize("telephone", [False, True], ids=["ordinateur", "telephone"])
async def test_classee_verrouillee_pendant_la_phase_1(site, chromium, telephone):
    page = await ouvrir(chromium, site, telephone)
    await page.evaluate(
        """localStorage.setItem('jouer_choix', JSON.stringify({adv: 'classee', variant: 'matatakmini'}));
        localStorage.setItem('matatak_aventure', JSON.stringify({
            version: 1, roi: 'AZAR', recrues: ['KRAK', 'TAMTAM'], equipe: {champions: ['KRAK'], pions: ['TAMTAM', 'TAMTAM']},
            etape: 2, victoires: 0, niveauOrdi: 4, parties: 3, flamme: {jours: 1, dernier: ''}, plateau: 'matatakmini'}))"""
    )
    await page.goto(site + "/jouer")
    await page.wait_for_selector(".classee-accueil.verrou")
    await capture(page, f"aventure-classee-verrou-{'tel' if telephone else 'pc'}")
    await page.locator("button.deja", has_text="Jouer quand même").click()
    await page.wait_for_selector(".classee-accueil:not(.verrou)")
    await page.reload()
    await page.wait_for_selector(".classee-accueil:not(.verrou)")
    assert not page.erreurs, page.erreurs


async def test_revanche_avec_un_coup_de_pouce_pour_le_perdant(site, chromium):
    from test_parcours import inviter_un_ami

    hote, ami = await inviter_un_ami(chromium, site)
    gid = id_partie(hote)
    await ecouter_partie(hote, gid)
    assert await attendre(hote, "() => window.__msgs.some(m => m.type === 'board')")
    await envoyer(hote, {"type": "resign", "gameId": gid})
    for page in (hote, ami):
        await page.wait_for_selector(".fin-partie")
    # Le perdant (l'hôte) demande la revanche avec un Coup de pouce pour lui
    lien = hote.locator(".fin-lien", has_text="Revanche avec un Coup de pouce pour vous")
    await lien.click()
    await hote.wait_for_selector(".fin-message:has-text('avec un Coup de pouce proposée')")
    # L'ami voit la proposition, avec le Coup de pouce pour l'hôte, et l'accepte
    await ami.wait_for_selector(".fin-message:has-text('demande un Coup de pouce pour la revanche')")
    await capture(ami, "revanche-coup-de-pouce-tel")
    await ami.locator(".fin-partie button.mt-btn", has_text="Accepter").click()
    await ami.wait_for_url(lambda url: gid not in url, timeout=15000)
    for page in (hote, ami):
        assert not page.erreurs, page.erreurs


async def test_entre_amis_chacun_choisit_son_equipe(site, chromium):
    hote = await ouvrir(chromium, site)
    await hote.evaluate("localStorage.setItem('jouer_choix', JSON.stringify({adv: 'ami', variant: 'matatak'}))")
    await hote.goto(site + "/jouer")
    await hote.locator(".equipe-ami button.choix-eq", has_text="KARMA").click()
    await capture(hote, "ami-equipe-pc")
    await hote.locator("button.lancer").dispatch_event("click")
    await hote.wait_for_url("**/invite/**", timeout=15000)
    ami = await ouvrir(chromium, site, telephone=True)
    await ami.goto(hote.url)
    await ami.wait_for_selector(".invite-equipe")
    assert "joue l'équipe de KARMA" in await ami.locator(".invite-equipe").inner_text()
    await ami.locator("label.choix-eq", has_text="MOJO").click()
    await capture(ami, "ami-invitation-tel")
    await ami.click("text=Rejoindre la partie")
    for page in (hote, ami):
        await page.wait_for_selector("cg-board", timeout=15000)
    gid = id_partie(hote)
    await ecouter_partie(hote, gid)
    assert await attendre(hote, "() => window.__msgs.some(m => m.type === 'board')")
    placement = (await dernier_plateau(hote))["fen"].split()[0]
    # Hiver (FRANK w, BONGO l) et Printemps (DYSKO c, BANJO m), 4 Personnages chacun sur le 8×8
    assert set(placement.lower()) - set("/12345678") == set("kwlcm"), placement
    for page in (hote, ami):
        assert not page.erreurs, page.erreurs


@pytest.mark.parametrize("telephone", [False, True], ids=["ordinateur", "telephone"])
async def test_le_tutoriel_est_le_niveau_0(site, chromium, telephone):
    page = await ouvrir(chromium, site, telephone)
    await page.evaluate(
        """localStorage.removeItem('matatak_tutoriel');
        localStorage.setItem('jouer_choix', JSON.stringify({adv: 'ia', variant: 'matatakmini'}))"""
    )
    await page.goto(site + "/jouer")
    await page.locator(".av-roi", has_text="AZAR").click()
    # Le Roi choisi, le tutoriel commence tout de suite, guidé par ce Roi
    await page.wait_for_url(lambda url: url.endswith("/tutorial/1"), timeout=15000)
    await page.wait_for_selector(".tuto-bulle")
    assert "AZAR" in await page.locator(".tuto-discussion img").get_attribute("alt")
    # De retour sur Solo : niveau 0 en cours, le bouton mène au tutoriel, le niveau 1 attend
    await page.goto(site + "/jouer")
    await page.wait_for_selector(".av-route")
    assert await page.locator(".av-niveau.courant").inner_text() == "0"
    lancer = page.locator(".lancer")
    assert (await lancer.inner_text()).lower() == "apprendre à jouer"
    assert await lancer.get_attribute("href") == "/tutorial/1"
    if telephone:
        # Onglets Aventure · Défier un ami · Arène en bas, au-dessus de la navigation
        onglets = await page.locator(".choix-adv-bas").bounding_box()
        assert onglets and onglets["y"] > page.viewport_size["height"] / 2
    assert await page.locator(".choix-adv button:visible").count() == 3
    await capture(page, f"aventure-niveau0-{'tel' if telephone else 'pc'}")

    await page.locator(".av-passer").click()
    await page.wait_for_selector(".av-niveau.fait")
    assert await page.locator(".av-niveau.courant").inner_text() == "1"
    assert (await page.locator("button.lancer").inner_text()).lower() == "niveau 1"
    # Niveau 0 fait : 1er toucher = sélection (« Apprendre à jouer »), 2e toucher = le tutoriel depuis le début
    case0 = page.locator(".av-niveau.fait", has_text="0")
    await case0.click()
    assert (await page.locator("button.lancer").inner_text()).lower() == "apprendre à jouer"
    await case0.click()
    await page.wait_for_url(lambda url: url.endswith("/tutorial/1"), timeout=15000)
    await page.goto(site + "/jouer")
    await page.wait_for_selector(".av-route")
    assert await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    assert not page.erreurs, page.erreurs


@pytest.mark.parametrize("ecran", ["ordinateur", "telephone", "paysage"])
async def test_revenir_sur_solo_montre_le_niveau_en_cours(site, chromium, ecran):
    page = await ouvrir(chromium, site, ecran == "telephone")
    if ecran == "paysage":
        await page.set_viewport_size({"width": 844, "height": 390})
    await page.evaluate(
        """localStorage.setItem('jouer_choix', JSON.stringify({adv: 'ami', variant: 'matatakmini'}));
        localStorage.setItem('matatak_aventure', JSON.stringify({
            version: 1, roi: 'AZAR', recrues: ['KRAK', 'TAMTAM', 'SHASHA', 'ROKK', 'BONGO', 'FRANK', 'BANJO', 'DYSKO', 'GONG'],
            equipe: {champions: ['KRAK'], pions: ['TAMTAM', 'TAMTAM', 'GONG']},
            etape: 7, victoires: 0, niveauOrdi: 12, parties: 14, flamme: {jours: 0, dernier: ''}, plateau: 'matatakmini'}))"""
    )
    await page.goto(site + "/jouer")
    await page.locator(".choix-adv button:visible", has_text="Aventure").click()
    await page.wait_for_selector(".av-niveau.courant")
    await page.wait_for_timeout(400)
    # Le niveau en cours (13 : une case par partie ; phase 1 = 8 parties, puis 2 par niveau) est à l'écran, pas le haut de la route
    case = await page.locator(".av-niveau.courant").bounding_box()
    hauteur = page.viewport_size["height"]
    assert case and 0 < case["y"] < hauteur, case
    assert await page.locator(".av-niveau.courant").inner_text() == "13"
    # Les onglets restent visibles en faisant défiler toute la route
    await page.evaluate("window.scrollTo(0, 0)")
    await page.wait_for_timeout(200)
    onglets = page.locator(".choix-adv:visible")
    boite = await onglets.bounding_box()
    assert boite and 0 <= boite["y"] < hauteur, boite
    await capture(page, f"aventure-onglets-{ecran}")
    # Sur téléphone, innerWidth grandit avec la page : on compare à la largeur de l'appareil
    assert await page.evaluate("document.documentElement.scrollWidth") <= page.viewport_size["width"]
    assert not page.erreurs, page.erreurs


async def toucher_case(page, case):
    """Touche une case du plateau Mini vu par les Blancs (colonnes a à d, rangées 1 à 8)."""
    b = await page.locator(".cg-wrap cg-board").bounding_box()
    x = b["x"] + ("abcd".index(case[0]) + 0.5) * b["width"] / 4
    y = b["y"] + (8 - int(case[1]) + 0.5) * b["height"] / 8
    await page.mouse.click(x, y)
    await page.wait_for_timeout(120)


async def test_le_tutoriel_se_joue_jusqu_a_la_colline(site, chromium):
    """Tutoriel (maquette du 27/10/2026) : 13 étapes jouées en touchant les cases, la partie avance toute
    seule entre les étapes, un mauvais coup est refusé avec son message, le Roi choisi guide."""
    page = await ouvrir(chromium, site, True)
    await page.evaluate(
        """localStorage.removeItem('matatak_tutoriel');
        localStorage.setItem('matatak_aventure', JSON.stringify({version: 1, roi: 'KARMA', recrues: ['DYSKO', 'TAMTAM', 'SHASHA'],
            equipe: {champions: ['DYSKO'], pions: ['TAMTAM', 'SHASHA']}, etape: 0, victoires: 0, niveauOrdi: 5, parties: 0,
            flamme: {jours: 0, dernier: ''}, plateau: 'matatakmini'}))"""
    )
    await page.goto(site + "/tutorial/1")
    coups = ["b2b4", "c2c3", "b1d3", "c1c2", "b4b6", "d3c4", "c4c5", "c5d6", "d6c7", "c7b7", "d3c3", "c2c3", "c3b4"]
    for n, coup in enumerate(coups, 1):
        # Les étapes s'enchaînent toutes seules ; à toi quand la consigne n'est plus grisée
        await page.wait_for_function("n => document.querySelector('.tuto-num')?.textContent === n + ' / 13'", arg=n, timeout=15000)
        await page.wait_for_selector(".tuto-consigne:not(.attente)", timeout=15000)
        assert await page.locator(".tuto-discussion img").get_attribute("alt") == "KARMA"
        if n == 6:  # s'interposer : refusé ici, avec la raison
            await toucher_case(page, "d3")
            await toucher_case(page, "c3")
            assert "KRAK capturerait DYSKO" in await page.locator(".tuto-erreur").inner_text()
        await toucher_case(page, coup[:2])
        await toucher_case(page, coup[2:])
        if n < len(coups):  # le bravo s'ajoute au fil, qu'on peut relire
            await page.wait_for_function("n => document.querySelectorAll('.tuto-fil .tuto-bravo').length >= n", arg=n, timeout=8000)
    await page.wait_for_selector(".tuto-suite .mt-btn", timeout=8000)
    assert "Mananas" in await page.locator(".tuto-victoire").inner_text()
    assert await page.evaluate("localStorage.getItem('matatak_tutoriel')") == "fini"
    # « Niveau 1 » lance tout de suite la 1re partie de l'Aventure
    await page.locator(".tuto-suite .mt-btn").click()
    await page.wait_for_url(lambda url: "/tutorial" not in url and "/jouer" not in url, timeout=15000)
    assert await page.evaluate("localStorage.getItem('matatak_tutoriel')") == "fini"
    assert not page.erreurs, page.erreurs


async def test_l_intro_avant_le_choix_du_roi(site, chromium):
    """Première visite de Solo : l'intro (« Touche pour commencer »), puis le choix du Roi ; vue une fois."""
    page = await ouvrir(chromium, site, True)
    await page.evaluate(
        """localStorage.removeItem('matatak_intro_vue');
        localStorage.setItem('jouer_choix', JSON.stringify({adv: 'ia', variant: 'matatakmini'}))"""
    )
    await page.goto(site + "/jouer")
    await page.locator(".av-intro-depart").click()
    await page.wait_for_selector(".av-intro.cri", timeout=20000)  # « MATATAK ! » après le texte
    assert await page.locator(".av-intro-rois img.vu").count() == 4  # chaque Roi apparu à son nom
    # Tout tient dans l'écran : le bouton du bas est visible sans défiler
    boite = await page.locator(".av-intro-continuer").bounding_box()
    assert boite and boite["y"] + boite["height"] <= page.viewport_size["height"], boite
    await page.locator(".av-intro-continuer").click()
    await page.wait_for_selector(".av-rois")
    assert await page.locator(".av-roi small").all_inner_texts() == ["Roi de l'Été", "Roi de l'Automne", "Roi de l'Hiver", "Roi du Printemps"]
    await page.reload()
    await page.wait_for_selector(".av-rois")
    assert await page.locator(".av-intro").count() == 0
    assert not page.erreurs, page.erreurs
