import React from 'react';

// Décode les entités HTML courantes dans les segments texte
function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Détecte si le contenu est du HTML (nouveau format) ou du markdown (legacy).
// Inclut les balises de saut de ligne insérées par contenteditable (div/p).
function isHtml(text) {
  return text && (
    text.includes('<strong>') || text.includes('<em>') ||
    text.includes('<u>') || text.includes('<br') ||
    text.includes('<b>') || text.includes('<i>') ||
    text.includes('<div') || text.includes('<p>') || text.includes('<p ') ||
    text.includes('&gt;') || text.includes('&lt;') || text.includes('&amp;') ||
    text.includes('&nbsp;')
  );
}

// Rendu React depuis HTML simple — pas de dangerouslySetInnerHTML.
// Gère : strong/b, em/i, u (inline) ; br/div/p (sauts de ligne).
function renderHtml(html) {
  if (!html) return null;
  // Parser : balises inline (strong/b/em/i/u) + balises bloc (br/div/p, ouvrantes ET fermantes)
  const HTAG = /(<strong>|<\/strong>|<b>|<\/b>|<em>|<\/em>|<i>|<\/i>|<u>|<\/u>|<br\s*\/?>|<\/div>|<div[^>]*>|<\/p>|<p[^>]*>)/gi;
  const parts = html.split(HTAG);
  const result = [];
  const stack = []; // balises ouvertes
  let pendingBreak = false; // saut de ligne en attente (div/p ouvrant ou fermant)

  const flushBreak = () => {
    if (pendingBreak) {
      result.push(<br key={`br-pend-${result.length}`}/>);
      pendingBreak = false;
    }
  };

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    const lower = p.toLowerCase().replace(/\s*\/\s*>$/, '>');
    if (lower === '<strong>' || lower === '<b>') { stack.push('strong'); continue; }
    if (lower === '</strong>' || lower === '</b>') { stack.pop(); continue; }
    if (lower === '<em>' || lower === '<i>') { stack.push('em'); continue; }
    if (lower === '</em>' || lower === '</i>') { stack.pop(); continue; }
    if (lower === '<u>') { stack.push('u'); continue; }
    if (lower === '</u>') { stack.pop(); continue; }
    if (lower === '<br>' || lower === '<br/>') {
      result.push(<br key={`br-${i}`}/>);
      pendingBreak = false;
      continue;
    }
    // Balises bloc (div/p) — chaque ouvrante OU fermante marque un saut de ligne.
    // On colle un seul <br/> par "boundary" pour éviter les doublons (</div><div>).
    if (lower.startsWith('<div') || lower.startsWith('</div') ||
        lower.startsWith('<p') || lower.startsWith('</p')) {
      // Premier saut : on note pendingBreak ; consécutif : on collapse (déjà en attente).
      if (result.length > 0) pendingBreak = true;
      continue;
    }
    // Texte brut — décoder entités + appliquer balises ouvertes + insérer <br/> en attente
    const decoded = decodeEntities(p);
    const lines = decoded.split('\n');
    lines.forEach((line, li) => {
      if (li > 0) { result.push(<br key={`nl-${i}-${li}`}/>); pendingBreak = false; }
      if (!line) return;
      flushBreak();
      let node = line;
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
    return decodeEntities(
      text
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(div|p)>/gi, '\n')
        .replace(/<(div|p)[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
    ).replace(/\n{3,}/g, '\n\n'); // collapse les sauts multiples
  }
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/[*_]([^*_\n]+)[*_]/g, '$1');
}
