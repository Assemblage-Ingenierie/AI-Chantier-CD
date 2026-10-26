import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLiveSession, stripSrc, restoreSrc, srcMapOf, mapOffset } from './liveText.js';

// Bus « Realtime » en mémoire : diffusion à tous les autres appareils (comme le canal Supabase).
function makeBus({ drop = () => false } = {}) {
  const peers = new Map();
  const queue = [];
  return {
    join(tab, initial) {
      const texts = { titre: initial.titre || '', commentaire: initial.commentaire || '' };
      const s = createLiveSession({
        initial,
        send: (m) => { queue.push({ ...m, tab }); return true; },
        onText: (f) => { Object.assign(texts, f); return null; },
      });
      peers.set(tab, s);
      return { s, texts, type(field, value) { const r = s.local({ [field]: value }); if (r.fix) Object.assign(texts, r.fix); texts[field] = r.fix?.[field] ?? value; } };
    },
    deliver() {
      let n = 0;
      while (queue.length && n++ < 10000) {
        const m = queue.shift();
        for (const [tab, s] of peers) {
          if (tab === m.tab) continue;
          if (m.to && m.to !== tab) continue;
          if (drop(m, tab)) continue;
          s.receive(m);
        }
      }
    },
    leave(tab) { peers.get(tab)?.destroy(); peers.delete(tab); },
  };
}

describe('co-édition en direct (liveText)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const step = (bus) => { vi.advanceTimersByTime(80); bus.deliver(); };

  it('je vois en direct ce que le collègue tape', () => {
    const bus = makeBus();
    const init = { titre: 'Fissure', commentaire: 'Mur nord.' };
    const A = bus.join('A', init), B = bus.join('B', init);
    A.s.hello(); B.s.hello(); bus.deliver();
    A.type('commentaire', 'Mur nord. Fissure de 2 mm.');
    step(bus);
    expect(B.texts.commentaire).toBe('Mur nord. Fissure de 2 mm.');
  });

  it('deux personnes tapent EN MÊME TEMPS dans la même case : aucun texte effacé (bug 26/10)', () => {
    const bus = makeBus();
    const init = { titre: '', commentaire: 'Constat : ' };
    const A = bus.join('A', init), B = bus.join('B', init);
    A.s.hello(); B.s.hello(); bus.deliver();
    // Frappes simultanées, avant que les messages ne se croisent.
    A.type('commentaire', 'Constat : fissure au plafond. ');
    B.type('commentaire', 'Constat : Stas : humidité en pied de mur.');
    step(bus);
    expect(A.texts.commentaire).toBe(B.texts.commentaire);
    expect(A.texts.commentaire).toContain('fissure au plafond.');
    expect(A.texts.commentaire).toContain('humidité en pied de mur.');
    // Thomas continue d'écrire après : le texte de Stas reste.
    A.type('commentaire', A.texts.commentaire + ' Suite Thomas.');
    step(bus);
    expect(B.texts.commentaire).toContain('humidité en pied de mur.');
    expect(B.texts.commentaire).toContain('Suite Thomas.');
    expect(A.texts.commentaire).toBe(B.texts.commentaire);
  });

  it('frappe lettre par lettre des deux côtés : convergence', () => {
    const bus = makeBus();
    const init = { titre: '', commentaire: '|' };
    const A = bus.join('A', init), B = bus.join('B', init);
    A.s.hello(); B.s.hello(); bus.deliver();
    const a = 'Thomas écrit ici. ', b = 'Stas écrit là. ';
    let caretB = 0; // Stas écrit AVANT le « | », Thomas après
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i < a.length) A.type('commentaire', A.texts.commentaire + a[i]);
      if (i < b.length) { const t = B.texts.commentaire; B.type('commentaire', t.slice(0, caretB) + b[i] + t.slice(caretB)); caretB++; }
      if (i % 3 === 0) step(bus);
    }
    step(bus);
    expect(A.texts.commentaire).toBe(B.texts.commentaire);
    expect(A.texts.commentaire).toBe('Stas écrit là. |Thomas écrit ici. ');
  });

  it('arrivé en cours de route : je récupère le texte déjà tapé par le collègue', () => {
    const bus = makeBus();
    const init = { titre: 'T', commentaire: 'Base.' };
    const A = bus.join('A', init);
    A.s.hello(); bus.deliver();
    A.type('commentaire', 'Base. Ajout de Thomas.');
    step(bus);
    const B = bus.join('B', init);
    B.s.hello(); bus.deliver();
    expect(B.texts.commentaire).toBe('Base. Ajout de Thomas.');
  });

  it('collègue ouvert sur une version plus ancienne : je rejoins sa session si je n\'ai rien tapé', () => {
    const bus = makeBus();
    const A = bus.join('A', { titre: 'T', commentaire: 'Ancien.' });
    A.s.hello(); bus.deliver();
    A.type('commentaire', 'Ancien. En cours.');
    step(bus);
    const B = bus.join('B', { titre: 'T', commentaire: 'Autre version.' });
    B.s.hello(); bus.deliver();
    expect(B.texts.commentaire).toBe('Ancien. En cours.');
    B.type('commentaire', 'Ancien. En cours. Et moi.');
    step(bus);
    expect(A.texts.commentaire).toBe('Ancien. En cours. Et moi.');
  });

  it('messages perdus : le contrôle périodique rattrape (insertions ET suppressions)', () => {
    let lose = true;
    const bus = makeBus({ drop: (m) => lose && m.k === 'u' });
    const init = { titre: '', commentaire: 'abc def' };
    const A = bus.join('A', init), B = bus.join('B', init);
    A.s.hello(); B.s.hello(); bus.deliver();
    A.type('commentaire', 'abc XYZ');   // suppression + insertion perdues
    step(bus);
    expect(B.texts.commentaire).toBe('abc def');
    lose = false;
    vi.advanceTimersByTime(3100); bus.deliver();
    vi.advanceTimersByTime(3100); bus.deliver();
    expect(B.texts.commentaire).toBe('abc XYZ');
  });

  it('pendant une dictée / correction IA, le texte reçu attend la fin (jamais perdu)', () => {
    const bus = makeBus();
    const init = { titre: '', commentaire: 'Début.' };
    const A = bus.join('A', init), B = bus.join('B', init);
    A.s.hello(); B.s.hello(); bus.deliver();
    B.s.hold(true);
    A.type('commentaire', 'Début. Thomas.');
    step(bus);
    expect(B.texts.commentaire).toBe('Début.');        // pas touché pendant la dictée
    B.type('commentaire', 'Début. Dicté par Stas.');
    step(bus);
    B.s.hold(false);
    step(bus);
    expect(B.texts.commentaire).toContain('Thomas.');
    expect(B.texts.commentaire).toContain('Dicté par Stas.');
    expect(A.texts.commentaire).toBe(B.texts.commentaire);
  });

  it('titre et commentaire indépendants', () => {
    const bus = makeBus();
    const init = { titre: 'Titre', commentaire: 'C' };
    const A = bus.join('A', init), B = bus.join('B', init);
    A.s.hello(); B.s.hello(); bus.deliver();
    A.type('titre', 'Titre modifié');
    B.type('commentaire', 'C + Stas');
    step(bus);
    expect(A.texts).toEqual({ titre: 'Titre modifié', commentaire: 'C + Stas' });
    expect(B.texts).toEqual({ titre: 'Titre modifié', commentaire: 'C + Stas' });
  });

  it('les liens d\'images (signés par appareil) ne sont pas partagés, chacun remet les siens', () => {
    const a = '<div>x</div><img src="https://a/sig1" data-cimg="p/1.jpg" data-w="60">';
    const b = '<div>x</div><img src="https://b/sig2" data-cimg="p/1.jpg" data-w="60">';
    expect(stripSrc(a)).toBe(stripSrc(b));
    const { html, missing } = restoreSrc(stripSrc(a), srcMapOf(b));
    expect(html).toBe(b);
    expect(missing).toEqual([]);
    expect(restoreSrc(stripSrc(a), {}).missing).toEqual(['p/1.jpg']);
  });

  it('le curseur suit le texte inséré avant lui', () => {
    expect(mapOffset('abc def', 'XX abc def', 4)).toBe(7);
    expect(mapOffset('abc def', 'abc def YY', 4)).toBe(4);
  });
});

describe('co-édition : écran qui refuse momentanément (composition Android, titre en saisie)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it('le texte reçu n\'est pas perdu quand je tape avant qu\'il soit affiché', () => {
    const q = [];
    const mk = (tab, refuse) => {
      const texts = { titre: '', commentaire: 'Base.' };
      const s = createLiveSession({
        initial: { titre: '', commentaire: 'Base.' },
        send: (m) => { q.push({ ...m, tab }); return true; },
        onText: (f) => { if (refuse.on) return { commentaire: true }; Object.assign(texts, f); return null; },
      });
      return { s, texts, refuse };
    };
    const A = mk('A', { on: false }), B = mk('B', { on: true });
    const deliver = () => { while (q.length) { const m = q.shift(); (m.tab === 'A' ? B : A).s.receive(m); } };
    A.s.hello(); B.s.hello(); deliver();
    const r0 = A.s.local({ commentaire: 'Base. Thomas.' }); expect(r0.changed).toEqual(['commentaire']);
    vi.advanceTimersByTime(80); deliver();
    expect(B.texts.commentaire).toBe('Base.');                 // refusé (mot en composition)
    B.refuse.on = false;                                        // fin du mot côté Stas
    B.s.local({ commentaire: 'Base. Stas' });
    expect(B.texts.commentaire).toContain('Thomas.');
    expect(B.texts.commentaire).toContain('Stas');
    vi.advanceTimersByTime(80); deliver();
    expect(A.texts.commentaire).toBe(B.texts.commentaire);
  });
});

describe('co-édition : saisie qui continue pendant que l\'écran refuse', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it('plusieurs frappes avant affichage : le texte du collègue reste dans le document partagé', () => {
    const q = [];
    const mk = (tab, refuse) => {
      const texts = { titre: '', commentaire: 'Base.' };
      const s = createLiveSession({
        initial: { titre: '', commentaire: 'Base.' },
        send: (m) => { q.push({ ...m, tab }); return true; },
        onText: (f) => { if (refuse.on) return { commentaire: true }; Object.assign(texts, f); return null; },
      });
      return { s, texts, refuse };
    };
    const A = mk('A', { on: false }), B = mk('B', { on: true });
    const deliver = () => { while (q.length) { const m = q.shift(); (m.tab === 'A' ? B : A).s.receive(m); } };
    A.s.hello(); B.s.hello(); deliver();
    A.s.local({ commentaire: 'Base. Thomas.' });
    vi.advanceTimersByTime(80); deliver();
    B.s.local({ commentaire: 'Base. S' });
    B.s.local({ commentaire: 'Base. St' });
    B.s.local({ commentaire: 'Base. Sta' });
    vi.advanceTimersByTime(80); deliver();
    expect(B.s.text().commentaire).toContain('Thomas.');
    expect(B.s.text().commentaire).toContain('Sta');
    expect(A.texts.commentaire).toBe(B.s.text().commentaire);
    B.refuse.on = false;
    vi.advanceTimersByTime(3100);                               // réaffichage (tick)
    expect(B.texts.commentaire).toBe(B.s.text().commentaire);
  });
});

describe('curseurs en direct (bandeau prénom + surlignage)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const mk = (tab, q, initial, marksOut) => {
    const texts = { ...initial };
    const s = createLiveSession({
      initial,
      send: (m) => { q.push({ ...m, tab, name: tab === 'A' ? 'Thomas Cassetari' : 'Stas V', userId: tab }); return true; },
      onText: (f) => { Object.assign(texts, f); return null; },
      onMarks: (m) => { marksOut.length = 0; marksOut.push(...m); },
    });
    return { s, texts };
  };
  it('je vois où est le curseur du collègue, qui suit le texte, et ce qu\'il tape surligné puis effacé', () => {
    const q = [], mB = [], mA = [];
    const init = { titre: '', commentaire: '<div>Constat : </div>' };
    const A = mk('A', q, init, mA), B = mk('B', q, init, mB);
    const deliver = () => { while (q.length) { const m = q.shift(); (m.tab === 'A' ? B : A).s.receive(m); } };
    A.s.hello(); B.s.hello(); deliver();
    // Thomas tape « fissure » à la fin du texte (avant </div>) et place son curseur après.
    const pos = '<div>Constat : '.length;
    A.s.local({ commentaire: '<div>Constat : fissure</div>' });
    A.s.cursor('commentaire', pos + 'fissure'.length);
    vi.advanceTimersByTime(100); deliver();
    expect(mB[0]).toMatchObject({ name: 'Thomas Cassetari', f: 'commentaire', caret: pos + 7 });
    expect(mB[0].ranges.commentaire).toEqual([[pos, pos + 7]]);
    // Stas insère du texte AVANT le curseur de Thomas : le curseur se décale avec le texte.
    B.s.local({ commentaire: '<div>XX Constat : fissure</div>' });
    expect(B.s.marks()[0].caret).toBe(pos + 7 + 3);
    // Thomas a fini d'écrire → le surlignage s'efface, le curseur reste.
    vi.advanceTimersByTime(2600);
    expect(mB[0].ranges.commentaire).toEqual([]);
    expect(mB[0].caret).toBe(pos + 10);
    // Thomas quitte le champ → plus de curseur.
    A.s.cursor(null, null); vi.advanceTimersByTime(100); deliver();
    expect(mB).toEqual([]);
  });
});

describe('positions HTML ↔ texte affiché', () => {
  it('balises ignorées, entité = 1 caractère', async () => {
    const { htmlToTextOffset, textToHtmlIndex } = await import('./liveText.js');
    const html = '<div>a&amp;b</div><div data-cap="x>y">cd</div>';
    expect(htmlToTextOffset(html, html.indexOf('b'))).toBe(2);
    expect(textToHtmlIndex(html, 2)).toBe(html.indexOf('b'));
    expect(textToHtmlIndex(html, 3)).toBe(html.indexOf('cd'));
    expect(htmlToTextOffset(html, html.length)).toBe(5);
  });
});
