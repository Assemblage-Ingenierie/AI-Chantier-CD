import { describe, it, expect } from 'vitest';
import { reportVisibleRect, reportCrop, autoCropXY } from './photoFrame.js';

const close = (r, e) => { for (const k of ['x', 'y', 'w', 'h']) expect(r[k]).toBeCloseTo(e[k], 4); };

describe('reportVisibleRect — partie de la photo visible dans le rapport', () => {
  it('photo 4:3 en cadre paysage : tout est visible', () => {
    expect(reportVisibleRect(4000, 3000, { orient: 'landscape' })).toBeNull();
  });
  it('photo 16:9 en cadre paysage centré : côtés coupés', () => {
    close(reportVisibleRect(1600, 900, { orient: 'landscape', cx: 50 }), { x: 0.125, y: 0, w: 0.75, h: 1 });
  });
  it('position à gauche (0 %) : on garde le bord gauche', () => {
    close(reportVisibleRect(1600, 900, { cx: 0 }), { x: 0, y: 0, w: 0.75, h: 1 });
  });
  it('photo paysage en cadre portrait : bande verticale', () => {
    close(reportVisibleRect(4000, 3000, { orient: 'portrait', cx: 50 }), { x: 0.21875, y: 0, w: 0.5625, h: 1 });
  });
  it('zoom ×2 au centre : un quart de l\'image', () => {
    close(reportVisibleRect(4000, 3000, { cx: 50, cy: 50, cz: 2 }), { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  });
  it('image entière : rien de coupé', () => {
    expect(reportVisibleRect(1600, 900, { fit: true })).toBeNull();
  });
});

describe('reportCrop — même règle que le rapport', () => {
  it('cadrage réglé à la main : respecté', () => {
    expect(reportCrop({ cropX: 10, cropY: 80, cropZoom: 1.5 })).toEqual([10, 80, 1.5]);
  });
  it('sans réglage : centré sur les annotations (photo large)', () => {
    const [x] = autoCropXY([{ x: 1500 }, { x: 1550 }], 1600, 900);
    expect(x).toBeGreaterThan(90);
    expect(reportCrop({ annotations: [{ x: 1500 }, { x: 1550 }], annotW: 1600, annotH: 900 })[0]).toBeCloseTo(x, 6);
  });
  it('sans annotation : centre', () => {
    expect(reportCrop({})).toEqual([50, 50, 1]);
  });
});
