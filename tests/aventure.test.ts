import { beforeEach, expect, test } from '@jest/globals';

import { PHASE_1, PHASES } from '../client/aventure/niveaux';
import { PERSONNAGES, Roi, ROIS_DANS_L_ORDRE } from '../client/aventure/personnages';
import { ajusterEquipe, apresPartie, classeeDebloquee, draftDebloque, changerRoi, commencer, enregistrer, erreurEquipe, lire, prochainePartie, roisDebloques } from '../client/aventure/progression';
import { composition, personnagesVus, positionDeDepart, route } from '../client/aventure/route';

beforeEach(() => localStorage.clear());

test('chaque équipe respecte les places, contient la recrue et ne montre que des Personnages vus', () => {
    for (const roi of ROIS_DANS_L_ORDRE) {
        route(roi).forEach((etape, i) => {
            const n = composition(etape.places);
            const vus = personnagesVus(roi, i);
            vus.add(etape.recrue);
            // Phase 1 : chaque rival joue son équipe de départ complète, ses recrues suivantes comprises
            if (etape.phase === 1) route(roi).filter(e => e.phase === 1 && e.rival === etape.rival).forEach(e => vus.add(e.recrue));
            etape.equipes.forEach((equipe, k) => {
                const ou = `${roi}, étape ${i + 1} (${etape.recrue}), partie ${k + 1}`;
                expect([ou, equipe.champions.length, equipe.pions.length]).toEqual([ou, n.champions, n.pions]);
                expect([ou, [...equipe.champions, ...equipe.pions].includes(etape.recrue)]).toEqual([ou, true]);
                for (const nom of [...equipe.champions, ...equipe.pions]) expect([ou, nom, vus.has(nom)]).toEqual([ou, nom, true]);
                equipe.champions.forEach(nom => expect([ou, nom, PERSONNAGES[nom].rang]).toEqual([ou, nom, 'champion']));
                equipe.pions.forEach(nom => expect([ou, nom, PERSONNAGES[nom].rang]).toEqual([ou, nom, 'pion']));
            });
        });
    }
});

// Phase 1 exceptée : on y apprend à jouer, la même équipe peut revenir (Hugo, 23/10/2026)
test('on ne joue jamais deux fois la même équipe (après la phase 1)', () => {
    const cle = (e: { champions: string[], pions: string[] }) => [...e.champions].sort().join() + ';' + [...e.pions].sort().join();
    const vues = new Map<string, string>();
    const toutes = [
        ...PHASES.flatMap((ph, i) => ph.niveaux.flatMap(n => n.parties.map((e, k) => [`phase ${i + 2} ${n.recrue} partie ${k + 1}`, e] as const))),
    ];
    for (const [ou, e] of toutes) {
        expect([ou, vues.get(cle(e)) ?? null]).toEqual([ou, null]);
        vues.set(cle(e), ou);
    }
});

// 20 recrues : l'équipe de départ (DYSKO, TAMTAM, SHASHA) est offerte à tous (Hugo, 27/10/2026)
test('20 recrues, chacune une seule fois, jamais une de l\'équipe de départ', () => {
    for (const roi of ROIS_DANS_L_ORDRE) {
        const recrues = route(roi).map(e => e.recrue);
        expect(recrues.length).toBe(PHASE_1.niveaux.length + PHASES.reduce((t, p) => t + p.niveaux.length, 0));
        expect(recrues.length).toBe(20);
        expect(recrues.filter(r => ['DYSKO', 'TAMTAM', 'SHASHA'].includes(r))).toEqual([]);
        expect(new Set(recrues).size).toBe(recrues.length);
    }
});

test('positions de départ : celles du site avec les équipes de départ, puis 5 et 6 places', () => {
    const ete = { champions: ['KRAK' as const], pions: ['TAMTAM' as const, 'TAMTAM' as const] };
    expect(positionDeDepart('matatak', ete, ete)).toBe('3kx3/3ff3/8/8/8/8/3FF3/3XK3 w - - 0 1');
    expect(positionDeDepart('matatakmini', ete, ete)).toBe('1kx1/1ff1/4/4/4/4/1FF1/1XK1 w - - 0 1');
    const cinq = { champions: ['ROKK' as const], pions: ['SHASHA' as const, 'SHASHA' as const, 'GONG' as const] };
    expect(positionDeDepart('matatak', cinq, cinq)).toBe('3ki3/2ebb3/8/8/8/8/3BBE2/3IK3 w - - 0 1');
    const six = { champions: ['ROKK' as const, 'JAZZ' as const], pions: cinq.pions };
    expect(positionDeDepart('matatakmini', six, six)).toBe('nki1/ebb1/4/4/4/4/1BBE/1IKN w - - 0 1');
});

test('phase 1 : 2 victoires contre le Printemps, l\'Automne, l\'Été, une par recrue contre l\'Hiver', () => {
    let p = commencer('AZAR', 'matatak');
    expect(p.equipe).toEqual({ champions: ['DYSKO'], pions: ['TAMTAM', 'SHASHA'] });
    expect(prochainePartie(p)!.couleur).toBe('w');
    const recrues: (string | null)[] = [];
    while (route('AZAR')[p.etape].phase === 1) {
        const bilan = apresPartie(p, 'victoire');
        recrues.push(bilan.recrue);
        p = bilan.progression;
    }
    expect(recrues).toEqual([null, 'BANJO', null, 'ROKK', null, 'KRAK', 'BONGO', 'FRANK']);
    expect(p.equipe.pions.length).toBe(3); // phase 2 : 5 places, un Pion de plus
    expect(erreurEquipe(p, p.equipe)).toBeNull();
    let bilan = apresPartie(p, 'victoire');
    expect(bilan.recrue).toBeNull();
    p = bilan.progression;
    expect(prochainePartie(p)!.couleur).toBe('b'); // 2e partie : le rival commence
    bilan = apresPartie(apresPartie(p, 'defaite').progression, 'victoire');
    expect(bilan.recrue).toBe(route('AZAR')[PHASE_1.niveaux.length].recrue); // 1re recrue de la phase 2
});

test('niveau caché : monte vite au début, puis +1 par victoire et −2 par défaite', () => {
    let p = commencer('MOJO', 'matatakmini');
    p = apresPartie(p, 'victoire').progression;
    expect(p.niveauOrdi).toBe(4); // départ au niveau 1, +3 pendant le placement
    p = { ...p, parties: 10 };
    p = apresPartie(p, 'victoire').progression;
    expect(p.niveauOrdi).toBe(5);
    p = apresPartie(p, 'defaite').progression;
    expect(p.niveauOrdi).toBe(3);
});

test('flamme : jours joués d\'affilée', () => {
    let p = commencer('SHANS', 'matatak');
    p = apresPartie(p, 'defaite', new Date(2026, 9, 23, 20)).progression;
    p = apresPartie(p, 'defaite', new Date(2026, 9, 23, 22)).progression;
    expect(p.flamme.jours).toBe(1);
    p = apresPartie(p, 'defaite', new Date(2026, 9, 24, 9)).progression;
    expect(p.flamme.jours).toBe(2);
    p = apresPartie(p, 'defaite', new Date(2026, 9, 26, 9)).progression;
    expect(p.flamme.jours).toBe(1);
});

test('la progression est relue telle quelle', () => {
    const p = commencer('KARMA' as Roi, 'matatak');
    enregistrer(p);
    expect(lire()).toEqual(p);
});

test('changer de Roi seulement après la phase 1', () => {
    let p = commencer('AZAR', 'matatak');
    expect(roisDebloques(p)).toBe(false);
    expect(changerRoi(p, 'MOJO').roi).toBe('AZAR');
    while (route('AZAR')[p.etape].phase === 1) p = apresPartie(p, 'victoire').progression;
    expect(roisDebloques(p)).toBe(true);
    const q = changerRoi(p, 'MOJO');
    expect(q.roi).toBe('MOJO');
    expect(route('MOJO')[q.etape].recrue).toBe(route('AZAR')[p.etape].recrue); // même étape
});

test('un seul exemplaire de chaque Personnage, sauf s\'il manque des recrues', () => {
    const p = commencer('AZAR', 'matatak');
    expect(p.equipe.pions).toEqual(['TAMTAM', 'SHASHA']);
    expect(erreurEquipe(p, p.equipe)).toBeNull();
    expect(erreurEquipe(p, { champions: ['DYSKO'], pions: ['SHASHA', 'SHASHA'] })).toBe('Un seul exemplaire de chaque Personnage.');
    expect(ajusterEquipe({ champions: ['KRAK'], pions: ['TAMTAM'] }, 6, ['KRAK', 'ROKK', 'TAMTAM', 'SHASHA', 'BONGO']))
        .toEqual({ champions: ['KRAK', 'ROKK'], pions: ['TAMTAM', 'BONGO', 'SHASHA'] });
});

test('le Classé se débloque à la fin de la phase 1, le Draft à la fin de la phase 3', () => {
    let p = commencer('SHANS', 'matatak');
    const debloques: string[] = [];
    while (prochainePartie(p)) {
        const bilan = apresPartie(p, 'victoire');
        if (bilan.debloque) debloques.push(`${bilan.debloque} après l'étape ${p.etape + 1}`);
        p = bilan.progression;
    }
    const phase1 = route('SHANS').filter(e => e.phase === 1).length;
    const avantPhase4 = route('SHANS').filter(e => e.phase <= 3).length;
    expect(debloques).toEqual([`classee après l'étape ${phase1}`, `draft après l'étape ${avantPhase4}`]);
    expect(classeeDebloquee(p) && draftDebloque(p)).toBe(true);
});
