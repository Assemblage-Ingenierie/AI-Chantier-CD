import React from 'react';

// Détecte si le contenu est du HTML (nouveau format) ou du markdown (legacy)
function isHtml(text) {
  return text && (
    text.includes('<strong>') || text.includes('<em>') ||
    text.includes('<u>') || text.includes('<br')
  );
}

// Rendu React depuis HTML simple (strong/em/u/br) — pas de dangerouslySetInnerHTML
function renderHtml(html) {
  if (!html) return null;
  // Parser les balises inline qu'on génère (strong, em, u, br)
  const HTAG = /(<strong>|<\/strong>|<em>|<\/em>|<u>|<\/u>|<br\s*\/?>)/gi;
  const parts = html.split(HTAG);
  const result = [];
  const stack = []; // balises ouvertes

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    const lower = p.toLowerCase().replace(/\s*\/\s*>$/, '>');
    if (lower === '<strong>') { stack.push('strong'); continue; }
    if (lower === '</strong>') { stack.pop(); continue; }
    if (lower === '<em>') { stack.push('em'); continue; }
    if (lower === '</em>') { stack.pop(); continue; }
    if (lower === '<u>') { stack.push('u'); continue; }
    if (lower === '</u>') { stack.pop(); continue; }
    if (lower === '<br>' || lower === '<br/>') {
      result.push(<br key={`br-${i}`}/>);
      continue;
    }
    // Texte brut — appliquer les balises ouvertes
    const lines = p.split('\n');
    lines.forEach((line, li) => {
      if (li > 0) result.push(<br key={`nl-${i}-${li}`}/>);
      if (!line) return;
      let node = line;
      // Appliquer stack de haut en bas (innermost first)
      for (let s = stack.length - 1; s >= 0; s--) {
        const tag = stack[s];
        if (tag === 'strong') node = <strong key={`${i}-${li}-s${s}`}>{node}</strong>;
        else if (tag === 'em') node = <em key={`${i}-${li}-s${s}`}>{node}</em>;
        else if (tag === 'u') node = <u key={`${i}-${li}-s${s}`}>{node}</u>;
      }
      result.push(node);
    });
  }
  return result;
}

// Syntaxe legacy : **gras**, *italique*, __souligné__
const MD_PATTERN = /(\*\*[^*\n]+\*\*|__[^_\n]+__|_[^_\n]+_|\*[^*\n]+\*)/g;

function renderMarkdown(text) {
  const segments = text.split(MD_PATTERN);
  const result = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (!s) continue;
    if (s.startsWith('**') && s.endsWith('**')) {
      result.push(<strong key={i}>{s.slice(2, -2)}</strong>);
    } else if (s.startsWith('__') && s.endsWith('__')) {
      result.push(<u key={i}>{s.slice(2, -2)}</u>);
    } else if ((s.startsWith('*') && s.endsWith('*')) || (s.startsWith('_') && s.endsWith('_'))) {
      result.push(<em key={i}>{s.slice(1, -1)}</em>);
    } else {
      const lines = s.split('\n');
      lines.forEach((line, li) => {
        if (li > 0) result.push(<br key={`${i}-${li}`}/>);
        if (line) result.push(line);
      });
    }
  }
  return result;
}

// Point d'entrée unique — gère HTML (nouveau) et markdown (legacy)
export function renderMarkup(text) {
  if (!text) return null;
  return isHtml(text) ? renderHtml(text) : renderMarkdown(text);
}

// Version texte brut — pour PDF, IA, exports
export function stripMarkup(text) {
  if (!text) return '';
  if (isHtml(text)) {
    return text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '');
  }
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/[*_]([^*_\n]+)[*_]/g, '$1');
}
