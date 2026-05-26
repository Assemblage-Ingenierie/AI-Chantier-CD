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
    text.includes('<s>') || text.includes('<ul') || text.includes('<li') || text.includes('<strike') ||
    text.includes('&gt;') || text.includes('&lt;') || text.includes('&amp;') ||
    text.includes('&nbsp;')
  );
}

// Rendu React depuis HTML simple — pas de dangerouslySetInnerHTML.
// Gère : strong/b, em/i, u, s/strike (inline) ; br (saut) ; div/p, ul/li (blocs).
function renderHtml(html) {
  if (!html) return null;
  // Pré-traitement : aplatir les listes ul/ol en blocs bullet
  const flattened = html
    .replace(/<li[^>]*>/gi, '<div>• ')
    .replace(/<\/li>/gi, '</div>')
    .replace(/<\/?(?:ul|ol)[^>]*>/gi, '');

  const HTAG = /(<strong>|<\/strong>|<b>|<\/b>|<em>|<\/em>|<i>|<\/i>|<u>|<\/u>|<s>|<\/s>|<strike>|<\/strike>|<del>|<\/del>|<br\s*\/?>|<\/div>|<div[^>]*>|<\/p>|<p[^>]*>)/gi;
  const parts = flattened.split(HTAG);
  const blocks = [];   // tableau de paragraphes (chacun = array d'éléments inline)
  let current = [];    // bloc en cours de construction
  const stack = [];    // balises inline ouvertes (strong/em/u/s)

  const finalizeBlock = () => {
    // On garde le bloc même s'il est "vide" pour préserver les lignes blanches intentionnelles
    blocks.push(current);
    current = [];
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
    if (lower === '<s>' || lower === '<strike>' || lower === '<del>') { stack.push('s'); continue; }
    if (lower === '</s>' || lower === '</strike>' || lower === '</del>') { stack.pop(); continue; }
    if (lower === '<br>' || lower === '<br/>') {
      current.push(<br key={`br-${i}`}/>);
      continue;
    }
    // Balises bloc (div/p) — chaque ouvrante OU fermante marque une frontière de paragraphe.
    // Les frontières consécutives (</div><div>) ne créent qu'UN seul saut de paragraphe.
    if (lower.startsWith('<div') || lower.startsWith('</div') ||
        lower.startsWith('<p') || lower.startsWith('</p')) {
      if (current.length > 0) finalizeBlock();
      continue;
    }
    // Texte brut — décoder entités + appliquer balises ouvertes
    const decoded = decodeEntities(p);
    const lines = decoded.split('\n');
    lines.forEach((line, li) => {
      if (li > 0) current.push(<br key={`nl-${i}-${li}`}/>);
      if (!line) return;
      let node = line;
      for (let s = stack.length - 1; s >= 0; s--) {
        const tag = stack[s];
        if (tag === 'strong') node = <strong key={`${i}-${li}-s${s}`}>{node}</strong>;
        else if (tag === 'em') node = <em key={`${i}-${li}-s${s}`}>{node}</em>;
        else if (tag === 'u') node = <u key={`${i}-${li}-s${s}`}>{node}</u>;
        else if (tag === 's') node = <s key={`${i}-${li}-s${s}`}>{node}</s>;
      }
      current.push(node);
    });
  }
  if (current.length > 0) finalizeBlock();

  if (blocks.length === 0) return null;
  if (blocks.length === 1) return blocks[0]; // un seul bloc : pas besoin de wrapper

  // Chaque paragraphe = <span display:block> avec marge en bas
  // (span plutôt que div pour rester valide HTML quand le parent est un <p>)
  return blocks.map((block, i) => (
    <span key={`p-${i}`} style={{ display: 'block', marginBottom: i < blocks.length - 1 ? '0.7em' : 0 }}>
      {block}
    </span>
  ));
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
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<\/li>/gi, '\n')
        .replace(/<\/?(?:ul|ol)[^>]*>/gi, '\n')
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
