import { describe, it, expect } from 'vitest';
import { dedupPlanPaths, computeVpNumbering } from './vpNumbering.js';

const txt = (text, x, y, extra = {}) => ({ type: 'text', text, x, y, color: '#E30513', size: 3, ...extra });

describe('dedupPlanPaths — textes', () => {
  it('garde les textes identiques placés à des endroits différents (incident 19/10)', () => {
    const paths = [
      txt('Création de ventilation', 100, 200, { textMode: 'arrow', arrowX: 300, arrowY: 400 }),
      txt('Création de ventilation', 900, 200, { textMode: 'arrow', arrowX: 800, arrowY: 400 }),
      txt('Création de ventilation', 100, 1500, { textMode: 'arrow', arrowX: 300, arrowY: 1300 }),
      txt('Création de ventilation', 900, 1500, { textMode: 'arrow', arrowX: 800, arrowY: 1300 }),
      txt('NV', 500, 600), txt('NV', 520, 1100), txt('NV', 800, 1100),
    ];
    expect(dedupPlanPaths(paths)).toHaveLength(7);
  });

  it('écarte toujours les copies superposées (quelques pixels de décalage)', () => {
    const paths = [txt('Façade Nord', 100, 100), txt('Façade Nord', 104, 97), txt('Façade Nord', 100, 100)];
    expect(dedupPlanPaths(paths)).toHaveLength(1);
  });

  it('même cadre mais flèches vers des endroits différents → deux annotations', () => {
    const paths = [
      txt('Fissure', 100, 100, { textMode: 'arrow', arrowX: 300, arrowY: 300 }),
      txt('Fissure', 100, 100, { textMode: 'arrow', arrowX: 900, arrowY: 300 }),
    ];
    expect(dedupPlanPaths(paths)).toHaveLength(2);
  });

  it('ne touche pas aux autres types (symboles en double superposés écartés)', () => {
    const paths = [
      { type: 'symbol', symbolId: 'fissure', x: 50, y: 50 },
      { type: 'symbol', symbolId: 'fissure', x: 52, y: 51 },
      { type: 'symbol', symbolId: 'fissure', x: 500, y: 500 },
    ];
    expect(dedupPlanPaths(paths)).toHaveLength(2);
  });
});

describe('numérotation par identité de photo (incident Voltaire 27/11)', () => {
  it('deux repères au même index périmé mais de photos différentes → deux numéros', () => {
    const locs = [{ id: 'Z', planAnnotations: { paths: [
      { type: 'viewpoint', photoIdx: 0, photoId: 'a', x: 1, y: 1 },
      { type: 'viewpoint', photoIdx: 0, photoId: 'b', x: 50, y: 50 },
    ] }, items: [{ id: 'A', photos: [{ _id: 'a', data: 'x' }, { _id: 'b', data: 'y' }] }] }];
    const { vxxPhotoMap } = computeVpNumbering(locs);
    expect(vxxPhotoMap.get('pid:a')).toBe(1);
    expect(vxxPhotoMap.get('pid:b')).toBe(2);
  });
});
