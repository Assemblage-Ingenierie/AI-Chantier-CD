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
// cursor:grab → indique qu'on peut la glisser pour la déplacer dans le texte.
function applyCommentImgStyle(img) {
  const w = parseFloat(img.getAttribute('data-w')) || 60;
  const align = img.getAttribute('data-align') || 'center';
  const margin = align === 'left' ? '8px auto 8px 0' : align === 'right' ? '8px 0 8px auto' : '8px auto';
  img.style.cssText = `width:${Math.max(15, Math.min(100, w))}%;max-width:100%;height:auto;display:block;margin:${margin};border-radius:4px;cursor:grab;`;
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

  // Expose focus() to parent via ref
  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    getEditor: () => editorRef.current,
    resetTyping: () => { isTyping.current = false; },
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

  // Init: convertir markdown → HTML une seule fois au montage
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = normalizeToHtml(value);
    if (el.innerHTML !== html) el.innerHTML = html;
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
    if (el.innerHTML !== html) { el.innerHTML = html; setSelImg(null); if (forced) el.blur(); }
  }, [value, syncKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInput = () => {
    if (isComposing.current) return;
    const el = editorRef.current;
    isTyping.current = true;
    if (el) onChange(normalizeHtmlOutput(el.innerHTML));
  };

  // Insère une <img> collée à la position du curseur (ou en fin si pas de sélection).
  const insertCommentImage = (url, path, savedRange) => {
    const el = editorRef.current;
    if (!el) return;
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
  };

  // Coller : image (capture d'écran) → upload bucket + insertion ; sinon mise en forme simple.
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
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const res = await onPasteImage(reader.result);
          if (res?.url && res?.path) insertCommentImage(res.url, res.path, savedRange);
        } catch { /* upload KO : on n'insère rien */ }
      };
      reader.readAsDataURL(file);
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
    if (e.target?.tagName === 'IMG' && e.target.getAttribute('data-cimg') != null) {
      setSelImg(e.target);
      setSelImgW(parseFloat(e.target.getAttribute('data-w')) || 60);
      refreshImgBox(e.target);
    } else if (selImg) {
      setSelImg(null);
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
  const deleteImg = () => { if (!selImg) return; const next = selImg.nextSibling; if (next && next.tagName === 'BR') next.remove(); selImg.remove(); setSelImg(null); handleInput(); };
  const annotateImg = () => { if (!selImg || !onAnnotateImage) return; const p = selImg.getAttribute('data-cimg'); setSelImg(null); onAnnotateImage(p); };

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
    if (!img) return; // glissé de texte → laisser le comportement natif
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
          display:'flex', alignItems:'center', gap:8, background:'#1f1f1f', color:'#fff',
          borderRadius:6, padding:'5px 9px', boxShadow:'0 2px 10px rgba(0,0,0,0.35)', fontSize:11, whiteSpace:'nowrap' }}>
          {/* Taille — curseur fin (pas de 1 %), valeur affichée, persisté au relâché */}
          <span style={{ opacity:0.65, fontWeight:600 }}>Taille</span>
          <input type="range" min="15" max="100" step="1" value={selImgW}
            onChange={e => resizeLive(parseFloat(e.target.value))}
            onPointerUp={resizeCommit} onMouseUp={resizeCommit} onKeyUp={resizeCommit}
            style={{ width:130, accentColor:'#E30513', cursor:'pointer' }}/>
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
      )}
      <div
        ref={editorRef}
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
          if (editorRef.current) onChange(normalizeHtmlOutput(editorRef.current.innerHTML));
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
