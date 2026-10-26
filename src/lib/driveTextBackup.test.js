import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const uploads = [];
vi.mock('./driveUpload.js', () => ({
  uploadToDrive: async (item) => { uploads.push(item); },
  getAffaireNum: () => '504',
}));

const projet = (commentaire, conclusion = '') => [{
  id: 'P', nom: 'Pavillons-sous-Bois',
  visites: [{ id: 'V5', label: 'Visite DET n°5', dateVisite: '2026-10-22', ingenieur: 'TCM', conclusion,
    localisations: [{ id: 'z', nom: 'RDC', items: [{ id: 'a', titre: 'Coffrage voiles', commentaire, urgence: 'haute', suivi: 'a_faire' }] }] }],
}];

let mod;
beforeEach(async () => { uploads.length = 0; vi.useFakeTimers(); vi.resetModules(); mod = await import('./driveTextBackup.js'); });
afterEach(() => { vi.useRealTimers(); });

const decode = (dataUrl) => new TextDecoder().decode(Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0)));

describe('copie du texte de la visite sur le Drive', () => {
  it('htmlToText : paragraphes, retours, entités', () => {
    expect(mod.htmlToText('<p>Voile&nbsp;V3 : reprise</p><p>Armatures <b>HA12</b><br>OK</p>')).toBe('Voile V3 : reprise\nArmatures HA12\nOK');
  });

  it('corps lisible : projet, visite, zones, observations, conclusion', () => {
    const [p] = projet('<p>Ferraillage à reprendre</p>', 'Conforme sous réserve');
    const body = mod.visitTextBody(p, p.visites[0]);
    expect(body).toContain('Pavillons-sous-Bois');
    expect(body).toContain('Visite DET n°5 — 22/10/2026');
    expect(body).toContain('■ RDC');
    expect(body).toContain('1. Coffrage voiles  [Urgent, À faire]');
    expect(body).toContain('     Ferraillage à reprendre');
    expect(body).toContain('CONCLUSION\nConforme sous réserve');
  });

  it('rien au chargement ; une modification → UNE écriture (fichier remplacé, accents conservés)', async () => {
    let state = projet('Texte DET 4');
    mod.primeVisitTextBackup(state);
    mod.scheduleVisitTextBackup(() => state, ['P']);
    await vi.runAllTimersAsync();
    expect(uploads).toHaveLength(0); // inchangé depuis le chargement

    state = projet('Nouveau texte DET 5 — façade');
    mod.scheduleVisitTextBackup(() => state, ['P']);
    mod.scheduleVisitTextBackup(() => state, ['P']); // regroupé
    await vi.runAllTimersAsync();
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({ name: mod.TEXT_FILE_NAME, replace: true, projetNum: '504', visiteLabel: 'Visite DET n°5', visiteDate: '2026-10-22', ingenieur: 'TCM' });
    expect(decode(uploads[0].data)).toContain('Nouveau texte DET 5 — façade');

    // Nouvelle modif juste après → attend la fin des 2 min, puis écrit la dernière version.
    state = projet('Nouveau texte DET 5 — façade nord');
    mod.scheduleVisitTextBackup(() => state, ['P']);
    await vi.advanceTimersByTimeAsync(60000);
    expect(uploads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(61000);
    expect(uploads).toHaveLength(2);
    expect(decode(uploads[1].data)).toContain('façade nord');
  });
});
