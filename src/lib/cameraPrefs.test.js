import { describe, it, expect, beforeEach } from 'vitest';
import { getPlaceAfterPhoto, setPlaceAfterPhoto, getGalleryCopy, getUseAppCamera, setUseAppCamera, markReopenCamera, consumeReopenCamera } from './cameraPrefs.js';

beforeEach(() => localStorage.clear());
describe('réglages photo', () => {
  it('par défaut : repérage oui, viseur rafale oui, copie galerie coupée (aucun pop-up)', () => {
    expect(getPlaceAfterPhoto('v1')).toBe(true);
    expect(getUseAppCamera()).toBe(true);
    expect(getGalleryCopy()).toBe(false);
  });
  it('repérage mémorisé PAR VISITE ; rafale mémorisée', () => {
    setPlaceAfterPhoto('v1', false);
    expect(getPlaceAfterPhoto('v1')).toBe(false);
    expect(getPlaceAfterPhoto('v2')).toBe(true);
    setUseAppCamera(false);
    expect(getUseAppCamera()).toBe(false);
  });
  it('drapeau « rouvrir le viseur » consommé une seule fois', () => {
    expect(consumeReopenCamera()).toBe(false);
    markReopenCamera();
    expect(consumeReopenCamera()).toBe(true);
    expect(consumeReopenCamera()).toBe(false);
  });
});
