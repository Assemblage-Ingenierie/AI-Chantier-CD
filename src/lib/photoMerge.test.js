import { describe, it, expect } from 'vitest';
import { keepCollaboratorPhotos } from './photoMerge.js';

describe('enregistrer une observation sans perdre les photos du collègue', () => {
  const p = (id, extra = {}) => ({ _id: id, data: `https://x/${id}`, ...extra });
  it('photo ajoutée par le collègue pendant que ma fenêtre est ouverte → conservée', () => {
    const base = [p('a'), p('b')];
    const saved = [p('a'), p('b'), p('mine')];
    const current = [p('a'), p('b'), { id: 'stas1', data: 'https://x/s' }];
    expect(keepCollaboratorPhotos(base, saved, current).map(x => x._id || x.id)).toEqual(['a', 'b', 'mine', 'stas1']);
  });
  it('photo que J\'AI supprimée dans la fenêtre → pas remise', () => {
    const base = [p('a'), p('b')];
    expect(keepCollaboratorPhotos(base, [p('a')], [p('a'), p('b')]).map(x => x._id)).toEqual(['a']);
  });
  it('rien de nouveau → liste enregistrée inchangée (même objet)', () => {
    const saved = [p('a')];
    expect(keepCollaboratorPhotos([p('a')], saved, [p('a')])).toBe(saved);
  });
});
