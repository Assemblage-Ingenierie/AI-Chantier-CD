// DICTÉE PAR L'IA — retour Thomas 10/11 : « chez Pierre ça ne marche carrément pas » + « regarde
// si ça marche sur Firefox ».
//
// La dictée normale utilise la reconnaissance vocale DU NAVIGATEUR (Chrome / Safari). Firefox ne
// la propose pas du tout, et certains téléphones l'exposent sans qu'elle fonctionne (service vocal
// absent ou désactivé → erreur, ou silence total). Dans ces cas :
//   1. pendant l'appui sur le micro, l'app ENREGISTRE la voix (MediaRecorder) ;
//   2. au relâchement, l'audio est converti en WAV 16 kHz mono (format lu à coup sûr par Gemini,
//      quel que soit le navigateur : webm Chrome, ogg Firefox, mp4 Safari) ;
//   3. il est envoyé à l'IA (Gemini via /api/ai-proxy) qui renvoie le texte, ponctué.
// Dictée longue : découpée toute seule en morceaux de CHUNK_MS (taille d'envoi limitée).
//
// Choix du moteur (pickEngine, logique PURE testée) :
//   • réglage « Dictée par l'IA » coché dans les Paramètres → IA ;
//   • sinon reconnaissance du navigateur si elle existe ET n'a pas échoué récemment sur cet appareil ;
//   • sinon IA (Firefox…).
// Quand la reconnaissance du navigateur se révèle cassée, l'app bascule seule sur l'IA pour
// BROKEN_TTL_MS (puis retente le moteur du téléphone, qui a pu être réparé entre-temps).

import { callAIProxy } from './aiProxy.js';

const MODE_KEY = 'chantierai_dictee_mode';    // 'auto' (défaut) | 'ia'
const BROKEN_KEY = 'chantierai_dictee_broken'; // horodatage : moteur du téléphone en échec
export const BROKEN_TTL_MS = 7 * 24 * 3600 * 1000;
export const CHUNK_MS = 55000;   // ~1,8 Mo de WAV 16 kHz → bien sous la limite d'envoi Vercel (4,5 Mo)
const SAMPLE_RATE = 16000;

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* mode privé */ } };

export function getDictationMode() { return lsGet(MODE_KEY) === 'ia' ? 'ia' : 'auto'; }
export function setDictationMode(m) { lsSet(MODE_KEY, m === 'ia' ? 'ia' : null); }
export function markBrowserDictationBroken(now = Date.now()) { lsSet(BROKEN_KEY, String(now)); }
export function clearBrowserDictationBroken() { lsSet(BROKEN_KEY, null); }

export function hasBrowserSR(w = (typeof window !== 'undefined' ? window : {})) {
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}
export function canRecordAudio(w = (typeof window !== 'undefined' ? window : {})) {
  return !!(w.MediaRecorder && w.navigator?.mediaDevices?.getUserMedia && (w.AudioContext || w.webkitAudioContext));
}

// → 'browser' | 'ai' | 'none'
export function pickEngine({ hasSR, canRec, mode = 'auto', brokenAt = null, now = Date.now() }) {
  if (mode === 'ia' && canRec) return 'ai';
  const broken = Number.isFinite(brokenAt) && now - brokenAt < BROKEN_TTL_MS;
  if (hasSR && !(broken && canRec)) return 'browser';
  if (canRec) return 'ai';
  return hasSR ? 'browser' : 'none';
}
export function currentEngine() {
  const b = Number(lsGet(BROKEN_KEY));
  return pickEngine({ hasSR: hasBrowserSR(), canRec: canRecordAudio(), mode: getDictationMode(), brokenAt: b > 0 ? b : null });
}

// Erreurs de la reconnaissance du navigateur qui signifient « ce moteur ne marche pas ici »
// (≠ micro refusé : 'not-allowed', qui bloquerait aussi l'enregistrement).
export function isEngineFailure(error) {
  return ['service-not-allowed', 'network', 'language-not-supported', 'audio-capture', 'bad-grammar'].includes(error);
}

// Nettoie la réponse de l'IA : guillemets/encadrés parasites, marqueur de silence.
export function cleanTranscript(t) {
  let s = String(t ?? '').trim();
  s = s.replace(/^```[a-z]*\s*|\s*```$/gi, '').trim();
  s = s.replace(/^(transcription|texte)\s*:\s*/i, '').trim();
  if (/^["«“].*["»”]$/s.test(s)) s = s.slice(1, -1).trim();
  if (/^\(?\s*(vide|silence|aucune parole[^)]*|inaudible)\s*\)?\.?$/i.test(s)) return '';
  return s.replace(/\s+/g, ' ').trim();
}

export function pickMime(isSupported = (m) => (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m))) {
  for (const m of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg']) {
    try { if (isSupported(m)) return m; } catch { /* ignore */ }
  }
  return '';
}

// PCM float (mono) → WAV 16 bits.
export function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// Niveau sonore moyen (RMS) — sert à ne pas envoyer un silence à l'IA (elle inventerait du texte).
export function rms(samples) {
  if (!samples?.length) return 0;
  let s = 0; for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
  return Math.sqrt(s / samples.length);
}
export const SILENCE_RMS = 0.004;

async function toWav16k(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  try {
    const decoded = await ac.decodeAudioData(await blob.arrayBuffer());
    const len = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE));
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new OAC(1, len, SAMPLE_RATE);
    const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
    const rendered = await off.startRendering();
    const pcm = rendered.getChannelData(0);
    return { wav: encodeWav(pcm, SAMPLE_RATE), level: rms(pcm), seconds: decoded.duration };
  } finally { try { ac.close(); } catch { /* ignore */ } }
}

const blobToBase64 = (blob) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result).split(',')[1] || '');
  fr.onerror = () => rej(fr.error);
  fr.readAsDataURL(blob);
});

const SYSTEM = `Tu transcris la dictée d'un ingénieur sur un chantier de bâtiment (structure, gros œuvre, second œuvre, réhabilitation).
Transcris MOT POUR MOT, en français, ce qui est dit. Ajoute la ponctuation et les majuscules.
Vocabulaire fréquent : IPN, IPE, HEA, HEB, UPN, poutre, poutrelle, linteau, chaînage, poteau, voile, dalle, prédalle, hourdis, plancher, solive, chevêtre, longrine, semelle, radier, enduit, ragréage, fissure, microfissure, épaufrure, armatures, aciers, enrobage, béton, maçonnerie, moellons, parpaing, étaiement, étai, reprise en sous-œuvre, DTU, CCTP, Avis Technique, contreventement, flèche, corrosion, carbonatation.
N'ajoute rien, ne résume pas, ne reformule pas, ne réponds pas aux questions dictées.
Si aucune parole n'est audible, réponds exactement : (vide)
Réponds uniquement par le texte transcrit.`;

export async function transcribeAudio(wavBlob) {
  const data = await blobToBase64(wavBlob);
  const r = await callAIProxy({
    feature: 'dictee', provider: 'gemini', model: 'gemini-flash-latest',
    system: SYSTEM, temperature: 0, max_tokens: 2048, _throttleMs: 0,
    messages: [{ role: 'user', content: [
      { type: 'audio', source: { type: 'base64', media_type: 'audio/wav', data } },
      { type: 'text', text: 'Transcris cet enregistrement.' },
    ] }],
  });
  return cleanTranscript(r?.content?.[0]?.text);
}

// Enregistreur « appui long ». onChunk(text) reçoit le texte de chaque morceau transcrit (dans
// l'ordre) ; onState('recording' | 'transcribing' | 'idle') ; onError(message).
// → { stop(): Promise<void> (transcrit la fin), cancel() }
export async function startAiDictation({ onChunk, onState, onError } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  const mime = pickMime();
  let rec = null, stopped = false, timer = null, chunkDone = Promise.resolve();
  let queue = Promise.resolve();
  let pending = 0;
  const setState = () => onState?.(!stopped ? 'recording' : pending ? 'transcribing' : 'idle');

  const handleBlob = (blob) => {
    pending++; setState();
    // Morceaux traités DANS L'ORDRE (le texte arrive dans l'ordre où il a été dit).
    queue = queue.then(async () => {
      try {
        if (!blob || blob.size < 200) return;
        const { wav, level, seconds } = await toWav16k(blob);
        if (seconds < 0.4 || level < SILENCE_RMS) return; // silence → rien à envoyer
        const txt = await transcribeAudio(wav);
        if (txt) onChunk?.(txt);
      } catch (e) {
        onError?.(e?.message || 'Transcription impossible');
      } finally { pending--; setState(); }
    });
  };

  const startChunk = () => {
    const parts = [];
    rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    const r = rec;
    r.ondataavailable = (e) => { if (e.data?.size) parts.push(e.data); };
    chunkDone = new Promise(done => {
      r.onstop = () => {
        handleBlob(new Blob(parts, { type: r.mimeType || mime || 'audio/webm' }));
        if (!stopped) startChunk(); // dictée longue : on enchaîne un nouveau morceau
        else stream.getTracks().forEach(t => t.stop());
        done();
      };
    });
    r.start();
    clearTimeout(timer);
    timer = setTimeout(() => { if (r.state === 'recording') r.stop(); }, CHUNK_MS);
  };
  startChunk();
  setState();

  return {
    stop: () => {
      if (stopped) return queue;
      stopped = true; clearTimeout(timer);
      try { if (rec?.state === 'recording') rec.stop(); else stream.getTracks().forEach(t => t.stop()); } catch { stream.getTracks().forEach(t => t.stop()); }
      setState();
      // Attend que le dernier morceau soit poussé dans la file, puis sa transcription.
      return chunkDone.then(() => queue);
    },
    cancel: () => {
      stopped = true; clearTimeout(timer);
      onChunk = null;
      try { if (rec?.state === 'recording') rec.stop(); } catch { /* ignore */ }
      stream.getTracks().forEach(t => t.stop());
    },
  };
}
