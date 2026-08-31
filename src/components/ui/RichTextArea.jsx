import React, { useRef, useState, useEffect, useImperativeHandle, forwardRef } from 'react';

// Convertit l'ancien format markdown (** __ *) en HTML pour l'éditeur
function mdToHtml(text) {
  if (!text) return '';
  // Escape HTML characters first, then convert markdown
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<u>$1</u>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

// Vérifie si une valeur est déjà du HTML ou du markdown legacy (insensible à la casse)
function isHtml(text) {
  if (!text) return false;
  if (/&(amp|lt|gt|nbsp|quot);/i.test(text)) return true;
  return /<\/?(strong|em|u|br|b|i|div|p|s|ul|ol|li|strike|span|img)\b/i.test(text);
}

// Répare un texte où des balises ont été échappées une ou plusieurs fois
// (ex: "&lt;div&gt;" ou "&amp;lt;div&amp;gt;" affichés comme texte littéral).
// Décode les entités jusqu'à retrouver le vrai HTML, sans toucher aux "<" légitimes
// (ex: "section < 5mm" → le "&lt;" suivi d'un espace n'est pas une balise).
function unescapeStrayTags(text) {
  if (!text) return text;
  let out = text;
  for (let i = 0; i < 4; i++) {
    if (!/&(amp;)*lt;\/?(div|p|br|strong|em|u|s|b|i|ul|ol|li|span|strike)\b/i.test(out)) break;
    const tmp = document.createElement('textarea');
    tmp.innerHTML = out;
    const decoded = tmp.value;
    if (decoded === out) break;
    out = decoded;
  }
  return out;
}

// Normalise les balises <b>/<i>/<strike> vers <strong>/<em>/<s>
function normalizeHtmlOutput(html) {
  if (!html) return html;
  return html
    .replace(/<b>/gi, '<strong>').replace(/<\/b>/gi, '</strong>')
    .replace(/<i>/gi, '<em>').replace(/<\/i>/gi, '</em>')
    .replace(/<strike>/gi, '<s>').replace(/<\/strike>/gi, '</s>')
    .replace(/<del>/gi, '<s>').replace(/<\/del>/gi, '</s>');
}

// Nettoie le HTML collé : garde uniquement les balises supportées, strip tous les attributs
function cleanPastedHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  function processNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    const inner = Array.from(node.childNodes).map(processNode).join('');
    if (tag === 'strong' || tag === 'b') return `<strong>${inner}</strong>`;
    if (tag === 'em' || tag === 'i') return `<em>${inner}</em>`;
    if (tag === 'u') return `<u>${inner}</u>`;
    if (tag === 's' || tag === 'strike' || tag === 'del') return `<s>${inner}</s>`;
    if (tag === 'br') return '<br>';
    if (tag === 'li') return `<li>${inner}</li>`;
    if (tag === 'ul' || tag === 'ol') return `<ul>${inner}</ul>`;
    if (['p','div','h1','h2','h3','h4','h5','h6','blockquote'].includes(tag)) return `<div>${inner}</div>`;
    return inner; // span et autres : contenu brut
  }
  return Array.from(tmp.childNodes).map(processNode).join('');
}

export function normalizeToHtml(text) {
  if (!text) return '';
  const repaired = unescapeStrayTags(text);
  return isHtml(repaired) ? repaired : mdToHtml(repaired);
}

// Extraire le texte brut sans balises (pour PDF, IA, etc.)
export function htmlToPlain(html) {
  if (!html) return '';
  const stripped = unescapeStrayTags(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/li>/gi, '\n')          // chaque puce sur sa propre ligne (sinon « AB » collé)
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n');
  // Décoder les entités HTML résiduelles (&amp; → &, &lt; → <, etc.)
  const tmp = document.createElement('textarea');
  tmp.innerHTML = stripped;
  return tmp.value;
}

// Applique le style d'affichage d'une image collée à partir de ses attributs data-w / data-align.
// Image en BLOC sur sa propre ligne (comme le rendu rapport), alignée à gauche/centre/droite.
// cursor:pointer + infobulle → indique qu'on peut CLIQUER dessus pour redimensionner/légender/
// supprimer (retour Thomas : « je ne savais pas qu'il fallait sélectionner l'image »).
function applyCommentImgStyle(img) {
  const w = parseFloat(img.getAttribute('data-w')) || 60;
  const align = img.getAttribute('data-align') || 'center';
  const margin = align === 'left' ? '8px auto 8px 0' : align === 'right' ? '8px 0 8px auto' : '8px auto';
  const uploading = img.getAttribute('data-uploading') === '1';
  img.style.cssText = `width:${Math.max(15, Math.min(100, w))}%;max-width:100%;height:auto;display:block;margin:${margin};border-radius:4px;cursor:pointer;outline:1px dashed rgba(227,5,19,0.5);outline-offset:2px;${uploading ? 'opacity:0.55;' : ''}`;
  img.title = 'Cliquer pour redimensionner, légender ou supprimer — glisser pour déplacer';
}

// Garantit qu'une image DANS l'éditeur est « gérée » : largeur bornée à la page + cliquable
// (sélection → redimensionner / légender / supprimer). Filet de sécurité pour les images
// arrivées SANS passer par le collage géré — glisser-déposer d'un fichier externe ou collage
// natif du navigateur : sans data-cimg ni style, elles s'affichaient en pleine résolution →
// débordaient du cadre ET le clic restait sans effet (bug remonté par GAB). Renvoie true si
// l'image a dû être (ré)initialisée.
function ensureImgManaged(img) {
  if (!img || img.tagName !== 'IMG') return false;
  let changed = false;
  if (img.getAttribute('data-cimg') == null) { img.setAttribute('data-cimg', ''); changed = true; }
  if (img.getAttribute('data-w') == null)     { img.setAttribute('data-w', '60'); changed = true; }
  if (img.getAttribute('data-align') == null) { img.setAttribute('data-align', 'center'); changed = true; }
  applyCommentImgStyle(img); // borne la largeur (max 100 %) + curseur + contour, quoi qu'il arrive
  return changed;
}

// Position d'insertion (caret) sous le point de drop — compatible Chrome/Firefox.
function caretRangeFromPoint(x, y) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p) { const r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); return r; }
  }
  return null;
}

const RichTextArea = forwardRef(function RichTextArea(
  { value, onChange, placeholder, style, onFocus, onBlur, textAlign = 'left', syncKey, onPasteImage, onAnnotateImage },
  ref
) {
  const editorRef = useRef(null);
  const wrapperRef = useRef(null);
  const draggedImgRef = useRef(null); // image collée en cours de glisser-déposer
  const isComposing = useRef(false); // IME (Chinese, Japanese…)
  const isTyping = useRef(false); // true seulement pendant la frappe active (pas simple focus)
  const lastSyncKey = useRef(syncKey); // dernière valeur de syncKey traitée (détection de CHANGEMENT)
  const [selImg, setSelImg] = useState(null);   // <img> collée sélectionnée (barre flottante)
  const [imgBox, setImgBox] = useState(null);   // position de la barre flottante {top,left,width}
  const [selImgW, setSelImgW] = useState(60);   // largeur % live de l'image sélectionnée (curseur fluide)
  const [selImgCap, setSelImgCap] = useState(''); // légende (data-cap) de l'image sélectionnée
  const [selGrid, setSelGrid] = useState(null);   // tableau (data-grid) sélectionné → barre redimensionnement
  const [gridBox, setGridBox] = useState(null);   // position de la barre du tableau {top,left}
  const [selGridW, setSelGridW] = useState(100);  // largeur % live du tableau

  // Expose focus() to parent via ref
  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    getEditor: () => editorRef.current,
    resetTyping: () => { isTyping.current = false; },
    // Insère du HTML à la position du curseur (ou en fin si pas de sélection dans l'éditeur).
    // Utilisé pour insérer un « tableau » (rangée de cases côte à côte) depuis la barre d'outils.
    insertHtml: (html) => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      const sel = window.getSelection();
      let range = (sel && sel.rangeCount && el.contains(sel.anchorNode)) ? sel.getRangeAt(0) : null;
      if (!range) { range = document.createRange(); range.selectNodeContents(el); range.collapse(false); }
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const frag = document.createDocumentFragment();
      let node; while ((node = tmp.firstChild)) frag.appendChild(node);
      const last = frag.lastChild;
      range.deleteContents();
      range.insertNode(frag);
      if (last) { range.setStartAfter(last); range.collapse(true); }
      sel.removeAllRanges(); sel.addRange(range);
      handleInput();
    },
  }));

  // Position de la barre d'outils image, relative au conteneur (position:relative).
  const refreshImgBox = (img) => {
    if (!img || !wrapperRef.current) return;
    const wr = wrapperRef.current.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    setImgBox({ top: Math.max(0, ir.top - wr.top - 34), left: ir.left - wr.left });
  };

  // Désélection de l'image quand on clique en dehors de l'éditeur ET de la barre.
  useEffect(() => {
    if (!selImg) return;
    const onDocDown = (e) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setSelImg(null); };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [selImg]);

  // Barre de redimensionnement d'un tableau : position + désélection au clic extérieur.
  const refreshGridBox = (grid) => {
    if (!grid || !wrapperRef.current) return;
    const wr = wrapperRef.current.getBoundingClientRect();
    const gr = grid.getBoundingClientRect();
    setGridBox({ top: Math.max(0, gr.top - wr.top - 34), left: gr.left - wr.left });
  };
  useEffect(() => {
    if (!selGrid) return;
    const onDocDown = (e) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setSelGrid(null); };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [selGrid]);
  // Redimensionnement FLUIDE : on ne touche que le DOM du tableau pendant le glissé du curseur,
  // on persiste une seule fois au relâché (comme le redimensionnement d'image).
  const resizeGridLive = (w) => {
    setSelGridW(w);
    if (selGrid) { selGrid.style.width = `${w}%`; selGrid.setAttribute('data-w', String(w)); }
  };
  const resizeGridCommit = () => { if (selGrid) handleInput(); };
  const deleteGrid = () => { if (!selGrid) return; selGrid.remove(); setSelGrid(null); handleInput(); };

  // Alignement : appliqué IMPÉRATIVEMENT sur le contentEditable (le style React seul ne
  // suffisait pas selon le contenu déjà saisi → les boutons gauche/centre/droite/justifier
  // « ne marchaient pas »). On le pose sur le conteneur ET sur chaque bloc enfant.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const ta = textAlign || 'left';
    el.style.textAlign = ta;
    el.querySelectorAll('div,p,li,h1,h2,h3,h4,h5,h6').forEach(b => { if (b.getAttribute('data-cap-view') == null) b.style.textAlign = ta; });
  }, [textAlign, value, syncKey]);

  // ── Légende affichée SOUS l'image DANS l'éditeur (retour Thomas). Nœud d'AFFICHAGE seul
  //    (contenteditable=false, data-cap-view) synchronisé depuis data-cap ; RETIRÉ à la
  //    sérialisation → le stockage ne garde QUE data-cap sur l'<img> (aucun doublon). ─────────
  const CAP_VIEW_ATTR = 'data-cap-view';
  const syncCaptionView = (img) => {
    if (!img) return;
    const cap = (img.getAttribute('data-cap') || '').trim();
    const sib = img.nextElementSibling;
    let view = (sib && sib.getAttribute && sib.getAttribute(CAP_VIEW_ATTR) != null) ? sib : null;
    if (cap) {
      if (!view) { view = document.createElement('div'); view.setAttribute(CAP_VIEW_ATTR, '1'); view.setAttribute('contenteditable', 'false'); img.after(view); }
      view.textContent = cap;
      view.style.cssText = 'font-size:12px;font-style:italic;color:#6B7280;text-align:center;margin:-2px 0 6px;user-select:none;';
    } else if (view) { view.remove(); }
  };
  const rebuildCaptionViews = (el) => {
    if (!el) return;
    el.querySelectorAll(`[${CAP_VIEW_ATTR}]`).forEach(n => n.remove());
    el.querySelectorAll('img[data-cimg]').forEach(img => syncCaptionView(img));
  };
  // innerHTML SANS les nœuds d'affichage de légende → base de sérialisation ET de comparaison.
  const strippedHtml = (el) => {
    const clone = el.cloneNode(true);
    clone.querySelectorAll(`[${CAP_VIEW_ATTR}]`).forEach(n => n.remove());
    return clone.innerHTML;
  };
  // Reprend en main toute image « sauvage » (sans data-cimg) : bornée + cliquable. Filet pour
  // les images déposées/collées hors de notre flux géré (bug GAB : débordement + clic inopérant).
  const normalizeStrayImages = (el) => {
    if (!el) return;
    el.querySelectorAll('img:not([data-cimg])').forEach(ensureImgManaged);
  };

  // Init: convertir markdown → HTML une seule fois au montage
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = normalizeToHtml(value);
    if (el.innerHTML !== html) el.innerHTML = html;
    normalizeStrayImages(el); // borne + rend cliquable toute image sauvage déjà enregistrée
    rebuildCaptionViews(el); // affiche les légendes sous les images (data-cap)
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Si value change depuis l'extérieur (IA, dictaphone, changement de visite) → resynchroniser.
  // La sync n'est FORCÉE que lorsque syncKey CHANGE réellement (événement IA/dictée), pas tant
  // qu'il est non nul. Sinon, après une seule dictée/correction (syncKey passé à ≥1), la garde
  // anti-écrasement pendant la frappe restait désactivée À VIE → l'éditeur réécrivait son
  // contenu et blurait à chaque frappe → le texte « resettait à chaque fois ».
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const forced = syncKey !== lastSyncKey.current;
    lastSyncKey.current = syncKey;
    if (isTyping.current && !forced) return; // frappe en cours, pas d'événement externe → ne pas toucher
    const html = normalizeToHtml(value);
    if (strippedHtml(el) !== html) { el.innerHTML = html; setSelImg(null); setSelGrid(null); normalizeStrayImages(el); rebuildCaptionViews(el); if (forced) el.blur(); }
  }, [value, syncKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInput = () => {
    if (isComposing.current) return;
    const el = editorRef.current;
    isTyping.current = true;
    if (el) { normalizeStrayImages(el); onChange(normalizeHtmlOutput(strippedHtml(el))); }
  };

  // Insère une <img> collée à la position du curseur (ou en fin si pas de sélection).
  const insertCommentImage = (url, path, savedRange) => {
    const el = editorRef.current;
    if (!el) return null;
    const img = document.createElement('img');
    img.src = url;
    img.setAttribute('data-cimg', path);
    img.setAttribute('data-w', '60');
    img.setAttribute('data-align', 'center');
    applyCommentImgStyle(img);
    el.focus();
    let range = savedRange;
    const sel = window.getSelection();
    if (!range || !el.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false); // fin du contenu
    }
    range.insertNode(img);
    // Saut de ligne après l'image + curseur après, pour continuer à écrire dessous.
    const br = document.createElement('br');
    img.after(br);
    range.setStartAfter(br); range.collapse(true);
    sel.removeAllRanges(); sel.addRange(range);
    handleInput();
    return img;
  };

  // Insère un FICHIER image (collage OU glisser-déposer externe) : AFFICHAGE INSTANTANÉ de
  // l'aperçu local (data URL), puis remplacement en arrière-plan par l'URL du bucket quand
  // l'upload répond (retour Thomas : « l'image met du temps à apparaître »). Repli : upload KO
  // → on retire l'aperçu. La largeur est bornée dès l'insertion (jamais de débordement).
  const insertImageFromFile = (file, savedRange) => {
    if (!file || !onPasteImage) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const localUrl = reader.result;
      const tempPath = `__pending_${Date.now().toString(36)}_${Math.round(Math.random() * 1e9).toString(36)}`;
      const img = insertCommentImage(localUrl, tempPath, savedRange); // aperçu immédiat
      if (img) { img.setAttribute('data-uploading', '1'); applyCommentImgStyle(img); }
      try {
        const res = await onPasteImage(localUrl);
        if (!img || !img.isConnected) return; // image retirée entre-temps
        if (res?.url && res?.path) {
          img.setAttribute('src', res.url);        // remplace l'aperçu local par l'URL bucket (léger)
          img.setAttribute('data-cimg', res.path);
          img.removeAttribute('data-uploading');
          applyCommentImgStyle(img);
          handleInput();
        } else { img.remove(); handleInput(); }     // upload KO → on retire l'aperçu
      } catch { if (img && img.isConnected) { img.remove(); handleInput(); } }
    };
    reader.readAsDataURL(file);
  };

  // Coller : image (capture d'écran).
  const handlePaste = (e) => {
    const items = e.clipboardData?.items ? Array.from(e.clipboardData.items) : [];
    const imgItem = items.find(it => it.kind === 'file' && it.type.startsWith('image/'));
    if (imgItem && onPasteImage) {
      e.preventDefault();
      const file = imgItem.getAsFile();
      if (!file) return;
      // Mémoriser la position du curseur AVANT l'upload (async).
      const sel = window.getSelection();
      const savedRange = sel && sel.rangeCount && editorRef.current?.contains(sel.anchorNode)
        ? sel.getRangeAt(0).cloneRange() : null;
      insertImageFromFile(file, savedRange);
      return;
    }
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    if (html) {
      document.execCommand('insertHTML', false, cleanPastedHtml(html));
    } else {
      // Texte brut : strip les éventuelles balises HTML littérales
      const text = e.clipboardData.getData('text/plain').replace(/<[^>]*>/g, '');
      document.execCommand('insertText', false, text);
    }
  };

  // Sélection d'une image collée au clic → barre flottante (redimensionner / aligner / annoter / supprimer).
  const handleEditorClick = (e) => {
    if (e.target?.tagName === 'IMG') {
      // Toute image de l'éditeur est sélectionnable — y compris une image « sauvage » pas encore
      // reprise en main (déposée à l'instant) : on la borne + on la rend gérée AVANT de la
      // sélectionner, pour qu'elle soit toujours redimensionnable/supprimable (bug GAB).
      if (ensureImgManaged(e.target)) handleInput();
      setSelImg(e.target);
      setSelImgW(parseFloat(e.target.getAttribute('data-w')) || 60);
      setSelImgCap(e.target.getAttribute('data-cap') || '');
      refreshImgBox(e.target);
      setSelGrid(null);
    } else if (selImg) {
      setSelImg(null);
    }
    // Sélection d'un tableau (data-grid) au clic → barre de redimensionnement (n'empêche pas
    // d'écrire dans les cases). Une image dans une case reste prioritaire (gérée au-dessus).
    if (e.target?.tagName !== 'IMG') {
      const grid = e.target?.closest?.('[data-grid]');
      if (grid && wrapperRef.current?.contains(grid)) {
        setSelGrid(grid);
        setSelGridW(parseFloat(grid.getAttribute('data-w')) || 100);
        refreshGridBox(grid);
      } else if (selGrid) {
        setSelGrid(null);
      }
    }
  };

  // Redimensionnement FLUIDE : pendant le glissé du curseur on ne met à jour QUE le DOM de
  // l'image (pas de re-render parent → pas de saccade). On persiste une seule fois au relâché.
  // L'annotation éventuelle est cuite DANS l'image → elle reste toujours proportionnelle.
  const resizeLive = (w) => {
    setSelImgW(w);
    // NE PAS repositionner la barre pendant le redimensionnement : l'image étant centrée, son
    // bord bouge quand la largeur change → la barre « sautait ». On la laisse fixe (position
    // calculée à la sélection).
    if (selImg) { selImg.setAttribute('data-w', String(w)); applyCommentImgStyle(selImg); }
  };
  const resizeCommit = () => { if (selImg) handleInput(); };
  const deleteImg = () => {
    if (!selImg) return;
    const sib = selImg.nextElementSibling;
    const view = (sib && sib.getAttribute && sib.getAttribute(CAP_VIEW_ATTR) != null) ? sib : null; // légende affichée
    const brAfter = view ? view.nextSibling : selImg.nextSibling;
    if (view) view.remove();
    if (brAfter && brAfter.tagName === 'BR') brAfter.remove();
    selImg.remove(); setSelImg(null); handleInput();
  };
  const annotateImg = () => { if (!selImg || !onAnnotateImage) return; const p = selImg.getAttribute('data-cimg'); setSelImg(null); onAnnotateImage(p); };
  // Légende de l'image (data-cap) : stockée sur l'<img>, rendue sous l'image dans l'aperçu.
  const setCaption = (v) => {
    setSelImgCap(v);
    if (!selImg) return;
    if (v && v.trim()) selImg.setAttribute('data-cap', v);
    else selImg.removeAttribute('data-cap');
    syncCaptionView(selImg); // met à jour la légende sous l'image EN DIRECT dans l'éditeur
    handleInput();
  };

  // Glisser-déposer pour DÉPLACER une image collée dans le texte. On n'intercepte QUE le drag
  // d'une de nos images (data-cimg) ; le glissé de texte natif de contentEditable reste intact.
  const handleDragStart = (e) => {
    if (e.target?.tagName === 'IMG' && e.target.getAttribute('data-cimg') != null) {
      draggedImgRef.current = e.target;
      try { e.dataTransfer.setData('text/plain', ''); e.dataTransfer.effectAllowed = 'move'; } catch { /* noop */ }
      setSelImg(null); // masque la barre pendant le déplacement
    } else {
      draggedImgRef.current = null; // glissé de texte → laisser le navigateur gérer
    }
  };
  const handleDragOver = (e) => {
    if (draggedImgRef.current) { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch { /* noop */ } }
  };
  const handleDrop = (e) => {
    const img = draggedImgRef.current;
    if (!img) {
      // Glisser-déposer d'un FICHIER image externe : le navigateur insérerait sinon une image
      // brute (pleine résolution, non gérée) qui déborde et reste non cliquable (bug GAB). On
      // route par notre flux → largeur bornée + upload bucket + sélectionnable.
      const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')) : [];
      if (files.length && onPasteImage) {
        e.preventDefault();
        const el = editorRef.current;
        let savedRange = caretRangeFromPoint(e.clientX, e.clientY);
        if (!el || !savedRange || !el.contains(savedRange.startContainer)) savedRange = null;
        files.forEach(f => insertImageFromFile(f, savedRange ? savedRange.cloneRange() : null));
      }
      return; // sinon (glissé de texte) → laisser le comportement natif
    }
    e.preventDefault();
    draggedImgRef.current = null;
    const el = editorRef.current;
    const range = caretRangeFromPoint(e.clientX, e.clientY);
    if (!el || !range || !el.contains(range.startContainer)) return;
    const br = (img.nextSibling && img.nextSibling.tagName === 'BR') ? img.nextSibling : null;
    range.insertNode(img);          // un nœud déjà dans le DOM est DÉPLACÉ par insertNode
    if (br) img.after(br);
    else if (!(img.nextSibling && img.nextSibling.tagName === 'BR')) img.after(document.createElement('br'));
    setSelImg(null);
    rebuildCaptionViews(el); // la légende suit l'image déplacée (retire l'orpheline, recrée au bon endroit)
    handleInput();
  };

  // Ctrl+B/I/U → execCommand (natif, WYSIWYG)
  const handleKeyDown = (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    if (e.key === 'b' || e.key === 'B') { e.preventDefault(); document.execCommand('bold'); }
    else if (e.key === 'i' || e.key === 'I') { e.preventDefault(); document.execCommand('italic'); }
    else if (e.key === 'u' || e.key === 'U') { e.preventDefault(); document.execCommand('underline'); }
  };

  const isEmpty = !value || value === '<br>' || value === '';

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      {/* Placeholder des cases de tableau vides (« insérer un tableau ») — CSS ::before, non éditable.
          + Garde-fou LARGEUR : aucune image de l'éditeur ne peut déborder du cadre, quelle que soit
          la façon dont elle a été insérée (collage natif, glisser-déposer externe) — bug GAB. */}
      <style>{`[data-cell]:empty::before{content:'Coller une image ou écrire ici';color:#b8c0cc;font-size:12px;font-style:italic;}
.rte-ce img{max-width:100%!important;height:auto!important;}`}</style>
      {isEmpty && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, padding: style?.padding ?? '12px 14px',
          fontSize: style?.fontSize ?? 15, color: '#aaa', pointerEvents: 'none',
          lineHeight: style?.lineHeight ?? 1.7, userSelect: 'none',
        }}>
          {placeholder}
        </div>
      )}
      {/* Barre flottante d'une image collée sélectionnée */}
      {selImg && imgBox && (
        <div style={{ position:'absolute', top:imgBox.top, left:imgBox.left, zIndex:30,
          display:'flex', flexDirection:'column', gap:6, background:'#1f1f1f', color:'#fff',
          borderRadius:6, padding:'6px 9px', boxShadow:'0 2px 10px rgba(0,0,0,0.35)', fontSize:11, maxWidth:'min(320px, 90vw)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, whiteSpace:'nowrap' }}>
            {/* Taille — curseur fin (pas de 1 %), valeur affichée, persisté au relâché */}
            <span style={{ opacity:0.65, fontWeight:600 }}>Taille</span>
            <input type="range" min="15" max="100" step="1" value={selImgW}
              onChange={e => resizeLive(parseFloat(e.target.value))}
              onPointerUp={resizeCommit} onMouseUp={resizeCommit} onKeyUp={resizeCommit}
              style={{ width:110, accentColor:'#E30513', cursor:'pointer' }}/>
            <span style={{ width:32, textAlign:'right', fontWeight:700, fontVariantNumeric:'tabular-nums' }}>{Math.round(selImgW)}%</span>
            <span style={{ width:1, height:18, background:'#444' }}/>
            {onAnnotateImage && (
              <button title="Annoter l'image" onClick={annotateImg}
                style={{ background:'transparent', color:'#fff', border:'1px solid #555', borderRadius:4, padding:'3px 8px', cursor:'pointer', fontSize:11, fontWeight:700 }}>
                ✎ Annoter
              </button>
            )}
            <button title="Supprimer l'image" onClick={deleteImg}
              style={{ background:'transparent', color:'#ff8a8a', border:'1px solid #555', borderRadius:4, padding:'3px 8px', cursor:'pointer', fontSize:13 }}>
              🗑
            </button>
          </div>
          {/* Légende sous l'image (visible dans l'aperçu du rapport) */}
          <input type="text" value={selImgCap} onChange={e => setCaption(e.target.value)}
            placeholder="Légende de l'image (optionnel)…" maxLength={200}
            style={{ width:'100%', boxSizing:'border-box', background:'#2a2a2a', color:'#fff',
              border:'1px solid #555', borderRadius:4, padding:'4px 7px', fontSize:11, outline:'none' }}/>
        </div>
      )}
      {/* Barre flottante d'un tableau sélectionné : largeur + suppression (demande Thomas). */}
      {selGrid && gridBox && (
        <div style={{ position:'absolute', top:gridBox.top, left:gridBox.left, zIndex:30,
          display:'flex', alignItems:'center', gap:8, whiteSpace:'nowrap', background:'#1f1f1f', color:'#fff',
          borderRadius:6, padding:'6px 9px', boxShadow:'0 2px 10px rgba(0,0,0,0.35)', fontSize:11, maxWidth:'min(320px, 90vw)' }}>
          <span style={{ opacity:0.65, fontWeight:600 }}>Tableau</span>
          <input type="range" min="30" max="100" step="1" value={selGridW}
            onChange={e => resizeGridLive(parseFloat(e.target.value))}
            onPointerUp={resizeGridCommit} onMouseUp={resizeGridCommit} onKeyUp={resizeGridCommit}
            style={{ width:110, accentColor:'#E30513', cursor:'pointer' }}/>
          <span style={{ width:32, textAlign:'right', fontWeight:700, fontVariantNumeric:'tabular-nums' }}>{Math.round(selGridW)}%</span>
          <span style={{ width:1, height:18, background:'#444' }}/>
          <button title="Supprimer le tableau" onMouseDown={e => { e.preventDefault(); deleteGrid(); }}
            style={{ background:'transparent', color:'#ff8a8a', border:'1px solid #555', borderRadius:4, padding:'3px 8px', cursor:'pointer', fontSize:13 }}>
            🗑
          </button>
        </div>
      )}
      <div
        ref={editorRef}
        className="rte-ce"
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onPaste={handlePaste}
        onClick={handleEditorClick}
        onKeyDown={handleKeyDown}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onCompositionStart={() => { isComposing.current = true; }}
        onCompositionEnd={() => { isComposing.current = false; handleInput(); }}
        onFocus={onFocus}
        onBlur={e => {
          isTyping.current = false;
          if (editorRef.current) onChange(normalizeHtmlOutput(strippedHtml(editorRef.current)));
          onBlur?.(e);
        }}
        style={{
          ...style,
          textAlign,
          outline: 'none',
          minHeight: style?.minHeight ?? 90,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      />
    </div>
  );
});

export default RichTextArea;
