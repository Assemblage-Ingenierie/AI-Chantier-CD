import { describe, it, expect } from 'vitest';
import { normDeg, rotatedSize, canRotatePhoto } from './photoRotate.js';

describe('Rotation de photo', () => {
  it('angles normalisés', () => {
    expect(normDeg(90)).toBe(90);
    expect(normDeg(-90)).toBe(270);
    expect(normDeg(450)).toBe(90);
    expect(normDeg(180)).toBe(180);
  });
  it('quart de tour = largeur et hauteur échangées', () => {
    expect(rotatedSize(400, 300, 90)).toEqual({ w: 300, h: 400 });
    expect(rotatedSize(400, 300, -90)).toEqual({ w: 300, h: 400 });
    expect(rotatedSize(400, 300, 180)).toEqual({ w: 400, h: 300 });
  });
  it('seulement sur une photo chargée et SANS annotation', () => {
    expect(canRotatePhoto({ data: 'data:x' })).toBe(true);
    expect(canRotatePhoto({ data: 'data:x', annotations: [] })).toBe(true);
    expect(canRotatePhoto({ data: 'data:x', annotations: [{ type: 'pen' }] })).toBe(false);
    expect(canRotatePhoto({ data: null })).toBe(false);
  });
});
