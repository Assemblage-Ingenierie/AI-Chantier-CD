import React from 'react';

// Syntaxe légère : **gras**, *italique*, __souligné__
const PATTERN = /(\*\*[^*\n]+\*\*|__[^_\n]+__|_[^_\n]+_|\*[^*\n]+\*)/g;

// Rendu React avec balises inline
export function renderMarkup(text) {
  if (!text) return null;
  const segments = text.split(PATTERN);
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
      // Préserve les sauts de ligne
      const lines = s.split('\n');
      lines.forEach((line, li) => {
        if (li > 0) result.push(<br key={`${i}-${li}`}/>);
        if (line) result.push(line);
      });
    }
  }
  return result;
}

// Version texte brut (strip des marqueurs) — pour PDF, exports
export function stripMarkup(text) {
  if (!text) return '';
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/[*_]([^*_\n]+)[*_]/g, '$1');
}
