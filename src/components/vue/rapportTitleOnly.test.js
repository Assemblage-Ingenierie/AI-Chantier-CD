// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { flattenBlocks } from './RapportPreview.jsx';

// Retour Thomas 26/10 (observation de Stas) : intitulé + photos, SANS commentaire → l'intitulé
// doit être imprimé au-dessus des photos.
describe('rapport — observation avec intitulé et photos mais sans commentaire', () => {
  const loc = (items) => [{ id: 'L1', nom: 'RDC', items }];
  it('imprime l\'en-tête (intitulé) puis les photos', () => {
    const item = { id: 'i1', titre: 'Passivation des aciers apparents à prévoir.', commentaire: '', photos: [{ data: 'x.jpg' }, { data: 'y.jpg' }] };
    const b = flattenBlocks(loc([item]), false, 2);
    const its = b.filter(x => x.type === 'item');
    expect(its[0]).toMatchObject({ id: 'i1', mode: 'full' });
    expect(its.slice(1).every(x => x.mode === 'photos')).toBe(true);
  });
  it('avec commentaire : inchangé (bloc texte puis photos)', () => {
    const item = { id: 'i2', titre: 'JD', commentaire: 'Présence de laitance.', photos: [{ data: 'x.jpg' }] };
    const its = flattenBlocks(loc([item]), false, 2).filter(x => x.type === 'item');
    expect(its[0]).toMatchObject({ id: 'i2', mode: 'text' });
    expect(its.filter(x => x.mode === 'full')).toHaveLength(0);
  });
  it('intitulé seul, sans photo ni commentaire : imprimé', () => {
    const its = flattenBlocks(loc([{ id: 'i3', titre: 'À vérifier', commentaire: '', photos: [] }]), false, 2).filter(x => x.type === 'item');
    expect(its).toHaveLength(1);
    expect(its[0].mode).toBe('full');
  });
});
