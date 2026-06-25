import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 900;
import { DA, URGENCE, SUIVI } from '../../lib/constants.js';
import { renderMarkup } from '../../lib/markup.jsx';
import { Ic } from '../ui/Icons.jsx';
import IASug from './IASug.jsx';
import { callAIProxy } from '../../lib/aiProxy.js';
import Annotator from './Annotator.jsx';
import RichTextArea, { htmlToPlain } from '../ui/RichTextArea.jsx';
import { uploadToDrive } from '../../lib/driveUpload.js';
import { enqueuePhotoUpload } from '../../lib/photoUploadQueue.js';
import { setPhotoAnnotPref } from '../../lib/photoPrefs.js';
import { uploadCommentImage, signCommentPaths, resolveCommentHtml } from '../../lib/storage.js';

const DRAFT_KEY = (id) => `chantierai_draft_${id || 'new'}`;

function encodeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Strips leading words of txt that overlap with the tail of already-committed text.
// Guards against iOS SpeechRecognition resending previously-heard audio on auto-restart.
function stripLeadingOverlap(txt, committed) {
  if (!committed || !txt) return txt;
  const nw = txt.split(/\s+/).filter(Boolean);
  const sw = committed.split(/\s+/).filter(Boolean);
  const cap = Math.min(nw.length, sw.length, 12);
  for (let len = cap; len >= 1; len--) {
    let ok = true;
    for (let i = 0; i < len; i++) {
      if (nw[i].toLowerCase() !== sw[sw.length - len + i].toLowerCase()) { ok = false; break; }
    }
    if (ok) return nw.slice(len).join(' ').trim();
  }
  return txt;
}

function patchHtmlText(html, del, add) {
  if (!del) return html;
  const searchEnc = encodeHtml(del);
  const replaceEnc = encodeHtml(add);
  const TAG_RE = /(<[^>]*>)/g;
  const parts = [];
  let pos = 0, m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html)) !== null) {
    if (m.index > pos) parts.push({ tag: false, s: html.slice(pos, m.index) });
    parts.push({ tag: true, s: m[0] });
    pos = m.index + m[0].length;
  }
  if (pos < html.length) parts.push({ tag: false, s: html.slice(pos) });
  let replaced = false;
  return parts.map(p => {
    if (p.tag || replaced) return p.s;
    const idx = p.s.indexOf(searchEnc);
    if (idx < 0) return p.s;
    replaced = true;
    return p.s.slice(0, idx) + replaceEnc + p.s.slice(idx + searchEnc.length);
  }).join('');
}

export default function ItemModal({ item, planBg, planId, extraPlans = [], planAnnotations, onClose, onSave, onOpenAnnot, projetNom, projetId = null, visiteLabel, visiteDate, ingenieur, planLibrary = [], onBackRequest, vpNumByPath = null, vpBase = 0 }) {
  const [form, setForm] = useState(() => {
    // id stable dès le départ : sert d'ORIGINE aux marqueurs Vxx posés sur les plans de
    // l'observation (numérotation par photo de l'observation, cf. vpNumbering).
    const base = item
      ? { ...item, id: item.id || crypto.randomUUID(), photos: (item.photos||[]).filter(ph => ph.data), plans: item.plans || [], suivi: item.suivi||'rien', commentaireAlign: item.commentaireAlign||'left' }
      : { id: crypto.randomUUID(), titre:'', commentaire:'', urgence:'rien', photos:[], plans:[], suivi:'rien', commentaireAlign:'left' };
    try {
      const saved = localStorage.getItem(DRAFT_KEY(item?.id));
      if (saved) {
        const draft = JSON.parse(saved);
        if (draft.titre || draft.commentaire) return { ...base, ...draft, photos: base.photos };
      }
    } catch {}
    return base;
  });
  const [draftRestored, setDraftRestored] = useState(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY(item?.id));
      if (saved) { const d = JSON.parse(saved); return !!(d.titre || d.commentaire); }
    } catch {}
    return false;
  });
  const draftJustMounted = useRef(true);
  const [showPlan, setShowPlan] = useState(false);
  const [annotatingPhotoIdx, setAnnotatingPhotoIdx] = useState(null);
  const [annotatingCommentImg, setAnnotatingCommentImg] = useState(null); // { path, src } image collée du commentaire
  const [annotatingPlanIdx, setAnnotatingPlanIdx] = useState(null);
  const [showPlanPicker, setShowPlanPicker] = useState(false);
  const [confirmDelPhotoIdx, setConfirmDelPhotoIdx] = useState(null);
  const [zoomPhotoIdx, setZoomPhotoIdx] = useState(null); // long-press photo zoom
  const longPressTimer = useRef(null);
  const lpFiredRef = useRef(false); // true si l'appui long (zoom) s'est déclenché → tap simple = annoter
  const [compressing, setCompressing] = useState(false);
  const [editorSyncKey, setEditorSyncKey] = useState(0);
  const bumpSync = () => setEditorSyncKey(k => k + 1);

  // ── Images collées dans le commentaire (feature « comme Word ») ──────────────────────────
  // À l'ouverture : re-signe les URLs des images du commentaire (les URLs stockées peuvent
  // avoir expiré) → l'éditeur affiche toujours les images.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = form.commentaire;
      if (!c || !c.includes('data-cimg')) return;
      const resolved = await resolveCommentHtml(c);
      if (!cancelled && resolved !== c) { setForm(f => ({ ...f, commentaire: resolved })); bumpSync(); }
    })();
    return () => { cancelled = true; };
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Coller une image : upload dans le bucket photos → { path, url } pour insertion dans l'éditeur.
  const handlePasteCommentImage = useCallback(async (dataUrl) => {
    const path = await uploadCommentImage(dataUrl, form.id);
    if (!path) return null;
    const map = await signCommentPaths([path]);
    return map[path] ? { path, url: map[path] } : null;
  }, [form.id]);

  // Annoter une image du commentaire : ouvrir l'annotateur sur son image courante.
  const handleAnnotateCommentImage = useCallback((path) => {
    try {
      const doc = new DOMParser().parseFromString(form.commentaire || '', 'text/html');
      const img = doc.querySelector(`img[data-cimg="${path}"]`);
      if (img?.getAttribute('src')) setAnnotatingCommentImg({ path, src: img.getAttribute('src') });
    } catch { /* ignore */ }
  }, [form.commentaire]);
  const [recording, setRecording] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [correcting, setCorrecting] = useState(false);
  const [spellError, setSpellError] = useState('');
  const [spellDiff, setSpellDiff] = useState(null); // { original, corrected, tokens }
  const [reformulating, setReformulating] = useState(false);
  const [reformError, setReformError] = useState('');
  const [reformList, setReformList] = useState(null); // [{ extrait, propositions:[], raison }]
  const [reformApplied, setReformApplied] = useState(new Set());
  const gallRef = useRef();
  const camRef = useRef();
  const textareaRef = useRef(); // ref vers RichTextArea (expose focus() et getEditor())
  const annotatorRef = useRef(); // ref vers Annotator (expose getAnnotation() pour la nav photo)
  const recogRef       = useRef(null);
  const recordingRef   = useRef(false);
  const recogSessionId = useRef(0);
  const sessionFirst   = useRef(true);
  const lastCommitted  = useRef('');
  const sessionText    = useRef('');
  const restartTimer   = useRef(null);

  // Enregistre un handler de retour pour le bouton back Android — ferme d'abord les overlays internes
  useEffect(() => {
    if (!onBackRequest) return;
    onBackRequest(() => {
      if (zoomPhotoIdx !== null) { setZoomPhotoIdx(null); return true; }
      if (annotatingPhotoIdx !== null) { setAnnotatingPhotoIdx(null); return true; }
      if (annotatingPlanIdx !== null) { setAnnotatingPlanIdx(null); return true; }
      if (showPlan) { setShowPlan(false); return true; }
      if (showPlanPicker) { setShowPlanPicker(false); return true; }
      if (confirmDelPhotoIdx !== null) { setConfirmDelPhotoIdx(null); return true; }
      return false;
    });
    return () => onBackRequest?.(null);
  }, [onBackRequest, zoomPhotoIdx, annotatingPhotoIdx, annotatingPlanIdx, showPlan, showPlanPicker, confirmDelPhotoIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop dictaphone si la modale se ferme
  useEffect(() => () => {
    recordingRef.current = false;
    clearTimeout(restartTimer.current);
    recogRef.current?.abort();
  }, []);

  // Auto-dismiss draft banner when user modifies the form (skip first render)
  useEffect(() => {
    if (draftJustMounted.current) { draftJustMounted.current = false; return; }
    if (draftRestored) setDraftRestored(false);
  }, [form.titre, form.commentaire]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY(item?.id), JSON.stringify({ titre: form.titre, commentaire: form.commentaire, urgence: form.urgence, suivi: form.suivi, commentaireAlign: form.commentaireAlign })); } catch {}
    }, 600);
    return () => clearTimeout(t);
  }, [form.titre, form.commentaire, form.urgence, form.suivi]);

  const handleSave = () => {
    try { localStorage.removeItem(DRAFT_KEY(item?.id)); } catch {}
    onSave(form);
    onClose();
  };

  const doRecognize = useCallback(() => {
    if (!recordingRef.current) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.lang = 'fr-FR';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 3;

    // Each SR instance gets a unique ID so stale events from old sessions are ignored.
    const myId = ++recogSessionId.current;
    let localFinalIdx = 0; // local to this instance — never shared across sessions

    r.onresult = (e) => {
      if (recogSessionId.current !== myId) return; // stale event, discard
      let interim = '';
      const finals = [];
      for (let i = localFinalIdx; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          let best = e.results[i][0];
          for (let a = 1; a < e.results[i].length; a++) {
            if (e.results[i][a].confidence > best.confidence) best = e.results[i][a];
          }
          finals.push(best.transcript.trim());
          localFinalIdx = i + 1;
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      setInterimText(interim);
      if (finals.length) {
        let txt = finals.filter(Boolean).join(' ');
        if (!txt) return;
        // Strip any leading overlap with already-committed text (iOS overlap safety net)
        txt = stripLeadingOverlap(txt, sessionText.current);
        if (!txt || txt === lastCommitted.current) return;
        lastCommitted.current = txt;
        sessionText.current = sessionText.current ? sessionText.current + ' ' + txt : txt;
        const first = sessionFirst.current;
        sessionFirst.current = false;
        setForm(f => ({
          ...f,
          commentaire: f.commentaire ? f.commentaire + (first ? '\n' : ' ') + txt : txt,
        }));
      }
    };

    r.onerror = (ev) => {
      if (ev.error === 'not-allowed') {
        alert('Accès au microphone refusé. Vérifiez les permissions de votre navigateur.');
        recordingRef.current = false;
        recogRef.current = null;
        setInterimText('');
        setRecording(false);
      }
      // Other errors are non-fatal — onend fires next and handles any restart.
    };

    r.onend = () => {
      if (recogSessionId.current !== myId) return; // stale session, ignore
      recogRef.current = null;
      setInterimText('');
      if (recordingRef.current) {
        restartTimer.current = setTimeout(doRecognize, 150);
        return;
      }
      setRecording(false);
    };

    try { r.start(); recogRef.current = r; }
    catch { recordingRef.current = false; setRecording(false); }
  }, []);

  const startDictaphone = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Dictaphone non supporté — utilisez Chrome ou Safari récent.'); return; }
    recordingRef.current = true;
    sessionFirst.current = true;
    lastCommitted.current = '';
    sessionText.current = '';
    setInterimText('');
    setRecording(true);
    textareaRef.current?.resetTyping?.(); // évite que isTyping bloque la synchro DOM pendant la dictée
    doRecognize();
  };

  const stopDictaphone = () => {
    recordingRef.current = false;
    clearTimeout(restartTimer.current);
    setRecording(false);   // feedback immédiat — pas d'attente de onend
    setInterimText('');
    recogRef.current?.stop(); // délivre quand même le dernier mot via onresult
  };

  // Construit des segments diff avec corrections individuellement toggleables
  const buildDiffSegments = (orig, corr) => {
    const wa = orig.split(/(\s+)/);
    const wb = corr.split(/(\s+)/);
    const n = wa.length, m = wb.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++)
      for (let j = 1; j <= m; j++)
        dp[i][j] = wa[i-1] === wb[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
    const tokens = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && wa[i-1] === wb[j-1]) { tokens.unshift({ t:'eq', v:wb[j-1] }); i--; j--; }
      else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) { tokens.unshift({ t:'add', v:wb[j-1] }); j--; }
      else { tokens.unshift({ t:'del', v:wa[i-1] }); i--; }
    }
    // Grouper en segments : texte neutre ou correction toggleable
    const segs = [];
    let ci = 0, k = 0;
    while (k < tokens.length) {
      if (tokens[k].t === 'eq') {
        let text = '';
        while (k < tokens.length && tokens[k].t === 'eq') { text += tokens[k].v; k++; }
        segs.push({ type:'eq', text });
      } else {
        const dels = [], adds = [];
        while (k < tokens.length && tokens[k].t === 'del') { dels.push(tokens[k].v); k++; }
        while (k < tokens.length && tokens[k].t === 'add') { adds.push(tokens[k].v); k++; }
        segs.push({ type:'fix', id: ci++, del: dels.join(''), add: adds.join(''), active: true });
      }
    }
    return segs;
  };

  const toggleFix = (id) => setSpellDiff(d => ({
    ...d,
    segments: d.segments.map(s => s.type === 'fix' && s.id === id ? { ...s, active: !s.active } : s),
  }));

  const applyDiff = (all = false) => {
    const segs = all ? spellDiff.segments.map(s => s.type === 'fix' ? { ...s, active: true } : s) : spellDiff.segments;
    let result = form.commentaire;
    for (const seg of segs) {
      if (seg.type !== 'fix' || !seg.active || !seg.del) continue;
      result = patchHtmlText(result, seg.del, seg.add);
    }
    setForm(f => ({ ...f, commentaire: result }));
    setSpellDiff(null);
    bumpSync();
  };

  const fixSpelling = async () => {
    if (!form.commentaire?.trim() || correcting) return;
    setCorrecting(true);
    setSpellError('');
    setSpellDiff(null);
    try {
      const plain = htmlToPlain(form.commentaire);
      const d = await callAIProxy({
        feature: 'spell-correction',
        model: 'gemini-2.0-flash-lite',
        max_tokens: 2000,
        system: 'Tu es un correcteur orthographique et grammatical français. Corrige UNIQUEMENT les fautes d\'orthographe et de grammaire, sans rien reformuler, sans résumer, sans couper le texte. Le texte corrigé doit avoir exactement la même longueur et le même contenu que l\'original. Réponds UNIQUEMENT avec le texte intégral corrigé, sans guillemets ni explication.',
        messages: [{ role: 'user', content: plain }],
      });
      const corrected = d.content?.[0]?.text?.trim();
      const minLen = Math.floor(plain.length * 0.6);
      if (!corrected) throw new Error('Réponse vide du modèle');
      if (corrected.length < minLen) throw new Error('Réponse IA tronquée — réessaie');
      if (corrected === plain) {
        setSpellError('Aucune faute détectée ✓');
      } else {
        setSpellDiff({ original: plain, segments: buildDiffSegments(plain, corrected) });
      }
    } catch (e) { setSpellError(e.message || 'Erreur IA'); }
    setCorrecting(false);
  };

  // Propositions de reformulation — distinct de la correction ortho (qui reste intacte).
  // L'IA repère les passages lourds/répétitifs/maladroits et propose des réécritures à sens
  // strictement préservé, applicables individuellement (même mécanisme que les corrections).
  const reformulate = async () => {
    if (!form.commentaire?.trim() || reformulating) return;
    setReformulating(true);
    setReformError('');
    setReformList(null);
    setReformApplied(new Set());
    try {
      const plain = htmlToPlain(form.commentaire);
      const d = await callAIProxy({
        feature: 'reformulation',
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        system: 'Tu es un rédacteur expert en français technique (rapports de visite de chantier). Ta mission : améliorer en PROFONDEUR la qualité rédactionnelle du texte — clarté, fluidité, structure, concision, ton professionnel — en allant bien au-delà d\'une simple retouche de mots : tu peux restructurer une phrase, fusionner ou scinder des phrases, réordonner les idées, remplacer une tournure maladroite par une formulation nette. RÈGLE DE QUALITÉ NON NÉGOCIABLE : chaque reformulation doit être dans un français IMPECCABLE — orthographe, grammaire, accords, conjugaison et ponctuation parfaitement corrects. Une reformulation ne doit JAMAIS contenir de faute ni être moins correcte que l\'original. Ne JAMAIS ajouter de ponctuation non justifiée par le sens : en particulier, ne transforme JAMAIS une phrase affirmative en question et n\'ajoute aucun point d\'interrogation s\'il n\'y a pas réellement de question. IMPÉRATIF ABSOLU : préserve STRICTEMENT le sens, TOUS les faits techniques, les chiffres, les références et le vocabulaire métier ; n\'ajoute aucune information, n\'en retire aucune, n\'invente rien. Cible des passages SIGNIFICATIFS (phrases entières ou paragraphes complets), jamais des bouts de phrase isolés. Si un passage est confus, lourd ou mal structuré, propose une RÉÉCRITURE COMPLÈTE nettement meilleure (prends alors comme extrait le paragraphe entier, recopié à l\'identique). Pour chaque passage, donne 2 propositions : (1) une version améliorée proche de l\'originale, (2) une réécriture plus aboutie et mieux structurée. Les deux propositions doivent être irréprochables en français. Réponds UNIQUEMENT avec un JSON valide, sans aucun texte autour : [{"extrait":"<passage copié MOT POUR MOT depuis le texte original, ponctuation comprise>","propositions":["reformulation 1","reformulation 2"],"raison":"clarté|structure|lourdeur|répétition"}]. L\'extrait doit être recopié à l\'identique depuis le texte fourni, sinon il sera ignoré. Si vraiment rien n\'est à améliorer, réponds exactement [].',
        messages: [{ role: 'user', content: plain }],
      });
      const raw = d.content?.[0]?.text?.trim() || '';
      let list;
      try { list = JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim()); }
      catch { throw new Error('Réponse IA illisible — réessaie'); }
      if (!Array.isArray(list)) list = [];
      // Ne garder que les extraits réellement présents dans le texte (patch fiable)
      list = list.filter(s => s && typeof s.extrait === 'string' && plain.includes(s.extrait)
        && Array.isArray(s.propositions) && s.propositions.some(p => p && p.trim()));
      if (!list.length) setReformError('Aucune reformulation pertinente ✓');
      else setReformList(list);
    } catch (e) { setReformError(e.message || 'Erreur IA'); }
    setReformulating(false);
  };

  const applyReform = (idx, prop) => {
    const seg = reformList?.[idx];
    if (!seg || reformApplied.has(idx)) return;
    setForm(f => ({ ...f, commentaire: patchHtmlText(f.commentaire, seg.extrait, prop) }));
    setReformApplied(prev => new Set([...prev, idx]));
    bumpSync();
  };

  const compressPhoto = (file) => new Promise(res => {
    const r = new FileReader();
    r.onerror = () => res(null);
    r.onload = ev => {
      // Repli : si l'image ne peut pas être décodée/ré-encodée (HEIC sur navigateur sans
      // support, image partiellement corrompue…), on garde l'ORIGINAL non compressé plutôt
      // que de perdre la photo. Plus lourd, mais zéro perte — le pipeline downscale au besoin.
      const fallback = () => res({ data: ev.target.result, name: file.name });
      const img = new Image();
      img.onerror = fallback;
      img.onload = () => {
        try {
          const MAX = 1600;
          let { width, height } = img;
          if (width > MAX || height > MAX) {
            if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
            else { width = Math.round(width * MAX / height); height = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) { fallback(); return; }
          ctx.drawImage(img, 0, 0, width, height);
          // Try WebP first; iOS < 17 falls back to PNG which is much larger than JPEG
          let dataUrl = canvas.toDataURL('image/webp', 0.82);
          let ext = 'webp';
          if (!dataUrl.startsWith('data:image/webp')) {
            dataUrl = canvas.toDataURL('image/jpeg', 0.82);
            ext = 'jpg';
          }
          const name = file.name.replace(/\.[^.]+$/, '.' + ext);
          res({ data: dataUrl, name });
        } catch { fallback(); }
      };
      img.src = ev.target.result;
    };
    r.readAsDataURL(file);
  });

  const autoSaveToDevice = ({ data, name }) => {
    try {
      const a = document.createElement('a');
      a.href = data;
      a.download = name || `chantier_${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch { /* ignore */ }
  };

  const readFiles = (files, fromCamera = false) => {
    const filtered = Array.from(files).filter(f => {
      if (f.size > 25 * 1024 * 1024) { alert(`"${f.name}" est trop volumineux (max 25 Mo)`); return false; }
      return true;
    });
    if (!filtered.length) return;
    setCompressing(true);
    Promise.all(filtered.map(compressPhoto))
      .then(done => {
        // _id : identifiant STABLE de la ligne photo en DB, attribué dès la création.
        // INDISPENSABLE : processPhotosForItem (storage.js) fait `id: ph._id ?? ... ?? randomUUID()`.
        // Sans _id local, chaque saveRemote (~5s) régénérait un UUID neuf → une nouvelle ligne
        // upsertée à chaque cycle → photos dédoublées à l'infini. Même pattern que la
        // duplication d'observation (VisitesScreen.jsx). L'hydratation matche justement par _id.
        // _uploadId : handle d'upload anticipé (file photoUploadQueue) — la photo part vers
        // Storage immédiatement ; saveRemote réutilise le chemin déjà uploadé. Rôle distinct du _id.
        const valid = done.filter(Boolean).map(ph => ({ ...ph, _id: crypto.randomUUID(), _uploadId: crypto.randomUUID() }));
        if (valid.length < done.length) {
          alert(`${done.length - valid.length} photo(s) n'ont pas pu être traitées. Réessayez ou choisissez un autre fichier.`);
        }
        if (projetId) {
          valid.forEach(ph => enqueuePhotoUpload({
            uploadId: ph._uploadId, projetNom, projetId, itemId: form.id, name: ph.name, dataUrl: ph.data,
          }));
        }
        setForm(prev => ({ ...prev, photos: [...prev.photos, ...valid] }));
        if (fromCamera) {
          const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
          if (!isIOS) valid.forEach(autoSaveToDevice); // download link ouvre un onglet sur iOS, skip
          valid.forEach(ph => uploadToDrive({ ...ph, projetNom, visiteLabel, visiteDate, ingenieur }));
        }
      })
      .finally(() => setCompressing(false));
  };


  // Annotateur d'une image COLLÉE du commentaire : on cuit le composite annoté, on l'upload,
  // puis on remplace src + data-cimg de l'image dans le HTML du commentaire.
  if (annotatingCommentImg) {
    return (
      <Annotator
        bgImage={annotatingCommentImg.src}
        savedPaths={[]}
        title="Annoter l'image"
        onClose={() => setAnnotatingCommentImg(null)}
        onSave={async (paths, exported) => {
          const oldPath = annotatingCommentImg.path;
          setAnnotatingCommentImg(null);
          if (!exported) return;
          const newPath = await uploadCommentImage(exported, form.id);
          if (!newPath) return;
          const map = await signCommentPaths([newPath]);
          const url = map[newPath];
          if (!url) return;
          setForm(f => {
            try {
              const doc = new DOMParser().parseFromString(f.commentaire || '', 'text/html');
              const img = doc.querySelector(`img[data-cimg="${oldPath}"]`);
              if (!img) return f;
              img.setAttribute('src', url);
              img.setAttribute('data-cimg', newPath);
              return { ...f, commentaire: doc.body.innerHTML };
            } catch { return f; }
          });
          bumpSync();
        }}
      />
    );
  }

  if (annotatingPhotoIdx !== null) {
    const ph = form.photos[annotatingPhotoIdx];
    const total = form.photos.length;
    // Applique les annotations en cours à la photo courante SANS fermer (avant de naviguer).
    const applyCurrentAnnotation = () => {
      const a = annotatorRef.current?.getAnnotation?.();
      if (!a) return;
      setPhotoAnnotPref(ph?._id, { annotW: a.annotW, annotH: a.annotH, annotSizeScale: a.annotSizeScale });
      setForm(f => ({
        ...f,
        photos: f.photos.map((p, i) => i === annotatingPhotoIdx ? { ...p, annotations: a.paths, annotated: a.annotated, annotW: a.annotW, annotH: a.annotH, annotSizeScale: a.annotSizeScale ?? null } : p),
      }));
    };
    const goToPhoto = (newIdx) => {
      if (newIdx < 0 || newIdx >= total || newIdx === annotatingPhotoIdx) return;
      applyCurrentAnnotation(); // sauve l'annotation en cours → zéro perte
      setAnnotatingPhotoIdx(newIdx);
    };
    return (
      <Annotator
        ref={annotatorRef}
        bgImage={ph?.data}
        savedPaths={ph?.annotations || []}
        onSave={(paths, exported, dims) => {
          setPhotoAnnotPref(ph?._id, { annotW: dims?.w, annotH: dims?.h, annotSizeScale: dims?.annotSizeScale });
          setForm(f => ({
            ...f,
            photos: f.photos.map((p, i) => i === annotatingPhotoIdx ? { ...p, annotations: paths, annotated: exported, annotW: dims?.w, annotH: dims?.h, annotSizeScale: dims?.annotSizeScale ?? null } : p),
          }));
          setAnnotatingPhotoIdx(null);
        }}
        onClose={() => setAnnotatingPhotoIdx(null)}
        onPrev={annotatingPhotoIdx > 0 ? () => goToPhoto(annotatingPhotoIdx - 1) : null}
        onNext={annotatingPhotoIdx < total - 1 ? () => goToPhoto(annotatingPhotoIdx + 1) : null}
        photoPosition={total > 1 ? `${annotatingPhotoIdx + 1} / ${total}` : null}
      />
    );
  }

  if (annotatingPlanIdx !== null) {
    const pl = form.plans[annotatingPlanIdx];
    const bg = planLibrary.find(p => p.id === pl?.planId)?.bg || null;
    // R2 : numéros déjà attribués aux photos de l'observation sur les AUTRES plans de
    // l'observation → la même photo posée ici reprend son numéro. Base de session = max global
    // + numéros figés sur les plans de l'observation (un nouveau marqueur ne réutilise rien).
    const planPhotoVpNums = new Map();
    let planSessionBase = vpBase;
    form.plans.forEach((p, i) => {
      for (const a of (p.planAnnotations?.paths || [])) {
        if (a.type !== 'viewpoint' || a.vpNum == null) continue;
        planSessionBase = Math.max(planSessionBase, a.vpNum);
        if (i !== annotatingPlanIdx && a.photoIdx != null && (a.originLocId == null || a.originLocId === form.id) && !planPhotoVpNums.has(a.photoIdx)) {
          planPhotoVpNums.set(a.photoIdx, a.vpNum);
        }
      }
    });
    return (
      <Annotator
        bgImage={bg}
        savedPaths={pl?.planAnnotations?.paths || []}
        photos={form.photos}
        locId={form.id ?? null}
        photoVpNums={planPhotoVpNums}
        vpNumByPath={vpNumByPath}
        vpBase={planSessionBase}
        onSave={(paths, exported) => {
          setForm(f => ({
            ...f,
            plans: f.plans.map((p, i) => i === annotatingPlanIdx ? { ...p, planAnnotations: { paths, exported } } : p),
          }));
          setAnnotatingPlanIdx(null);
        }}
        onClose={() => setAnnotatingPlanIdx(null)}
      />
    );
  }

  if (showPlanPicker) {
    return (
      <div className="modal-overlay">
        <div className="modal-sheet" style={{ padding:20 }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:16 }}>
            <p style={{ fontWeight:800, fontSize:15, color:DA.black, margin:0 }}>Ajouter un plan</p>
            <button onClick={() => setShowPlanPicker(false)} style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL }}><Ic n="x" s={20}/></button>
          </div>
          {planLibrary.length === 0 ? (
            <p style={{ color:DA.grayL, textAlign:'center', padding:24, fontSize:13 }}>Aucun plan dans la bibliothèque du projet</p>
          ) : planLibrary.map(pl => (
            <button key={pl.id} onClick={() => {
              setForm(f => ({ ...f, plans: [...f.plans, { id: crypto.randomUUID(), planId: pl.id, planBg: pl.bg || null, planAnnotations: null }] }));
              setShowPlanPicker(false);
            }} style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'10px 12px', border:`1px solid ${DA.border}`, borderRadius:10, background:'white', marginBottom:8, cursor:'pointer', textAlign:'left' }}>
              {pl.bg && <img src={pl.bg} alt="" style={{ width:56, height:36, objectFit:'cover', borderRadius:4, flexShrink:0 }}/>}
              <p style={{ fontSize:13, fontWeight:600, color:DA.black, margin:0 }}>{pl.nom || 'Plan sans nom'}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (showPlan) return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',zIndex:50,display:'flex',flexDirection:'column' }}>
      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',background:DA.black,flexShrink:0 }}>
        <p style={{ fontWeight:600,color:'white',fontSize:13 }}>Plan de la zone</p>
        <div style={{ display:'flex',gap:8 }}>
          {planBg && (
            <button onClick={() => { setShowPlan(false); onOpenAnnot(form); }}
              style={{ background:DA.red,color:'white',border:'none',borderRadius:8,padding:'6px 12px',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',gap:4,cursor:'pointer' }}>
              <Ic n="pen" s={12}/> Annoter
            </button>
          )}
          <button onClick={() => setShowPlan(false)} style={{ background:'none',border:`1px solid rgba(255,255,255,0.2)`,borderRadius:8,color:DA.grayL,width:34,height:34,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0 }}><Ic n="x" s={18}/></button>
        </div>
      </div>
      <div style={{ flex:1,overflow:'auto',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:8,background:'#1a1a1a' }}>
        {planBg
          ? <img src={planAnnotations?.exported || planBg} alt="plan" style={{ maxWidth:'100%',height:'auto' }}/>
          : <div style={{ color:DA.grayL,textAlign:'center',padding:48 }}><Ic n="map" s={40}/><p style={{ marginTop:12 }}>Aucun plan pour cette zone</p></div>
        }
      </div>
    </div>
  );

  const FMT_BTNS = [
    { label:'G', title:'Gras (Ctrl+B)',      cmd:'bold',           fw:800 },
    { label:'I', title:'Italique (Ctrl+I)',  cmd:'italic',         fi:'italic' },
    { label:'S', title:'Souligné (Ctrl+U)', cmd:'underline',      td:'underline' },
    { label:'S', title:'Barré',              cmd:'strikeThrough',  td:'line-through' },
    { label:'•', title:'Liste à puces',      cmd:'insertUnorderedList', fw:700, fs:16 },
  ];
  const ALIGN_BTNS = [
    { k:'left',    sym:'←', title:'Aligner à gauche' },
    { k:'center',  sym:'↔', title:'Centrer' },
    { k:'right',   sym:'→', title:'Aligner à droite' },
    { k:'justify', sym:'☰', title:'Justifier' },
  ];

  // Inputs fichiers (hidden)
  const fileInputs = (
    <>
      <input ref={gallRef} type="file" accept="image/*" multiple style={{ display:'none' }} onChange={e => readFiles(e.target.files)}/>
      <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display:'none' }}
        onChange={e => { if (e.target.files?.length) readFiles(e.target.files, true); setTimeout(() => { if(camRef.current) camRef.current.value=''; }, 200); }}/>
    </>
  );

  return (
    <div className="modal-overlay" style={{ zIndex:40 }}>
      <div className="modal-sheet-flex">
        {/* Sticky header */}
        <div style={{ padding: isDesktop ? '16px 24px 12px' : '14px 16px 12px', borderBottom:`1px solid ${DA.border}`, flexShrink:0 }}>
          <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:draftRestored ? 8 : 0 }}>
            <p style={{ fontWeight:700,fontSize:15,color:DA.black }}>
              {item ? "Modifier l'observation" : 'Nouvelle observation'}
            </p>
            <button onClick={onClose} style={{ background:'none',border:'none',cursor:'pointer',color:DA.grayL,display:'flex',alignItems:'center',justifyContent:'center',padding:4 }}><Ic n="x" s={20}/></button>
          </div>
          {draftRestored && (
            <div style={{ display:'flex',alignItems:'center',gap:6,padding:'6px 10px',background:'#FFF7ED',border:'1px solid #FCD34D',borderRadius:8,marginTop:8 }}>
              <span style={{ fontSize:11,color:'#92400E',fontWeight:600 }}>📝 Brouillon restauré</span>
              <button onClick={() => { setDraftRestored(false); try { localStorage.removeItem(DRAFT_KEY(item?.id)); } catch {} setForm(item ? { ...item, photos:(item.photos||[]).filter(ph=>ph.data), suivi:item.suivi||'rien', commentaireAlign: item.commentaireAlign||'left' } : { titre:'',commentaire:'',urgence:'rien',photos:[],suivi:'rien',commentaireAlign:'left' }); }}
                style={{ marginLeft:'auto',fontSize:10,color:'#92400E',background:'none',border:'1px solid #FCD34D',borderRadius:5,padding:'2px 7px',cursor:'pointer',fontWeight:600 }}>
                Ignorer
              </button>
            </div>
          )}
          {fileInputs}
        </div>
        {/* Scrollable content */}
        <div style={{ flex:1, overflowY:'auto', padding: isDesktop ? '16px 24px' : '14px 16px' }}>

          {/* Titre */}
          <div style={{ marginBottom:14 }}>
            <label style={{ display:'block',fontSize:12,fontWeight:600,color:DA.gray,marginBottom:6,textTransform:'uppercase',letterSpacing:0.5 }}>Intitulé</label>
            <input value={form.titre} onChange={e => setForm(f => ({ ...f, titre: e.target.value }))}
              placeholder="Ex: Fissures, Humidité…"
              style={{ width:'100%',border:`1px solid ${DA.border}`,borderRadius:8,padding:'12px 14px',fontSize:15,outline:'none',boxSizing:'border-box' }}
              onFocus={e => e.target.style.borderColor=DA.red} onBlur={e => e.target.style.borderColor=DA.border}/>
          </div>

          {/* Niveau + Suivi — une seule ligne */}
          <div style={{ display:'flex',gap:8,marginBottom:14,overflowX:'auto' }}>
            {/* Groupe Niveau */}
            <div style={{ display:'inline-flex',alignItems:'center',gap:2,background:'#F8F8F8',border:`1px solid ${DA.border}`,borderRadius:10,padding:'5px 7px',flexShrink:0 }}>
              <span style={{ fontSize:10,fontWeight:800,color:DA.gray,textTransform:'uppercase',letterSpacing:0.8,paddingRight:6,paddingLeft:2,whiteSpace:'nowrap',borderRight:`1px solid ${DA.border}`,marginRight:4 }}>Niveau</span>
              {Object.entries(URGENCE).map(([k, u]) => {
                const on = form.urgence === k;
                return (
                  <button key={k} onClick={() => setForm(f => ({ ...f, urgence: k }))}
                    style={{ padding:'4px 9px',borderRadius:6,fontSize:12,fontWeight:on?700:500,border:'none',background:on?u.dot:'transparent',color:on?'white':'#777',cursor:'pointer',whiteSpace:'nowrap',flexShrink:0,display:'flex',alignItems:'center',gap:3 }}>
                    {!on && <span style={{ width:5,height:5,borderRadius:'50%',background:u.dot,flexShrink:0 }}/>}
                    {u.label}
                  </button>
                );
              })}
            </div>
            {/* Groupe Suivi */}
            <div style={{ display:'inline-flex',alignItems:'center',gap:2,background:'#F8F8F8',border:`1px solid ${DA.border}`,borderRadius:10,padding:'5px 7px',flexShrink:0 }}>
              <span style={{ fontSize:10,fontWeight:800,color:DA.gray,textTransform:'uppercase',letterSpacing:0.8,paddingRight:6,paddingLeft:2,whiteSpace:'nowrap',borderRight:`1px solid ${DA.border}`,marginRight:4 }}>Suivi</span>
              {Object.entries(SUIVI).map(([k, s]) => {
                const on = form.suivi === k;
                return (
                  <button key={k} onClick={() => setForm(f => ({ ...f, suivi: k }))}
                    style={{ padding:'4px 9px',borderRadius:6,fontSize:12,fontWeight:on?700:500,border:'none',background:on?s.dot:'transparent',color:on?'white':'#777',cursor:'pointer',whiteSpace:'nowrap',flexShrink:0,display:'flex',alignItems:'center',gap:3 }}>
                    {!on && <span style={{ width:5,height:5,borderRadius:'50%',background:s.dot,flexShrink:0 }}/>}
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Commentaire — pleine largeur */}
          <div style={{ marginBottom:14 }}>
            <label style={{ display:'block',fontSize:12,fontWeight:600,color:DA.gray,textTransform:'uppercase',letterSpacing:0.5,marginBottom:6 }}>Commentaire</label>

            {/* Toolbar : G/I/S + séparateur + alignements */}
            <div style={{ display:'flex',gap:3,marginBottom:0,alignItems:'center',flexWrap:'wrap',padding:'6px 8px',background:'#F8F8F8',border:`1px solid ${DA.border}`,borderRadius:'8px 8px 0 0',borderBottom:'none' }}>
              {FMT_BTNS.map((btn, bi) => (
                <button key={btn.cmd} type="button" title={btn.title}
                  onMouseDown={e => { e.preventDefault(); document.execCommand(btn.cmd); textareaRef.current?.getEditor()?.focus(); }}
                  style={{ width:30,height:28,borderRadius:5,border:`1px solid ${DA.border}`,background:'white',color:DA.black,fontSize:btn.fs??13,fontWeight:btn.fw??400,fontStyle:btn.fi??'normal',textDecoration:btn.td??'none',cursor:'pointer',userSelect:'none',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
                  {btn.label}
                </button>
              ))}
              <div style={{ width:1,height:20,background:DA.border,margin:'0 4px',flexShrink:0 }}/>
              {ALIGN_BTNS.map(a => (
                <button key={a.k} type="button" title={a.title}
                  onMouseDown={e => { e.preventDefault(); setForm(f => ({ ...f, commentaireAlign: a.k })); }}
                  style={{ width:30,height:28,borderRadius:5,fontSize:14,cursor:'pointer',flexShrink:0,
                    border:`1.5px solid ${form.commentaireAlign===a.k ? DA.red : DA.border}`,
                    background: form.commentaireAlign===a.k ? DA.redL : 'white',
                    color: form.commentaireAlign===a.k ? DA.red : DA.gray,
                    display:'flex',alignItems:'center',justifyContent:'center' }}>
                  {a.sym}
                </button>
              ))}
            </div>

            {/* Éditeur + bouton dictaphone flottant (cercle, push-to-talk) — posé en bas à droite
                de la zone de texte pour rester accessible sans gêner la lecture du commentaire. */}
            <div style={{ position:'relative' }}>
              <RichTextArea
                ref={textareaRef}
                value={form.commentaire || ''}
                syncKey={editorSyncKey}
                onChange={val => setForm(f => ({ ...f, commentaire: val }))}
                onPasteImage={handlePasteCommentImage}
                onAnnotateImage={handleAnnotateCommentImage}
                placeholder="Description détaillée — fissures, localisation précise, préconisations, réserves… (Ctrl+V pour coller une capture)"
                textAlign={form.commentaireAlign || 'left'}
                style={{ width:'100%', border:`1px solid ${recording ? DA.red : DA.border}`, borderRadius:'0 0 8px 8px', padding:'12px 14px', paddingBottom:64, fontSize:15, lineHeight:1.7, minHeight: isDesktop ? 260 : 90, boxSizing:'border-box', fontFamily:'inherit' }}
                onFocus={() => { if (textareaRef.current?.getEditor()) textareaRef.current.getEditor().style.borderColor = DA.red; }}
                onBlur={() => { if (!recording && textareaRef.current?.getEditor()) textareaRef.current.getEditor().style.borderColor = DA.border; }}
              />

              {/* Gros bouton rond push-to-talk */}
              <button
                title={recording ? 'Relâcher pour terminer' : 'Maintenir pour dicter'}
                onPointerDown={e => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch {} if (!recordingRef.current) startDictaphone(); }}
                onPointerUp={() => { if (recordingRef.current) stopDictaphone(); }}
                onPointerCancel={() => { if (recordingRef.current) stopDictaphone(); }}
                style={{ position:'absolute', bottom:12, right:12, width:56, height:56, borderRadius:'50%', border:'none', background:recording ? '#991b1b' : DA.red, color:'white', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', userSelect:'none', WebkitUserSelect:'none', touchAction:'none', transition:'background 0.15s, transform 0.1s', transform:recording?'scale(1.08)':'scale(1)', boxShadow:recording?'0 0 0 6px rgba(185,28,28,0.25), inset 0 2px 6px rgba(0,0,0,0.25)':'0 3px 10px rgba(185,28,28,0.4)' }}>
                <Ic n={recording ? 'spn' : 'mic'} s={24}/>
              </button>
            </div>

            {recording && (
              <p style={{ fontSize:11,fontStyle:'italic',margin:'4px 0 0',lineHeight:1.4,color: interimText ? DA.black : DA.grayL }}>
                {interimText ? interimText + '…' : 'En écoute — parlez maintenant…'}
              </p>
            )}

            {/* Boutons IA — Reformuler · Corriger · Générer, tous sur une seule ligne.
                flexWrap permet au volet IA (flexBasis 100%) de passer sous la rangée. */}
            <div style={{ display:'flex',gap:8,marginTop:8,flexWrap:'wrap' }}>
              {form.commentaire?.trim() && (
                <button onClick={reformulate} disabled={reformulating}
                  style={{ flex:1,minWidth:120,padding:'11px 14px',borderRadius:10,border:`1.5px solid ${DA.border}`,background:'white',color:DA.gray,display:'flex',alignItems:'center',justifyContent:'center',gap:6,fontSize:13,fontWeight:600,cursor:'pointer',opacity:reformulating?0.6:1,whiteSpace:'nowrap' }}>
                  {reformulating ? <Ic n="spn" s={13}/> : <Ic n="spk" s={13}/>}
                  {reformulating ? 'Analyse…' : 'Reformuler avec l\'IA'}
                </button>
              )}
              {form.commentaire?.trim() && (
                <button onClick={fixSpelling} disabled={correcting}
                  style={{ flex:1,minWidth:120,padding:'11px 14px',borderRadius:10,border:`1.5px solid ${DA.border}`,background:'white',color:DA.gray,display:'flex',alignItems:'center',justifyContent:'center',gap:6,fontSize:13,fontWeight:600,cursor:'pointer',opacity:correcting?0.6:1,whiteSpace:'nowrap' }}>
                  {correcting ? <Ic n="spn" s={13}/> : <Ic n="chk" s={13}/>}
                  {isDesktop ? "Corriger l'orthographe" : 'Corriger'}
                </button>
              )}
              <IASug
                inline
                content={form.titre}
                commentaire={form.commentaire}
                photos={form.photos}
                onApply={text => { setForm(f => ({ ...f, commentaire: f.commentaire ? f.commentaire + '\n' + text : text })); bumpSync(); }}
                onApplyTitle={title => setForm(f => ({ ...f, titre: title }))}
                onApplyUrgence={urgence => setForm(f => ({ ...f, urgence }))}
              />
            </div>

            {/* Volet REFORMULATION — affiché en premier (au-dessus de l'orthographe) */}
            {reformError && (
              <div style={{ marginTop:6,padding:'7px 10px',background: reformError.includes('✓') ? '#F0FDF4' : '#FEF2F2',border:`1px solid ${reformError.includes('✓') ? '#BBF7D0' : '#FECACA'}`,borderRadius:8,fontSize:12,color:reformError.includes('✓') ? '#15803D' : '#B91C1C' }}>
                {reformError}
              </div>
            )}

            {reformList && reformList.length > 0 && (
              <div style={{ marginTop:8, border:'1px solid #E5E7EB', borderRadius:10, overflow:'hidden', fontSize:12 }}>
                <div style={{ background:'#F9FAFB', padding:'8px 12px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid #E5E7EB', gap:8 }}>
                  <span style={{ fontWeight:700, color:'#374151', fontSize:11, textTransform:'uppercase', letterSpacing:0.5 }}>Reformulations proposées</span>
                  <button onClick={() => { setReformList(null); setReformApplied(new Set()); }}
                    style={{ background:'white', color:'#6B7280', border:'1px solid #D1D5DB', borderRadius:6, padding:'4px 10px', fontSize:11, fontWeight:600, cursor:'pointer' }}>
                    ✕
                  </button>
                </div>
                <div style={{ padding:'4px 0', background:'white' }}>
                  {reformList.map((seg, idx) => {
                    const done = reformApplied.has(idx);
                    return (
                      <div key={idx} style={{ padding:'10px 12px', borderTop: idx > 0 ? '1px solid #F3F4F6' : 'none', opacity: done ? 0.55 : 1 }}>
                        <div style={{ fontSize:11, color:'#9CA3AF', textDecoration: done ? 'none' : 'line-through', marginBottom:6, lineHeight:1.5 }}>
                          {seg.extrait}
                        </div>
                        {seg.propositions.filter(p => p && p.trim()).map((prop, pi) => (
                          <div key={pi} style={{ display:'flex', alignItems:'flex-start', gap:8, marginBottom:6 }}>
                            <span style={{ flex:1, fontSize:12, color:'#1F2937', lineHeight:1.5 }}>{prop}</span>
                            <button onClick={() => applyReform(idx, prop)} disabled={done}
                              style={{ flexShrink:0, background: done ? '#9CA3AF' : '#059669', color:'white', border:'none', borderRadius:6, padding:'4px 10px', fontSize:11, fontWeight:700, cursor: done ? 'default' : 'pointer' }}>
                              {done ? '✓' : 'Appliquer'}
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {spellError && (
              <div style={{ marginTop:6,padding:'7px 10px',background: spellError.includes('✓') ? '#F0FDF4' : '#FEF2F2',border:`1px solid ${spellError.includes('✓') ? '#BBF7D0' : '#FECACA'}`,borderRadius:8,fontSize:12,color:spellError.includes('✓') ? '#15803D' : '#B91C1C' }}>
                {spellError}
              </div>
            )}

            {spellDiff && (() => {
              const fixes = spellDiff.segments.filter(s => s.type === 'fix');
              const activeCount = fixes.filter(s => s.active).length;
              return (
                <div style={{ marginTop:8, border:'1px solid #E5E7EB', borderRadius:10, overflow:'hidden', fontSize:12 }}>
                  {/* Barre d'en-tête */}
                  <div style={{ background:'#F9FAFB', padding:'8px 12px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid #E5E7EB', gap:8, flexWrap:'wrap' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontWeight:700, color:'#374151', fontSize:11, textTransform:'uppercase', letterSpacing:0.5 }}>Corrections proposées</span>
                      <span style={{ fontSize:11, color:'#6B7280' }}>{activeCount}/{fixes.length} sélectionnée{activeCount !== 1 ? 's' : ''}</span>
                    </div>
                    <div style={{ display:'flex', gap:6 }}>
                      <button onClick={() => setSpellDiff(d => ({ ...d, segments: d.segments.map(s => s.type === 'fix' ? { ...s, active: true } : s) }))}
                        style={{ background:'white', color:'#374151', border:'1px solid #D1D5DB', borderRadius:6, padding:'4px 10px', fontSize:11, fontWeight:600, cursor:'pointer' }}>
                        Tout
                      </button>
                      <button onClick={() => setSpellDiff(d => ({ ...d, segments: d.segments.map(s => s.type === 'fix' ? { ...s, active: false } : s) }))}
                        style={{ background:'white', color:'#6B7280', border:'1px solid #D1D5DB', borderRadius:6, padding:'4px 10px', fontSize:11, fontWeight:600, cursor:'pointer' }}>
                        Aucune
                      </button>
                      <button onClick={() => applyDiff()}
                        disabled={activeCount === 0}
                        style={{ background: activeCount > 0 ? '#059669' : '#9CA3AF', color:'white', border:'none', borderRadius:6, padding:'4px 12px', fontSize:11, fontWeight:700, cursor: activeCount > 0 ? 'pointer' : 'default' }}>
                        ✓ Appliquer ({activeCount})
                      </button>
                      <button onClick={() => setSpellDiff(null)}
                        style={{ background:'white', color:'#6B7280', border:'1px solid #D1D5DB', borderRadius:6, padding:'4px 10px', fontSize:11, fontWeight:600, cursor:'pointer' }}>
                        ✕
                      </button>
                    </div>
                  </div>
                  {/* Légende */}
                  <div style={{ background:'#FFFBEB', padding:'5px 12px', borderBottom:'1px solid #FDE68A', fontSize:10, color:'#92400E' }}>
                    Clique sur une correction pour la sélectionner / désélectionner
                  </div>
                  {/* Texte avec corrections */}
                  <div style={{ padding:'10px 12px', lineHeight:1.9, color:'#1F2937', background:'white' }}>
                    {spellDiff.segments.map((seg, i) => {
                      if (seg.type === 'eq') return <span key={i}>{seg.text}</span>;
                      const on = seg.active;
                      return (
                        <span key={i}
                          onClick={() => toggleFix(seg.id)}
                          title={on ? 'Cliquer pour ignorer cette correction' : 'Cliquer pour accepter cette correction'}
                          style={{ cursor:'pointer', borderRadius:3, padding:'1px 2px', border: on ? '1px solid transparent' : '1px dashed #D1D5DB', background: on ? 'transparent' : '#F9FAFB', display:'inline' }}>
                          {on ? (
                            <>
                              {seg.del && <span style={{ background:'#FEE2E2', color:'#991B1B', textDecoration:'line-through', borderRadius:2, padding:'0 2px', marginRight:1 }}>{seg.del}</span>}
                              {seg.add && <span style={{ background:'#DCFCE7', color:'#166534', fontWeight:700, borderRadius:2, padding:'0 2px' }}>{seg.add}</span>}
                            </>
                          ) : (
                            <span style={{ color:'#9CA3AF', textDecoration:'line-through' }}>{seg.del || seg.add}</span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

          </div>

          {/* Photos — pleine largeur */}
          <div style={{ marginBottom:14 }}>
            <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8,gap:6,flexWrap:'wrap' }}>
              <label style={{ fontSize:12,fontWeight:600,color:DA.gray,textTransform:'uppercase',letterSpacing:0.5 }}>Photos ({form.photos.length})</label>
              <div style={{ display:'flex',gap:6,flexShrink:0 }}>
                <button onClick={() => gallRef.current.click()} style={{ fontSize:13,border:`1px solid ${DA.border}`,padding:'8px 12px',borderRadius:8,background:'white',color:DA.gray,display:'flex',alignItems:'center',gap:4,cursor:'pointer' }}>
                  <Ic n="img" s={14}/> Galerie
                </button>
                <button onClick={() => { camRef.current.value=''; camRef.current.click(); }} style={{ fontSize:13,border:`1px solid ${DA.red}`,padding:'8px 12px',borderRadius:8,background:DA.red,color:'white',display:'flex',alignItems:'center',gap:4,cursor:'pointer' }}>
                  <Ic n="cam" s={14}/> Photo
                </button>
              </div>
            </div>
            {form.photos.length > 0 ? (
              <div style={{ display:'grid',gridTemplateColumns: isDesktop ? 'repeat(5,1fr)' : 'repeat(3,1fr)',gap:8 }}>
                {form.photos.map((ph, i) => (
                  <div key={i} style={{ position:'relative',aspectRatio:'1',borderRadius:8,overflow:'hidden' }}>
                    <img
                      src={ph.annotated || ph.data} alt=""
                      title="Cliquer pour annoter — appui long pour agrandir"
                      style={{ width:'100%',height:'100%',objectFit:'cover',WebkitTouchCallout:'none',userSelect:'none',cursor:'pointer' }}
                      onContextMenu={e => e.preventDefault()}
                      onPointerDown={() => { lpFiredRef.current = false; longPressTimer.current = setTimeout(() => { lpFiredRef.current = true; setZoomPhotoIdx(i); }, 500); }}
                      onPointerUp={() => { clearTimeout(longPressTimer.current); if (!lpFiredRef.current) setAnnotatingPhotoIdx(i); }}
                      onPointerLeave={() => clearTimeout(longPressTimer.current)}
                      draggable={false}
                    />
                    {(
                      <button onClick={() => setConfirmDelPhotoIdx(i)} aria-label="Supprimer la photo"
                        style={{ position:'absolute',top:4,right:4,background:'#E30513',color:'white',border:'none',borderRadius:'50%',width:28,height:28,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer' }}>
                        <Ic n="x" s={13}/>
                      </button>
                    )}
                    {ph.annotations?.length > 0 && (
                      <div title="Annotée"
                        style={{ position:'absolute',bottom:4,right:4,background:DA.red,color:'white',borderRadius:'50%',width:18,height:18,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none' }}>
                        <Ic n="pen" s={9}/>
                      </div>
                    )}
                  </div>
                ))}
                <button onClick={() => gallRef.current.click()} style={{ aspectRatio:'1',borderRadius:8,border:`2px dashed ${DA.border}`,background:'white',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3,cursor:'pointer' }}>
                  <Ic n="img" s={15}/><span style={{ fontSize:9,color:DA.grayL }}>Galerie</span>
                </button>
                <button onClick={() => { camRef.current.value=''; camRef.current.click(); }} style={{ aspectRatio:'1',borderRadius:8,border:`2px dashed ${DA.red}`,background:DA.redL,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3,cursor:'pointer' }}>
                  <Ic n="cam" s={15}/><span style={{ fontSize:9,color:DA.red,fontWeight:700 }}>Photo</span>
                </button>
              </div>
            ) : (
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8 }}>
                <div onClick={() => gallRef.current.click()} style={{ height:80,borderRadius:10,border:`2px dashed ${DA.border}`,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,cursor:'pointer',background:DA.grayXL }}>
                  <Ic n="img" s={20}/><span style={{ fontSize:11,color:DA.grayL }}>Galerie</span>
                </div>
                <div onClick={() => { camRef.current.value=''; camRef.current.click(); }} style={{ height:80,borderRadius:10,border:`2px dashed ${DA.red}`,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,cursor:'pointer',background:DA.redL }}>
                  <Ic n="cam" s={20}/><span style={{ fontSize:11,color:DA.red }}>Prendre photo</span>
                </div>
              </div>
            )}
          </div>

          {compressing && (
            <div style={{ display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#F0FDF4',border:'1px solid #86EFAC',borderRadius:8,marginBottom:12 }}>
              <Ic n="spn" s={13}/>
              <span style={{ fontSize:12,color:'#15803D',fontWeight:600 }}>Traitement des photos…</span>
            </div>
          )}

          {/* Vignette(s) plan(s) de la zone */}
          {(() => {
            const primaryBg = planBg || (planId && planLibrary.find(p => p.id === planId)?.bg) || null;
            const allZonePlans = [];
            if (primaryBg || planAnnotations?.exported) {
              allZonePlans.push({ bg: primaryBg, annotations: planAnnotations, nom: null, isPrimary: true });
            }
            for (const ep of extraPlans) {
              const epBg = ep.planBg || (ep.planId && planLibrary.find(p => p.id === ep.planId)?.bg) || null;
              if (epBg || ep.planAnnotations?.exported) {
                allZonePlans.push({ bg: epBg, annotations: ep.planAnnotations, nom: planLibrary.find(p => p.id === ep.planId)?.nom || null, isPrimary: false });
              }
            }
            if (!allZonePlans.length && !form.plans.length) return null;
            const totalAnnot = allZonePlans.reduce((n, zp) => n + (zp.annotations?.paths?.length || 0), 0);
            return (
              <div style={{ marginBottom:14 }}>
                <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8 }}>
                  <label style={{ fontSize:12,fontWeight:600,color:DA.gray,textTransform:'uppercase',letterSpacing:0.5 }}>
                    Plan{allZonePlans.length > 1 ? `s (${allZonePlans.length})` : ''}
                    {totalAnnot > 0 && (
                      <span style={{ marginLeft:6,fontSize:10,background:DA.redL,color:DA.red,borderRadius:10,padding:'2px 7px',border:`1px solid #FECACA` }}>
                        {totalAnnot} annotation{totalAnnot > 1 ? 's' : ''}
                      </span>
                    )}
                  </label>
                  <div style={{ display:'flex', gap:6 }}>
                    {primaryBg && (
                      <button onClick={() => onOpenAnnot(form)}
                        style={{ fontSize:12,fontWeight:600,color:DA.red,background:DA.redL,border:`1px solid #FECACA`,borderRadius:8,padding:'5px 12px',cursor:'pointer',display:'flex',alignItems:'center',gap:5 }}>
                        <Ic n="pen" s={12}/> Annoter
                      </button>
                    )}
                    <button onClick={() => setShowPlanPicker(true)}
                      style={{ fontSize:11,fontWeight:600,color:DA.red,background:DA.redL,border:`1px solid #FECACA`,borderRadius:8,padding:'4px 10px',cursor:'pointer',display:'flex',alignItems:'center',gap:4 }}>
                      <Ic n="plus" s={11}/> Ajouter
                    </button>
                  </div>
                </div>
                <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
                  {allZonePlans.map((zp, zi) => (
                    <div key={zi} onClick={zp.isPrimary ? () => onOpenAnnot(form) : undefined}
                      style={{ position:'relative',borderRadius:10,overflow:'hidden',border:`1px solid ${DA.border}`,cursor:zp.isPrimary?'pointer':'default',background:'#1a1a1a' }}>
                      <img src={zp.annotations?.exported || zp.bg} alt={zp.nom || 'Plan'}
                        style={{ width:'100%',maxHeight:isDesktop?200:140,objectFit:'contain',display:'block' }}/>
                      {zp.nom && (
                        <div style={{ position:'absolute',top:0,left:0,right:0,padding:'4px 8px',background:'rgba(0,0,0,0.55)' }}>
                          <span style={{ fontSize:10,color:'white',fontWeight:600 }}>{zp.nom}</span>
                        </div>
                      )}
                      {zp.isPrimary && (
                        <div style={{ position:'absolute',bottom:0,left:0,right:0,padding:'6px 10px',background:'linear-gradient(transparent,rgba(0,0,0,0.55))',display:'flex',alignItems:'center',gap:5 }}>
                          <Ic n="pen" s={11}/><span style={{ fontSize:11,color:'white',fontWeight:600 }}>Cliquer pour annoter</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {form.plans.map((pl, idx) => {
                  const libPlan = planLibrary.find(p => p.id === pl.planId);
                  const bg = pl.planBg || libPlan?.bg || null;
                  const exported = pl.planAnnotations?.exported || bg;
                  const annotCount = pl.planAnnotations?.paths?.length || 0;
                  return (
                    <div key={pl.id} style={{ display:'flex',alignItems:'stretch',marginTop:8,border:`1px solid ${DA.border}`,borderRadius:10,overflow:'hidden',background:'white' }}>
                      <div onClick={() => setAnnotatingPlanIdx(idx)} style={{ position:'relative',width:72,height:48,background:'#1a1a1a',flexShrink:0,cursor:'pointer' }}>
                        {exported && <img src={exported} alt="" style={{ width:'100%',height:'100%',objectFit:'cover' }}/>}
                        <div style={{ position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.35)' }}>
                          <Ic n="pen" s={13}/>
                        </div>
                      </div>
                      <div style={{ flex:1,minWidth:0,padding:'6px 10px',display:'flex',flexDirection:'column',justifyContent:'center' }}>
                        <p style={{ fontSize:12,fontWeight:600,color:DA.black,margin:'0 0 2px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{libPlan?.nom || 'Plan'}</p>
                        {annotCount > 0
                          ? <span style={{ fontSize:10,color:DA.red,fontWeight:600 }}>{annotCount} annotation{annotCount > 1 ? 's' : ''}</span>
                          : <span style={{ fontSize:10,color:DA.grayL }}>Non annoté · hors rapport</span>
                        }
                      </div>
                      <button onClick={() => setForm(f => ({ ...f, plans: f.plans.filter((_,i) => i !== idx) }))}
                        style={{ padding:'0 12px',border:'none',borderLeft:`1px solid ${DA.border}`,background:'white',cursor:'pointer',color:'#B91C1C',display:'flex',alignItems:'center' }}>
                        <Ic n="del" s={14}/>
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })()}

        </div>
        {/* Sticky footer */}
        <div style={{ padding: isDesktop ? '12px 24px' : '12px 16px', borderTop:`1px solid ${DA.border}`, background:'white', flexShrink:0 }}>
          <div style={{ display:'flex',gap:8,alignItems:'stretch' }}>
            {!planBg && (
              <button onClick={() => setShowPlan(true)}
                style={{ border:`1px solid ${DA.border}`,borderRadius:10,padding:'12px 14px',fontSize:13,background:'white',color:DA.gray,display:'flex',alignItems:'center',gap:6,cursor:'pointer',flexShrink:0,whiteSpace:'nowrap' }}>
                <Ic n="map" s={15}/> Plan (vide)
              </button>
            )}
            <button onClick={handleSave} disabled={compressing}
              style={{ flex:1,background:!compressing?DA.black:'#ccc',color:'white',border:'none',borderRadius:10,padding:12,fontSize:15,fontWeight:700,cursor:!compressing?'pointer':'not-allowed' }}>
              Enregistrer l'observation
            </button>
          </div>
        </div>
      </div>

      {/* Action sheet suppression photo — couvre l'écran, boutons larges */}
      {confirmDelPhotoIdx !== null && (
        <div style={{ position:'fixed', inset:0, zIndex:200, display:'flex', flexDirection:'column', justifyContent:'flex-end' }}
          onClick={() => setConfirmDelPhotoIdx(null)}>
          <div style={{ background:'white', borderRadius:'20px 20px 0 0', padding:'20px 16px 36px', boxShadow:'0 -8px 32px rgba(0,0,0,0.18)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ width:36, height:4, background:'#DDD', borderRadius:2, margin:'0 auto 18px' }}/>
            <p style={{ textAlign:'center', fontSize:13, color:DA.gray, margin:'0 0 16px', fontWeight:600 }}>Supprimer cette photo ?</p>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <button onClick={() => { setForm(f => ({ ...f, photos: f.photos.filter((_,j) => j !== confirmDelPhotoIdx) })); setConfirmDelPhotoIdx(null); }}
                style={{ width:'100%', padding:'15px', background:'#B91C1C', color:'white', border:'none', borderRadius:12, fontSize:16, fontWeight:800, cursor:'pointer' }}>
                Supprimer
              </button>
              <button onClick={() => setConfirmDelPhotoIdx(null)}
                style={{ width:'100%', padding:'15px', background:'#F5F5F5', color:'#333', border:'none', borderRadius:12, fontSize:16, fontWeight:600, cursor:'pointer' }}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Zoom photo plein écran — appui long */}
      {zoomPhotoIdx !== null && form.photos[zoomPhotoIdx] && (() => {
        const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
        const canShareFiles = isIOS && typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
        const ph = form.photos[zoomPhotoIdx];
        return (
          <div
            style={{ position:'fixed', inset:0, zIndex:300, background:'rgba(0,0,0,0.92)', display:'flex', alignItems:'center', justifyContent:'center' }}
            onClick={() => setZoomPhotoIdx(null)}
            onContextMenu={e => e.preventDefault()}>
            <img
              src={ph.annotated || ph.data}
              alt=""
              style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain', WebkitTouchCallout:'none', userSelect:'none' }}
              draggable={false}
              onContextMenu={e => e.preventDefault()}
            />
            {/* Bouton iOS : enregistrer dans Photos via Web Share API */}
            {canShareFiles && (
              <button
                onClick={async e => {
                  e.stopPropagation();
                  try {
                    const src = ph.annotated || ph.data;
                    if (!src) return;
                    const blob = await fetch(src).then(r => r.blob());
                    const file = new File([blob], ph.name || 'photo.jpg', { type: blob.type || 'image/jpeg' });
                    if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file] });
                  } catch { /* annulé ou non supporté */ }
                }}
                style={{ position:'absolute', top:16, right:16, background:'rgba(255,255,255,0.18)', border:'none', borderRadius:10, padding:'10px 14px', color:'white', fontSize:13, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6, backdropFilter:'blur(4px)', WebkitBackdropFilter:'blur(4px)' }}>
                <Ic n="dl" s={15}/> Enregistrer
              </button>
            )}
            {/* Navigation gauche/droite */}
            {form.photos.length > 1 && (
              <>
                <button onClick={e => { e.stopPropagation(); setZoomPhotoIdx(i => (i - 1 + form.photos.length) % form.photos.length); }}
                  style={{ position:'absolute', left:8, top:'50%', transform:'translateY(-50%)', background:'rgba(255,255,255,0.15)', border:'none', borderRadius:'50%', width:44, height:44, color:'white', fontSize:22, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  ‹
                </button>
                <button onClick={e => { e.stopPropagation(); setZoomPhotoIdx(i => (i + 1) % form.photos.length); }}
                  style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', background:'rgba(255,255,255,0.15)', border:'none', borderRadius:'50%', width:44, height:44, color:'white', fontSize:22, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  ›
                </button>
                <span style={{ position:'absolute', bottom:16, left:'50%', transform:'translateX(-50%)', color:'rgba(255,255,255,0.6)', fontSize:12 }}>
                  {zoomPhotoIdx + 1} / {form.photos.length}
                </span>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}
