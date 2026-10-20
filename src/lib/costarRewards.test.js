import { describe, it, expect } from 'vitest';
import { applyReview, emptyState, normalizeState, toggleEquip, unlockedIds, MISSIONS, COSMETICS, SLOTS } from './costarRewards.js';

const day = new Date(2026, 10, 20, 15, 0); // vendredi de novembre, hors midi (pas de mission saisonnière)
const night = new Date(2026, 10, 20, 22, 30);

describe('Vestiaire de Costar — missions et cosmétiques', () => {
  it('catalogue cohérent : chaque mission débloque un cosmétique existant, un seul par mission', () => {
    const rewards = MISSIONS.map(m => m.reward);
    expect(new Set(rewards).size).toBe(rewards.length);
    rewards.forEach(r => expect(COSMETICS[r]).toBeTruthy());
    Object.values(COSMETICS).forEach(c => expect(SLOTS).toContain(c.slot));
  });

  it('première relecture → lunettes de soleil, portées tout de suite', () => {
    const { state, completed } = applyReview(emptyState(), { note: 6, observations: 3, projectId: 'p1' }, day);
    expect(completed.map(m => m.id)).toEqual(['premiere']);
    expect(state.equipped.eyes).toBe('lunettes');
    expect(state.unseen).toEqual(['lunettes']);
  });

  it('rapport vide ou note invalide : rien ne bouge', () => {
    expect(applyReview(emptyState(), { note: 0, observations: 0 }, day).completed).toEqual([]);
    expect(applyReview(emptyState(), { note: NaN, observations: 4 }, day).state.stats.reviews).toBe(0);
  });

  it('7/10 → nœud papillon ; 4/10 → pansement ; après 20 h → lampe frontale', () => {
    let st = applyReview(emptyState(), { note: 7, observations: 2, projectId: 'a' }, day).state;
    expect(unlockedIds(st.stats)).toEqual(expect.arrayContaining(['lunettes', 'noeud']));
    const r = applyReview(st, { note: 4, observations: 2, projectId: 'b' }, night);
    expect(r.completed.map(m => m.reward)).toEqual(expect.arrayContaining(['pansement', 'lampe']));
  });

  it('remontada : +2 points sur le MÊME rapport, pas sur deux rapports différents', () => {
    let st = applyReview(emptyState(), { note: 5, observations: 2, projectId: 'a' }, day).state;
    st = applyReview(st, { note: 8, observations: 2, projectId: 'b' }, day).state;
    expect(st.stats.remontada).toBe(false);
    const r = applyReview(st, { note: 7, observations: 2, projectId: 'a' }, day);
    expect(r.completed.map(m => m.id)).toContain('remontada');
  });

  it('tournée : 5 AFFAIRES différentes (plusieurs visites d\'une même affaire = une seule)', () => {
    let st = emptyState();
    for (let i = 0; i < 5; i++) st = applyReview(st, { note: 6, observations: 2, projectId: 'a', reportId: 'a|v' + i }, day).state;
    expect(unlockedIds(st.stats)).not.toContain('echarpe');
    for (const id of ['b', 'c', 'd', 'e']) st = applyReview(st, { note: 6, observations: 2, projectId: id }, day).state;
    expect(unlockedIds(st.stats)).toContain('echarpe');
  });

  it('shérif : 3 relectures le même jour → chapeau de cowboy (pas sur 3 jours différents)', () => {
    let st = emptyState();
    for (let d = 1; d <= 3; d++) st = applyReview(st, { note: 6, observations: 2 }, new Date(2026, 9, d, 10)).state;
    expect(unlockedIds(st.stats)).not.toContain('cowboy');
    st = applyReview(st, { note: 6, observations: 2 }, new Date(2026, 9, 3, 15)).state;
    const r = applyReview(st, { note: 6, observations: 2 }, new Date(2026, 9, 3, 17));
    expect(r.completed.map(m => m.reward)).toContain('cowboy');
  });

  it('inventaire par catégorie : chapeau de cowboy + gilet jaune + lunettes ensemble, un seul chapeau', () => {
    let st = emptyState();
    st = applyReview(st, { note: 5, observations: 2, projectId: 'a' }, new Date(2026, 9, 5, 9)).state;  // lunettes
    st = applyReview(st, { note: 10, observations: 2, projectId: 'a' }, new Date(2026, 9, 5, 10)).state; // remontada (gilet) + casque or
    st = applyReview(st, { note: 6, observations: 2, projectId: 'b' }, new Date(2026, 9, 5, 11)).state;  // cowboy
    expect(st.equipped).toMatchObject({ head: 'cowboy', body: 'gilet', eyes: 'lunettes' }); // porté dès le déblocage
    st = toggleEquip(st, 'casque_or'); // autre chapeau → remplace le cowboy, le reste ne bouge pas
    expect(st.equipped).toMatchObject({ head: 'casque_or', body: 'gilet', eyes: 'lunettes' });
  });

  it('nouvelle fournée : clope (midi), pull (week-end), citrouille (octobre), Noël (décembre), santiags (5 jours)', () => {
    const got = (dates) => { let st = emptyState(); dates.forEach(d => { st = applyReview(st, { note: 6, observations: 2 }, d).state; }); return unlockedIds(st.stats); };
    expect(got([new Date(2026, 9, 20, 12, 30)])).toEqual(expect.arrayContaining(['clope', 'citrouille']));
    expect(got([new Date(2026, 10, 3, 15)])).not.toEqual(expect.arrayContaining(['clope']));
    expect(got([new Date(2026, 10, 8, 10)])).toContain('pull');          // dimanche
    expect(got([new Date(2026, 10, 9, 10)])).not.toContain('pull');      // lundi
    expect(got([new Date(2026, 11, 15, 10)])).toContain('noel');
    expect(got([1, 2, 3, 4].map(d => new Date(2026, 10, d + 1, 10)))).not.toContain('santiags');
    expect(got([1, 2, 3, 4, 5].map(d => new Date(2026, 10, d + 1, 10)))).toContain('santiags');
    const pull = MISSIONS.find(m => m.reward === 'pull');
    expect(pull.desc).toMatch(/rétréci au lavage par la femme de ménage/);
  });

  it('missions à compteur : 3 × 10/10 → couronne, une seule fois', () => {
    let st = emptyState();
    const got = [];
    for (let i = 0; i < 4; i++) {
      const r = applyReview(st, { note: 10, observations: 25, projectId: 'p' + i }, day);
      st = r.state; got.push(...r.completed.map(m => m.reward));
    }
    expect(got.filter(x => x === 'couronne')).toHaveLength(1);
    expect(got).toEqual(expect.arrayContaining(['casque_or', 'cafe', 'monocle']));
    expect(st.equipped.head).toBe('couronne'); // dernier débloqué de l'emplacement
  });

  it('porter / enlever : uniquement un cosmétique débloqué, un par emplacement', () => {
    let st = applyReview(emptyState(), { note: 6, observations: 3 }, day).state;
    expect(toggleEquip(st, 'couronne').equipped.head).toBeUndefined(); // verrouillé
    st = toggleEquip(st, 'lunettes');
    expect(st.equipped.eyes).toBeUndefined();
    st = toggleEquip(st, 'lunettes');
    expect(st.equipped.eyes).toBe('lunettes');
  });

  it('état corrompu → progression vierge, sans plantage', () => {
    expect(normalizeState('n\'importe quoi')).toEqual(emptyState());
    expect(normalizeState({ equipped: { front: 'lampe', extra: 'pansement' } }).equipped).toEqual({ extra: 'lampe', face: 'pansement' }); // anciennes catégories
    const st = normalizeState({ stats: { reviews: 'x' }, equipped: { eyes: 'zzz', head: 'tuque' }, unseen: ['zzz'] });
    expect(st.stats.reviews).toBe(0);
    expect(st.equipped).toEqual({ head: 'tuque' });
    expect(st.unseen).toEqual([]);
  });
});
