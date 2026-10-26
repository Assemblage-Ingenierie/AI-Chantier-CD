// CO-ÉDITION EN DIRECT d'une observation (titre + commentaire), comme Google Docs — retour
// Thomas 26/10 : avec la v1 (texte entier, « le dernier qui tape gagne »), quand deux personnes
// écrivaient dans la même case, l'une effaçait l'autre et chacun ne voyait plus ce que l'autre
// écrivait. Ici chaque frappe est envoyée comme une petite opération (insérer / supprimer à tel
// endroit) dans un document partagé Yjs (CRDT) : les deux textes se FUSIONNENT caractère par
// caractère, dans le même ordre sur tous les appareils, sans jamais écraser l'autre.
//
// Fonctionnement :
//   • ouverture de la fenêtre → document initialisé de façon IDENTIQUE sur chaque appareil à partir
//     du texte enregistré (même texte → même document → aucun doublon à la fusion) ;
//   • « hello » → ceux qui ont la même observation ouverte répondent avec ce qui me manque ;
//     si leur version est différente (ouverte avant un enregistrement) et que je n'ai encore rien
//     tapé, je reprends LEUR session en cours (le texte serveur reste dans l'historique) ;
//   • chaque modification locale → opérations diffusées (regroupées ~60 ms) ;
//   • toutes les ~3 s tant qu'on travaille à plusieurs : comparaison des états → ce qui aurait été
//     perdu en route est renvoyé (le document converge toujours) ;
//   • pendant une dictée / une correction IA, les opérations reçues sont MISES DE CÔTÉ puis
//     appliquées à la fin (ces fonctions réécrivent le champ entier : elles ne doivent pas voir le
//     texte bouger sous elles).
// Les liens signés des images du commentaire (différents sur chaque appareil) sont retirés du
// document partagé : chaque appareil remet les siens à l'affichage.

import * as Y from 'yjs';
import DiffMatchPatch from 'diff-match-patch';

const dmp = new DiffMatchPatch();
dmp.Diff_Timeout = 0.1;

export const LIVE_FIELDS = ['titre', 'commentaire'];
const FLUSH_MS = 60;
const TICK_MS = 3000;
const PEER_ACTIVE_MS = 20000;
const MAX_B64 = 200000; // garde-fou taille de message Realtime

// ── utilitaires ─────────────────────────────────────────────────────────────────────────────
export function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
export function hashText(s) {
  let h = 0x811c9dc5;
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
// Liens d'images retirés du texte partagé (signés différemment sur chaque appareil).
export function stripSrc(html) { return String(html ?? '').replace(/\ssrc="[^"]*"/g, ''); }
// Remet les liens connus localement (chemin data-cimg → url) ; renvoie aussi les chemins inconnus.
export function restoreSrc(html, srcByPath) {
  const missing = [];
  const out = String(html ?? '').replace(/<img\b[^>]*>/gi, (tag) => {
    if (/\ssrc="/i.test(tag)) return tag;
    const m = tag.match(/\sdata-cimg="([^"]*)"/i);
    const url = m && srcByPath[m[1]];
    if (!url) { if (m && m[1]) missing.push(m[1]); return tag; }
    return tag.replace(/^<img\b/i, `<img src="${url.replace(/"/g, '&quot;')}"`);
  });
  return { html: out, missing };
}
export function srcMapOf(html) {
  const map = {};
  String(html ?? '').replace(/<img\b[^>]*>/gi, (tag) => {
    const p = tag.match(/\sdata-cimg="([^"]*)"/i), s = tag.match(/\ssrc="([^"]*)"/i);
    if (p && p[1] && s && s[1]) map[p[1]] = s[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    return tag;
  });
  return map;
}
// Position du curseur après une modification du texte (ce qui est inséré avant lui le décale).
export function mapOffset(oldText, newText, offset) {
  if (oldText === newText) return offset;
  return dmp.diff_xIndex(dmp.diff_main(oldText, newText), offset);
}

function norm(fields) {
  const o = {};
  for (const f of LIVE_FIELDS) o[f] = typeof fields?.[f] === 'string' ? fields[f] : '';
  return o;
}
// Même texte de départ → exactement le même document sur tous les appareils (identifiant 0).
export function initialUpdate(init) {
  const d = new Y.Doc();
  d.clientID = 0;
  d.transact(() => { for (const f of LIVE_FIELDS) if (init[f]) d.getText(f).insert(0, init[f]); });
  const u = Y.encodeStateAsUpdate(d);
  d.destroy();
  return u;
}
export function sessionIdOf(init) { return hashText(LIVE_FIELDS.map(f => init[f]).join('\u0000')); }

// Transforme « ancien texte → nouveau texte » en insertions / suppressions minimales.
function applyTextChange(ytext, from, to) {
  let pos = 0;
  for (const [op, s] of dmp.diff_main(from, to)) {
    if (op === 0) pos += s.length;
    else if (op === 1) { ytext.insert(pos, s); pos += s.length; }
    else ytext.delete(pos, s.length);
  }
}
function textsOf(doc) {
  const o = {};
  for (const f of LIVE_FIELDS) o[f] = doc.getText(f).toString();
  return o;
}
// (fonctions enveloppées : appelées comme méthodes, setTimeout & co lèvent « Illegal invocation »)
const BROWSER_TIMERS = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (t) => clearInterval(t),
};
function svAhead(mine, theirs) {
  for (const [client, clock] of mine) if ((theirs.get(client) || 0) < clock) return true;
  return false;
}

// send(msg) → true si le message a pu partir. onText(fields) : champs modifiés par les autres
// (texte sans liens d'images) à afficher — renvoie { champ: true } pour ceux non affichés. onConflict(info|null) : versions différentes non
// fusionnables (rare) — pour prévenir l'utilisateur.
export function createLiveSession({ initial, send, onText, onConflict = () => {}, now = () => Date.now(), timers = BROWSER_TIMERS }) {
  const init = norm(initial);
  let sid = sessionIdOf(init);
  let doc = null;
  let ui = { ...init };            // ce que l'écran affiche (texte sans liens)
  let localEdits = false;          // ai-je déjà modifié quelque chose ?
  let adopted = false;
  let held = false;
  const heldQueue = [];
  let pending = [];
  let flushTimer = null;
  let helloSent = false;
  let lastPeerAt = 0;
  let destroyed = false;

  const onDocUpdate = (u, origin) => {
    if (origin !== 'local' || destroyed) return;
    pending.push(u);
    if (!flushTimer) flushTimer = timers.setTimeout(flush, FLUSH_MS);
  };
  function makeDoc(update) {
    const d = new Y.Doc();
    Y.applyUpdate(d, update, 'init');
    d.on('update', onDocUpdate);
    return d;
  }
  doc = makeDoc(initialUpdate(init));

  function flush() {
    flushTimer = null;
    if (!pending.length || destroyed) return;
    const u = pending.length === 1 ? pending[0] : Y.mergeUpdates(pending);
    pending = [];
    const b = toB64(u);
    if (b.length <= MAX_B64) send({ k: 'u', sid, u: b });
  }
  // Affiche ce qui a changé. L'écran peut REFUSER un champ (ex. mot en cours de composition au
  // clavier Android, titre en cours de saisie) : il garde alors son texte, ma prochaine frappe est
  // rejouée sur le texte partagé (local) et le champ est réaffiché plus tard (tick / refresh).
  function pushRemote() {
    const t = textsOf(doc);
    const changed = {};
    for (const f of LIVE_FIELDS) if (t[f] !== ui[f]) changed[f] = t[f];
    if (!Object.keys(changed).length) return;
    const refused = onText(changed) || {};
    for (const f of Object.keys(changed)) if (!refused[f]) ui[f] = t[f];
  }
  function applyRemote(u) {
    if (held) { heldQueue.push(u); return; }
    Y.applyUpdate(doc, u, 'remote');
    pushRemote();
  }
  function stateFor(svB64) {
    const u = svB64 ? Y.encodeStateAsUpdate(doc, fromB64(svB64)) : Y.encodeStateAsUpdate(doc);
    const b = toB64(u);
    return b.length <= MAX_B64 ? b : null;
  }

  function hello() {
    if (destroyed) return;
    helloSent = send({ k: 'hello', sid, sv: toB64(Y.encodeStateVector(doc)) }) || false;
  }

  function receive(m) {
    if (destroyed || !m || !m.k) return;
    lastPeerAt = now();
    if (m.k === 'hello') {
      // Je réponds avec ce qui lui manque (ou tout mon document s'il a une autre version) + mon
      // état pour qu'il me renvoie ce qui me manque.
      const same = m.sid === sid;
      const u = stateFor(same ? m.sv : null);
      if (u) send({ k: 'state', to: m.tab, sid, u, sv: toB64(Y.encodeStateVector(doc)), full: !same });
      return;
    }
    if (m.k === 'state') {
      if (m.sid === sid) {
        if (m.u) applyRemote(fromB64(m.u));
        if (m.sv) { const u = stateFor(m.sv); if (u && svAhead(Y.decodeStateVector(Y.encodeStateVector(doc)), Y.decodeStateVector(fromB64(m.sv)))) send({ k: 'u', sid, u }); }
        onConflict(null);
        return;
      }
      if (!m.full || !m.u) return;
      if (!localEdits && !adopted && !held) {
        // Rien tapé ici : je rejoins sa session en cours (elle contient le texte le plus récent).
        try { doc.off('update', onDocUpdate); doc.destroy(); } catch { /* ignore */ }
        doc = makeDoc(fromB64(m.u));
        sid = m.sid;
        adopted = true;
        pushRemote();
        onConflict(null);
      } else {
        onConflict({ tab: m.tab });
      }
      return;
    }
    if (m.sid !== sid) return;
    if (m.k === 'u' && m.u) { applyRemote(fromB64(m.u)); return; }
    if (m.k === 'sv' && m.sv) {
      // Contrôle périodique : je renvoie ce qu'il n'a pas (ou mes suppressions si les textes diffèrent).
      const theirs = Y.decodeStateVector(fromB64(m.sv));
      const mine = Y.decodeStateVector(Y.encodeStateVector(doc));
      if (svAhead(mine, theirs) || (m.th && m.th !== hashText(LIVE_FIELDS.map(f => doc.getText(f).toString()).join('\u0000')))) {
        const u = stateFor(m.sv);
        if (u) send({ k: 'u', sid, u });
      }
    }
  }

  // Modification locale (frappe, dictée, IA…). Renvoie { changed:[champs], fix } — fix : texte
  // fusionné (déjà envoyé à onText) quand des opérations reçues entre-temps ont dû être intégrées.
  function local(fields) {
    if (destroyed) return { changed: [], fix: null };
    const changed = [];
    let fix = null;
    doc.transact(() => {
      for (const f of LIVE_FIELDS) {
        const v = fields?.[f];
        if (typeof v !== 'string' || v === ui[f]) continue;
        const yt = doc.getText(f);
        const cur = yt.toString();
        let target = v;
        if (cur !== ui[f]) {
          // L'écran n'avait pas encore reçu des opérations du collègue : on rejoue MA modification
          // (ancien écran → nouvel écran) sur le texte partagé, au lieu d'effacer la sienne.
          const [out] = dmp.patch_apply(dmp.patch_make(ui[f], v), cur);
          target = out;
          if (target !== v) (fix = fix || {})[f] = target;
        }
        applyTextChange(yt, cur, target);
        ui[f] = target;
        changed.push(f);
      }
    }, 'local');
    if (changed.length) localEdits = true;
    if (fix) {
      // Affiche la version fusionnée ; si l'écran la refuse, il garde SA saisie (rejouée plus tard).
      const refused = onText(fix) || {};
      for (const f of Object.keys(fix)) if (refused[f]) ui[f] = fields[f];
    }
    return { changed, fix };
  }

  function hold(on) {
    if (destroyed) return;
    held = !!on;
    if (held || !heldQueue.length) return;
    const q = heldQueue.splice(0);
    for (const u of q) Y.applyUpdate(doc, u, 'remote');
    pushRemote();
  }

  const tick = timers.setInterval(() => {
    if (destroyed) return;
    if (!helloSent) { hello(); return; }
    if (!held) pushRemote(); // un champ refusé plus tôt (composition, saisie) est réaffiché
    if (now() - lastPeerAt > PEER_ACTIVE_MS) return;
    send({ k: 'sv', sid, sv: toB64(Y.encodeStateVector(doc)), th: hashText(LIVE_FIELDS.map(f => doc.getText(f).toString()).join('\u0000')) });
  }, TICK_MS);

  function destroy() {
    if (destroyed) return;
    if (flushTimer) { timers.clearTimeout(flushTimer); flush(); }
    destroyed = true;
    timers.clearInterval(tick);
    try { doc.off('update', onDocUpdate); doc.destroy(); } catch { /* ignore */ }
  }

  return {
    hello, receive, local, hold, destroy,
    refresh: () => { if (!destroyed && !held) pushRemote(); },
    flush: () => { if (flushTimer) { timers.clearTimeout(flushTimer); flush(); } },
    text: () => textsOf(doc),
    sid: () => sid,
    hasLocalEdits: () => localEdits,
  };
}
