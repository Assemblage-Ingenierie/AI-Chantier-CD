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
