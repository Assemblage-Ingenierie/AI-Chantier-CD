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

// ── Curseurs en direct : position HTML (texte partagé) ↔ position dans le texte affiché. ──────
// Le texte partagé est du HTML ; le curseur à l'écran se compte en caractères visibles (balises
// ignorées, entité « &amp; » = 1 caractère).
function scanHtml(html, stopAt) {
  // stopAt(i, n) → true pour s'arrêter ; renvoie [indexHtml, nbCaractères]
  const s = String(html ?? '');
  let n = 0, i = 0;
  while (i < s.length) {
    if (stopAt(i, n)) return [i, n];
    const c = s[i];
    if (c === '<') {
      let q = null; i++;
      while (i < s.length && (q || s[i] !== '>')) { if (q) { if (s[i] === q) q = null; } else if (s[i] === '"' || s[i] === "'") q = s[i]; i++; }
      i++;
      continue;
    }
    if (c === '&') { const e = s.indexOf(';', i); if (e > i && e - i <= 10) { i = e + 1; n++; continue; } }
    i++; n++;
  }
  return [s.length, n];
}
export function htmlToTextOffset(html, idx) { return scanHtml(html, (i) => i >= idx)[1]; }
export function textToHtmlIndex(html, off) { return scanHtml(html, (i, n) => n >= off && String(html)[i] !== '<')[0]; }

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
export function createLiveSession({ initial, send, onText, onConflict = () => {}, onMarks = () => {}, now = () => Date.now(), timers = BROWSER_TIMERS }) {
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
  // Curseurs des collègues ({ f, rp, name, userId, at }) et ce qu'ils viennent de taper
  // (plages surlignées, effacées ~2,5 s après leur dernière frappe).
  const cursors = new Map();
  const typed = new Map();          // tab → { ranges:[{ f, a, b }], at }
  const peers = new Map();          // tab → { name, userId }
  let applyingFrom = null;          // onglet dont j'applique les opérations
  let marksTimer = null;
  let curTimer = null, curLast = 0, curPending;

  const onDocUpdate = (u, origin) => {
    if (origin !== 'local' || destroyed) return;
    pending.push(u);
    if (!flushTimer) flushTimer = timers.setTimeout(flush, FLUSH_MS);
  };
  function makeDoc(update) {
    const d = new Y.Doc();
    Y.applyUpdate(d, update, 'init');
    d.on('update', onDocUpdate);
    for (const f of LIVE_FIELDS) {
      const yt = d.getText(f);
      yt.observe((evt, tr) => {
        if (tr.origin !== 'remote' || !applyingFrom) return;
        const t = typed.get(applyingFrom) || { ranges: [], at: 0 };
        let idx = 0;
        for (const op of evt.delta) {
          if (op.retain) idx += op.retain;
          else if (typeof op.insert === 'string') {
            t.ranges.push({ f, a: Y.createRelativePositionFromTypeIndex(yt, idx), b: Y.createRelativePositionFromTypeIndex(yt, idx + op.insert.length, -1) });
            idx += op.insert.length;
          }
        }
        if (t.ranges.length > 200) t.ranges.splice(0, t.ranges.length - 200);
        t.at = now();
        typed.set(applyingFrom, t);
      });
    }
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
  function applyUpdateFrom(u, tab) {
    applyingFrom = tab || null;
    try { Y.applyUpdate(doc, u, 'remote'); } finally { applyingFrom = null; }
  }
  function applyRemote(u, tab) {
    if (held) { heldQueue.push([u, tab]); return; }
    applyUpdateFrom(u, tab);
    pushRemote();
    emitMarks();
  }

  // ── Curseurs / surlignage ──
  const TYPED_MS = 2500;
  const CURSOR_MS = 60000;
  function absIndex(rp) {
    try { const a = Y.createAbsolutePositionFromRelativePosition(rp, doc); return a ? a.index : null; } catch { return null; }
  }
  // Positions dans le texte partagé, seulement pour les champs que l'écran affiche à jour.
  function marks() {
    const t = now();
    const out = [];
    const tabs = new Set([...cursors.keys(), ...typed.keys()]);
    for (const tab of tabs) {
      const c = cursors.get(tab);
      const ty = typed.get(tab);
      const caretOk = c && c.f && c.rp && t - c.at < CURSOR_MS && ui[c.f] === doc.getText(c.f).toString();
      const ranges = { titre: [], commentaire: [] };
      if (ty && t - ty.at < TYPED_MS) {
        for (const r of ty.ranges) {
          if (ui[r.f] !== doc.getText(r.f).toString()) continue;
          const a = absIndex(r.a), b = absIndex(r.b);
          if (a != null && b != null && b > a) ranges[r.f].push([a, b]);
        }
      }
      if (!caretOk && !ranges.titre.length && !ranges.commentaire.length) continue;
      const who = peers.get(tab) || {};
      out.push({ tab, name: who.name || '', userId: who.userId || '', f: caretOk ? c.f : null, caret: caretOk ? absIndex(c.rp) : null, ranges });
    }
    return out;
  }
  function emitMarks() {
    if (destroyed) return;
    onMarks(marks());
    // le surlignage s'efface tout seul après la dernière frappe
    if (marksTimer) timers.clearTimeout(marksTimer);
    const next = [...typed.values()].map(v => v.at + TYPED_MS - now()).filter(d => d > 0);
    if (next.length) marksTimer = timers.setTimeout(() => { marksTimer = null; for (const [k, v] of typed) if (now() - v.at >= TYPED_MS) typed.delete(k); emitMarks(); }, Math.min(...next) + 30);
  }
  // Mon curseur (champ + position dans le texte partagé ; null = je ne suis plus dans un champ).
  function sendCursor() {
    curTimer = null; curLast = now();
    const c = curPending;
    if (destroyed || c === undefined) return;
    let rp = null;
    if (c && c.f && ui[c.f] === doc.getText(c.f).toString()) {
      const yt = doc.getText(c.f);
      rp = toB64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(yt, Math.max(0, Math.min(c.idx, yt.length)))));
    }
    send({ k: 'cur', sid, f: rp ? c.f : null, rp });
  }
  function cursor(f, idx) {
    curPending = f && idx != null ? { f, idx } : null;
    if (curTimer) return;
    curTimer = timers.setTimeout(sendCursor, Math.max(0, curLast + 80 - now()));
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
    if (m.tab && (m.name || m.userId)) peers.set(m.tab, { name: m.name || '', userId: m.userId || '' });
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
        if (m.u) applyRemote(fromB64(m.u), m.tab);
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
        cursors.clear(); typed.clear();
        pushRemote();
        onConflict(null);
      } else {
        onConflict({ tab: m.tab });
      }
      return;
    }
    if (m.sid !== sid) return;
    if (m.k === 'u' && m.u) {
      applyRemote(fromB64(m.u), m.tab);
      return;
    }
    if (m.k === 'cur') {
      if (!m.rp) cursors.delete(m.tab);
      else { try { cursors.set(m.tab, { f: m.f, rp: Y.decodeRelativePosition(fromB64(m.rp)), at: now() }); } catch { cursors.delete(m.tab); } }
      emitMarks();
      return;
    }
    if (m.k === 'bye') { cursors.delete(m.tab); typed.delete(m.tab); emitMarks(); return; }
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
    if (changed.length) { localEdits = true; if (cursors.size || typed.size) emitMarks(); }
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
    for (const [u, tab] of q) applyUpdateFrom(u, tab);
    pushRemote();
    emitMarks();
  }

  const tick = timers.setInterval(() => {
    if (destroyed) return;
    if (!helloSent) { hello(); return; }
    if (!held) pushRemote(); // un champ refusé plus tôt (composition, saisie) est réaffiché
    for (const [k, c] of cursors) if (now() - c.at >= CURSOR_MS) { cursors.delete(k); emitMarks(); }
    if (now() - lastPeerAt > PEER_ACTIVE_MS) return;
    send({ k: 'sv', sid, sv: toB64(Y.encodeStateVector(doc)), th: hashText(LIVE_FIELDS.map(f => doc.getText(f).toString()).join('\u0000')) });
  }, TICK_MS);

  function destroy() {
    if (destroyed) return;
    if (flushTimer) { timers.clearTimeout(flushTimer); flush(); }
    send({ k: 'bye', sid });
    destroyed = true;
    timers.clearInterval(tick);
    if (marksTimer) timers.clearTimeout(marksTimer);
    if (curTimer) timers.clearTimeout(curTimer);
    try { doc.off('update', onDocUpdate); doc.destroy(); } catch { /* ignore */ }
  }

  return {
    hello, receive, local, hold, destroy, cursor, marks,
    refresh: () => { if (!destroyed && !held) pushRemote(); },
    flush: () => { if (flushTimer) { timers.clearTimeout(flushTimer); flush(); } },
    text: () => textsOf(doc),
    sid: () => sid,
    hasLocalEdits: () => localEdits,
  };
}
