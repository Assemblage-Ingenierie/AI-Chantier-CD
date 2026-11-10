import { describe, it, expect } from 'vitest';
import { pickEngine, cleanTranscript, isEngineFailure, pickMime, encodeWav, rms, BROKEN_TTL_MS } from './aiDictation.js';

describe('pickEngine', () => {
  const now = 1_000_000_000;
  it('Chrome/Safari : reconnaissance du téléphone par défaut', () => {
    expect(pickEngine({ hasSR: true, canRec: true, now })).toBe('browser');
  });
  it('Firefox (pas de reconnaissance) → IA', () => {
    expect(pickEngine({ hasSR: false, canRec: true, now })).toBe('ai');
  });
  it('réglage « IA » → IA même si le téléphone sait faire', () => {
    expect(pickEngine({ hasSR: true, canRec: true, mode: 'ia', now })).toBe('ai');
  });
  it('moteur du téléphone en panne récemment → IA, puis on retente après le délai', () => {
    expect(pickEngine({ hasSR: true, canRec: true, brokenAt: now - 1000, now })).toBe('ai');
    expect(pickEngine({ hasSR: true, canRec: true, brokenAt: now - BROKEN_TTL_MS - 1, now })).toBe('browser');
  });
  it('rien pour enregistrer → on garde ce qui existe', () => {
    expect(pickEngine({ hasSR: true, canRec: false, mode: 'ia', brokenAt: now, now })).toBe('browser');
    expect(pickEngine({ hasSR: false, canRec: false, now })).toBe('none');
  });
});

describe('cleanTranscript', () => {
  it('retire guillemets, préfixe et blocs de code', () => {
    expect(cleanTranscript('« Fissure au droit du linteau. »')).toBe('Fissure au droit du linteau.');
    expect(cleanTranscript('Transcription : Poutre IPN corrodée.')).toBe('Poutre IPN corrodée.');
    expect(cleanTranscript('```\nChaînage absent.\n```')).toBe('Chaînage absent.');
  });
  it('silence → vide', () => {
    for (const t of ['(vide)', 'vide', '(silence)', 'Inaudible.', '', null]) expect(cleanTranscript(t)).toBe('');
  });
  it('ne touche pas au vrai texte', () => {
    expect(cleanTranscript('Il y a une fissure  vide de 2 mm.')).toBe('Il y a une fissure vide de 2 mm.');
  });
});

describe('divers', () => {
  it('erreurs = moteur en panne (≠ micro refusé)', () => {
    expect(isEngineFailure('service-not-allowed')).toBe(true);
    expect(isEngineFailure('network')).toBe(true);
    expect(isEngineFailure('not-allowed')).toBe(false);
    expect(isEngineFailure('no-speech')).toBe(false);
    expect(isEngineFailure('aborted')).toBe(false);
  });
  it('format d\'enregistrement : Chrome webm, Firefox ogg, Safari mp4', () => {
    expect(pickMime(m => m === 'audio/webm;codecs=opus')).toBe('audio/webm;codecs=opus');
    expect(pickMime(m => m === 'audio/ogg;codecs=opus')).toBe('audio/ogg;codecs=opus');
    expect(pickMime(m => m === 'audio/mp4')).toBe('audio/mp4');
    expect(pickMime(() => false)).toBe('');
  });
  it('WAV 16 bits mono valide', async () => {
    const w = encodeWav(new Float32Array([0, 0.5, -0.5, 1]), 16000);
    const v = new DataView(await w.arrayBuffer());
    expect(w.size).toBe(44 + 8);
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe('RIFF');
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getInt16(44 + 6, true)).toBe(0x7fff);
  });
  it('niveau sonore : silence vs parole', () => {
    expect(rms(new Float32Array(100))).toBe(0);
    expect(rms(new Float32Array(100).fill(0.1))).toBeCloseTo(0.1);
  });
});
