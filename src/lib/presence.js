// TRAVAIL À PLUSIEURS — étape 1 (demande Thomas 26/10, « comme Google Docs ») :
//   • PRÉSENCE : qui est connecté, dans quel projet, sur quelle observation (bulles en haut) ;
//   • DIRECT : quand un appareil enregistre un projet, les autres appareils qui l'ont OUVERT le
//     rechargent (ce projet seulement) → les modifs du collègue arrivent en quelques secondes.
// Transport : un canal Supabase Realtime (présence + diffusion), aucune table ni migration.
// La fusion reste celle de la sauvegarde (syncBase.js : champ par champ, rien n'est écrasé).
// Best-effort : sans réseau / Realtime indisponible → l'app fonctionne exactement comme avant.

import { getSupabase } from '../supabase.js';
import { logWarn } from './logger.js';

const CHANNEL = 'aichantier-presence-v1';
const TAB = (() => { try { return crypto.randomUUID(); } catch { return String(Math.random()).slice(2); } })();

let _channel = null;
let _subscribed = false;
let _me = null;            // { userId, initials, name, email, device, projectId, itemId, at }
let _others = [];          // autres onglets / appareils connectés
let _status = 'off';       // 'off' | 'connecting' | 'ok' | message d'erreur (diagnostic visible)
const _listeners = new Set();
const _statusListeners = new Set();
const _savedListeners = new Set();
const _liveListeners = new Set();
let _trackTimer = null;

const isMobileUA = () => { try { return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent); } catch { return false; } };

function emit() { _listeners.forEach(fn => { try { fn(_others); } catch { /* listener */ } }); }
function setStatus(st) {
  if (st === _status) return;
  _status = st;
  _statusListeners.forEach(fn => { try { fn(_status, _me); } catch { /* listener */ } });
}

function readState() {
  if (!_channel) return;
  const st = _channel.presenceState() || {};
  const list = [];
  for (const metas of Object.values(st)) for (const m of (metas || [])) if (m?.tab && m.tab !== TAB) list.push(m);
  _others = list;
  emit();
}

function scheduleTrack() {
  clearTimeout(_trackTimer);
  _trackTimer = setTimeout(() => {
    if (_channel && _subscribed && _me) _channel.track({ ..._me, at: Date.now() }).catch(() => {});
  }, 250);
}

// avatar : photo du compte (Google) — sinon initiales.
export async function startPresence(profile, userId, avatar = null) {
  if (_channel || !userId) return;
  setStatus('connecting');
  const first = (profile?.first_name || '').trim(), last = (profile?.last_name || '').trim();
  _me = {
    tab: TAB, userId,
    initials: (profile?.initials || `${first[0] || ''}${last[0] || ''}` || (profile?.email || '?')[0]).toUpperCase().slice(0, 3),
    name: [first, last].filter(Boolean).join(' ') || profile?.email || 'Utilisateur',
    device: isMobileUA() ? 'mobile' : 'pc',
    avatar: typeof avatar === 'string' && /^https:\/\//.test(avatar) ? avatar : null,
    projectId: null, itemId: null,
  };
  try {
    const sb = await getSupabase();
    _channel = sb.channel(CHANNEL, { config: { presence: { key: TAB }, broadcast: { self: false } } });
    _channel
      .on('presence', { event: 'sync' }, readState)
      .on('broadcast', { event: 'draft' }, ({ payload }) => receiveDraft(payload))
      .on('broadcast', { event: 'draft-end' }, ({ payload }) => receiveDraft(payload, true))
      .on('broadcast', { event: 'live' }, ({ payload }) => {
        if (!payload || payload.tab === TAB || (payload.to && payload.to !== TAB)) return;
        _liveListeners.forEach(fn => { try { fn(payload); } catch (e) { logWarn('presence.live', { error: String(e?.message || e) }); } });
      })
      .on('broadcast', { event: 'saved' }, ({ payload }) => {
        if (!payload || payload.tab === TAB) return;
        _savedListeners.forEach(fn => { try { fn(payload); } catch { /* listener */ } });
      })
      .subscribe((status, err) => {
        _subscribed = status === 'SUBSCRIBED';
        if (_subscribed) { setStatus('ok'); scheduleTrack(); return; }
        // CHANNEL_ERROR / TIMED_OUT / CLOSED : visible sur ma bulle + remonté dans les logs Vercel.
        const why = `${status}${err?.message ? ` : ${err.message}` : ''}`;
        setStatus(why);
        if (status !== 'CLOSED') logWarn('presence.channel', { status, error: err?.message || null });
      });
  } catch (e) {
    _channel = null;
    setStatus(`indisponible : ${e?.message || e}`);
    logWarn('presence.start', { error: String(e?.message || e) });
  }
}

export async function stopPresence() {
  clearTimeout(_trackTimer);
  const ch = _channel;
  _channel = null; _subscribed = false; _others = []; emit(); setStatus('off');
  try { if (ch) { await ch.untrack(); const sb = await getSupabase(); await sb.removeChannel(ch); } } catch { /* déjà fermé */ }
}

// Où je suis : { projectId } (projet ouvert) et/ou { itemId } (observation ouverte).
export function setPresenceLocation(patch) {
  if (!_me) return;
  const next = { ..._me, ...patch };
  if (next.projectId === _me.projectId && next.itemId === _me.itemId) return;
  _me = next;
  scheduleTrack();
}
export function getMyProjectId() { return _me?.projectId ?? null; }

// Après une sauvegarde réussie : prévient les autres appareils (projets concernés).
export function broadcastSaved(projectIds) {
  const ids = [...(projectIds || [])].filter(Boolean);
  if (!_channel || !_subscribed || !ids.length) return;
  _channel.send({ type: 'broadcast', event: 'saved', payload: { tab: TAB, userId: _me?.userId, projectIds: ids, at: Date.now() } }).catch(() => {});
}

export function subscribePresence(fn) { _listeners.add(fn); fn(_others); return () => _listeners.delete(fn); }
// Mon état (ma bulle) : statut du direct + mes infos (initiales, photo).
export function subscribePresenceStatus(fn) { _statusListeners.add(fn); fn(_status, _me); return () => _statusListeners.delete(fn); }
export function onRemoteSaved(fn) { _savedListeners.add(fn); return () => _savedListeners.delete(fn); }

// Couleur stable par personne (bulles).
const COLORS = ['#2563EB', '#16A34A', '#D97706', '#9333EA', '#0891B2', '#DB2777', '#65A30D', '#EA580C'];
export function colorFor(userId) {
  let h = 0;
  for (const c of String(userId || '')) h = (h * 31 + c.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

// Regroupe les onglets / appareils d'une même personne (une bulle par personne et par appareil).
export function groupPresence(others) {
  const m = new Map();
  for (const o of (others || [])) {
    const k = `${o.userId}|${o.device}`;
    const prev = m.get(k);
    if (!prev || (o.at || 0) > (prev.at || 0)) m.set(k, o);
  }
  return [...m.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

// ── FRAPPE EN DIRECT (comme Google Sheets, demande Thomas 26/10 : « je vois en direct ce qu'il
// écrit, avec son prénom à côté ») ────────────────────────────────────────────────────────────
// Pendant qu'on modifie une observation (fenêtre ouverte, avant « Enregistrer »), son titre et son
// commentaire sont diffusés en continu (≈ 3 fois / s au plus). Les autres appareils affichent ce
// texte EN DIRECT, entouré de la couleur de la personne et avec son prénom. Affichage seulement :
// rien n'est enregistré tant que la personne n'a pas enregistré elle-même.
const DRAFT_THROTTLE = 350;
const DRAFT_TTL = 15000;            // sans nouvelle frappe depuis 15 s → l'indication disparaît
const MAX_DRAFT_CHARS = 60000;      // garde-fou taille de message Realtime
const _drafts = new Map();          // `${tab}|${itemId}` → brouillon reçu
const _draftListeners = new Set();
const _draftOut = new Map();        // itemId → { timer, payload, last }
let _draftGc = null;

function emitDrafts() {
  const list = [..._drafts.values()];
  _draftListeners.forEach(fn => { try { fn(list); } catch { /* listener */ } });
}
function receiveDraft(p, ended = false) {
  if (!p || p.tab === TAB || !p.itemId) return;
  const k = `${p.tab}|${p.itemId}`;
  if (ended) { if (_drafts.delete(k)) emitDrafts(); return; }
  _drafts.set(k, { ...p, receivedAt: Date.now() });
  emitDrafts();
  if (!_draftGc) _draftGc = setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [key, d] of _drafts) if (now - d.receivedAt > DRAFT_TTL) { _drafts.delete(key); changed = true; }
    if (changed) emitDrafts();
    if (!_drafts.size) { clearInterval(_draftGc); _draftGc = null; }
  }, 3000);
}

function sendDraftNow(itemId) {
  const o = _draftOut.get(itemId);
  if (!o?.payload || !_channel || !_subscribed) return;
  o.last = Date.now();
  _channel.send({ type: 'broadcast', event: 'draft', payload: o.payload }).catch(() => {});
}

// field : 'titre' | 'commentaire' (le champ en cours de frappe).
export function broadcastDraft(projectId, itemId, { titre, commentaire, field }) {
  if (!_me || !projectId || !itemId) return;
  const c = typeof commentaire === 'string' && commentaire.length > MAX_DRAFT_CHARS ? null : commentaire;
  const payload = { tab: TAB, userId: _me.userId, name: _me.name, initials: _me.initials, avatar: _me.avatar,
    projectId, itemId, titre: titre ?? '', commentaire: c, field, at: Date.now() };
  const o = _draftOut.get(itemId) || { timer: null, payload: null, last: 0 };
  o.payload = payload;
  _draftOut.set(itemId, o);
  if (o.timer) return;
  const wait = Math.max(0, o.last + DRAFT_THROTTLE - Date.now());
  o.timer = setTimeout(() => { o.timer = null; sendDraftNow(itemId); }, wait);
}

// Fenêtre fermée / enregistrée : l'indication disparaît chez les autres.
export function broadcastDraftEnd(projectId, itemId) {
  const o = _draftOut.get(itemId);
  if (o?.timer) clearTimeout(o.timer);
  _draftOut.delete(itemId);
  if (!o || !_channel || !_subscribed) return; // jamais tapé → rien à effacer
  _channel.send({ type: 'broadcast', event: 'draft-end', payload: { tab: TAB, projectId, itemId } }).catch(() => {});
}

export function subscribeDrafts(fn) { _draftListeners.add(fn); fn([..._drafts.values()]); return () => _draftListeners.delete(fn); }

// Prénom pour l'étiquette (« Stas »).
export function firstName(name) { return String(name || '').trim().split(/\s+/)[0] || 'Quelqu\'un'; }

// ── CO-ÉDITION caractère par caractère (lib/liveText.js) : transport des opérations Yjs. ────
// Renvoie false si le direct n'est pas (encore) connecté — l'appelant réessaiera.
export function sendLive(payload) {
  if (!_channel || !_subscribed || !payload) return false;
  _channel.send({ type: 'broadcast', event: 'live', payload: { ...payload, tab: TAB, name: _me?.name, userId: _me?.userId } }).catch(() => {});
  return true;
}
export function onLive(fn) { _liveListeners.add(fn); return () => _liveListeners.delete(fn); }
