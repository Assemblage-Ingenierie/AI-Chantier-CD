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

// Vérifie si une valeur est déjà du HTML ou du markdown legacy
function isHtml(text) {
  return text && (
    text.includes('<strong>') || text.includes('<em>') ||
    text.includes('<u>') || text.includes('<br') ||
    text.includes('<b>') || text.includes('<i>')
  );
}

// Normalise les balises <b>/<i> (insérées par execCommand) vers <strong>/<em>
function normalizeHtmlOutput(html) {
  if (!html) return html;
  return html
    .replace(/<b>/gi, '<strong>').replace(/<\/b>/gi, '</strong>')
    .replace(/<i>/gi, '<em>').replace(/<\/i>/gi, '</em>');
}

export function normalizeToHtml(text) {
  if (!text) return '';
  return isHtml(text) ? text : mdToHtml(text);
}

// Extraire le texte brut sans balises (pour PDF, IA, etc.)
export function htmlToPlain(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '');
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

  // Empêcher les collages avec mise en forme complexe
  const handlePaste = (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
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
