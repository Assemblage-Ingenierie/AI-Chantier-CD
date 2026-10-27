import { describe, it, expect } from 'vitest';
import { planTargetLoc, placementItems, placementPhotoIdx } from './zonePlacement.js';

const locs = [
  { id: 'R4', nom: 'R+4', planId: 'p1', planBg: 'bg', items: [{ id: 'a', photos: [{ _id: 'pa', data: 'x' }] }] },
  { id: 'apt', nom: 'Appartement', parentId: 'R4', items: [{ id: 'b', photos: [{ _id: 'pb', data: 'x' }, { _id: 'pnodata' }] }] },
  { id: 'cave', nom: 'Cave', items: [] },
];

describe('repérage d\'une photo sur le plan de zone', () => {
  it('zone sans plan dans un groupe → plan du groupe ; zone avec plan → la sienne ; sinon rien', () => {
    expect(planTargetLoc(locs, 'apt').id).toBe('R4');
    expect(planTargetLoc(locs, 'R4').id).toBe('R4');
    expect(planTargetLoc(locs, 'cave')).toBe(null);
  });
  it('la nouvelle photo (pas encore enregistrée) est trouvée à sa place dans les photos du plan', () => {
    const form = { id: 'b', photos: [{ _id: 'pb', data: 'x' }, { _id: 'pnodata' }, { _id: 'new', data: 'data:..' }] };
    const items = placementItems(locs, locs[0], 'apt', form);
    expect(items.map(i => i.id)).toEqual(['a', 'b']);
    expect(placementPhotoIdx(items, 'new')).toBe(2); // pa, pb, new (la photo sans image est ignorée)
  });
  it('nouvelle observation (pas encore dans la zone) → ajoutée en fin', () => {
    const form = { id: 'n', photos: [{ _id: 'new', data: 'd' }] };
    const items = placementItems(locs, locs[0], 'apt', form);
    expect(items.map(i => i.id)).toEqual(['a', 'b', 'n']);
    expect(placementPhotoIdx(items, 'new')).toBe(2);
  });
});
