import { describe, it, expect } from 'vitest';
import { platformOf, photoCopyName, captureRotation } from './deviceCamera.js';

const UA = {
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
  samsungInternet: 'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36',
  pixel: 'Mozilla/5.0 (Linux; Android 11; Pixel 3a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  pc: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
};

describe('plateforme', () => {
  it('Android (Chrome Samsung, Samsung Internet, vieux Pixel) / iPhone / iPad / PC', () => {
    expect(platformOf(UA.samsung, 5)).toMatchObject({ isAndroid: true, isIOS: false, isMobile: true });
    expect(platformOf(UA.samsungInternet, 5)).toMatchObject({ isAndroid: true });
    expect(platformOf(UA.pixel, 5)).toMatchObject({ isAndroid: true });
    expect(platformOf(UA.iphone, 5)).toMatchObject({ isIOS: true, isAndroid: false });
    expect(platformOf(UA.ipad, 5)).toMatchObject({ isIOS: true });        // iPadOS se présente en « Mac »
    expect(platformOf(UA.pc, 0)).toMatchObject({ isIOS: false, isAndroid: false, isMobile: false });
  });
});

describe('copie dans le téléphone : nom unique', () => {
  it('lisible dans la Galerie (projet + date + heure), JPG', () => {
    const n = photoCopyName('A660 L\'Oréal Grasse', new Date(2026, 10, 10, 14, 35, 12), () => 0.5);
    expect(n).toBe('AIChantier_A660-L-Oreal-Grasse_20261110-143512_7fff.jpg');
  });
  it('deux photos à la même seconde → deux noms différents (plus de « Télécharger à nouveau ? »)', () => {
    const d = new Date(2026, 10, 10, 14, 35, 12);
    let k = 0.1;
    const a = photoCopyName('Grasse', d, () => (k += 0.2));
    const b = photoCopyName('Grasse', d, () => (k += 0.2));
    expect(a).not.toBe(b);
  });
});

describe('viseur intégré : photo à l\'endroit', () => {
  it('écran déjà tourné en paysage → rien à corriger', () => {
    expect(captureRotation({ uiAngle: 90, beta: 2, gamma: 88 })).toBe(0);
    expect(captureRotation({ uiAngle: 270, beta: 2, gamma: -88 })).toBe(0);
  });
  it('écran verrouillé en portrait, téléphone tenu à l\'horizontale', () => {
    expect(captureRotation({ uiAngle: 0, beta: 5, gamma: 85 })).toBe(90);
    expect(captureRotation({ uiAngle: 0, beta: -8, gamma: -80 })).toBe(-90);
  });
  it('portrait, à plat ou capteur absent → aucune rotation', () => {
    expect(captureRotation({ uiAngle: 0, beta: 85, gamma: 3 })).toBe(0);   // portrait droit
    expect(captureRotation({ uiAngle: 0, beta: 2, gamma: 4 })).toBe(0);    // à plat (photo du sol)
    expect(captureRotation({ uiAngle: 0 })).toBe(0);                       // pas de capteur
  });
  it('tête en bas → 180°', () => {
    expect(captureRotation({ uiAngle: 0, beta: -80, gamma: 5 })).toBe(180);
  });
});
