import { describe, it, expect, beforeEach } from 'vitest';
import { getPlaceAfterPhoto, setPlaceAfterPhoto, getGalleryCopy } from './cameraPrefs.js';

beforeEach(() => localStorage.clear());
describe('réglages photo', () => {
  it('par défaut : repérage sur plan oui, copie galerie non (pas de pop-up)', () => {
    expect(getPlaceAfterPhoto('v1')).toBe(true);
    expect(getGalleryCopy()).toBe(false);
  });
  it('repérage mémorisé PAR VISITE', () => {
    setPlaceAfterPhoto('v1', false);
    expect(getPlaceAfterPhoto('v1')).toBe(false);
    expect(getPlaceAfterPhoto('v2')).toBe(true);
    setPlaceAfterPhoto('v1', true);
    expect(getPlaceAfterPhoto('v1')).toBe(true);
  });
});
