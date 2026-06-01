import React, { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';

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
  return /<\/?(strong|em|u|br|b|i|div|p|s|ul|ol|li|strike|span)\b/i.test(text);
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

const RichTextArea = forwardRef(function RichTextArea(
  { value, onChange, placeholder, style, onFocus, onBlur, textAlign = 'left', syncKey },
  ref
) {
  const editorRef = useRef(null);
  const isComposing = useRef(false); // IME (Chinese, Japanese…)
  const isTyping = useRef(false); // true seulement pendant la frappe active (pas simple focus)

  // Expose focus() to parent via ref
  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    getEditor: () => editorRef.current,
    resetTyping: () => { isTyping.current = false; },
  }));

  // Init: convertir markdown → HTML une seule fois au montage
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = normalizeToHtml(value);
    if (el.innerHTML !== html) el.innerHTML = html;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Si value change depuis l'extérieur (IA, dictaphone, changement de visite) → resynchroniser
  // syncKey incrémenté par le parent force la sync même si l'éditeur est en cours de frappe
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (isTyping.current && !syncKey) return;
    const html = normalizeToHtml(value);
    if (el.innerHTML !== html) { el.innerHTML = html; if (syncKey) el.blur(); }
  }, [value, syncKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInput = () => {
    if (isComposing.current) return;
    const el = editorRef.current;
    isTyping.current = true;
    if (el) onChange(normalizeHtmlOutput(el.innerHTML));
  };

  // Coller : nettoyer les attributs dangereux, garder la mise en forme simple
  const handlePaste = (e) => {
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

  // Ctrl+B/I/U → execCommand (natif, WYSIWYG)
  const handleKeyDown = (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    if (e.key === 'b' || e.key === 'B') { e.preventDefault(); document.execCommand('bold'); }
    else if (e.key === 'i' || e.key === 'I') { e.preventDefault(); document.execCommand('italic'); }
    else if (e.key === 'u' || e.key === 'U') { e.preventDefault(); document.execCommand('underline'); }
  };

  const isEmpty = !value || value === '<br>' || value === '';

  return (
    <div style={{ position: 'relative' }}>
      {isEmpty && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, padding: style?.padding ?? '12px 14px',
          fontSize: style?.fontSize ?? 15, color: '#aaa', pointerEvents: 'none',
          lineHeight: style?.lineHeight ?? 1.7, userSelect: 'none',
        }}>
          {placeholder}
        </div>
      )}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
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
