import { describe, it, expect, beforeEach } from 'vitest';
import { getCameraMode, setCameraMode, getPlaceAfterPhoto, setPlaceAfterPhoto, getGalleryCopy, setGalleryCopy } from './cameraPrefs.js';

beforeEach(() => localStorage.clear());
describe('réglages photo', () => {
  it('par défaut : appareil du téléphone, repérage sur plan, copie galerie', () => {
    expect(getCameraMode()).toBe('phone');
    expect(getPlaceAfterPhoto()).toBe(true);
    expect(getGalleryCopy()).toBe(true);
  });
  it('mémorisés', () => {
    setCameraMode('app'); setPlaceAfterPhoto(false); setGalleryCopy(false);
    expect(getCameraMode()).toBe('app');
    expect(getPlaceAfterPhoto()).toBe(false);
    expect(getGalleryCopy()).toBe(false);
    setCameraMode('n_importe_quoi'); setPlaceAfterPhoto(true);
    expect(getCameraMode()).toBe('phone');
    expect(getPlaceAfterPhoto()).toBe(true);
  });
});
