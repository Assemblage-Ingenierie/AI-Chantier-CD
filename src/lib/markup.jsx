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
// Gère : strong/b, em/i, u, s/strike (inline) ; br (saut) ; div/p (blocs) ; ul/li (puces).
function renderHtml(html) {
  if (!html) return null;

  // <li> et ul/ol gérés directement dans le parser (pas de pré-traitement)
  const HTAG = /(<strong>|<\/strong>|<b>|<\/b>|<em>|<\/em>|<i>|<\/i>|<u>|<\/u>|<s>|<\/s>|<strike>|<\/strike>|<del>|<\/del>|<br\s*\/?>|<\/div>|<div[^>]*>|<\/p>|<p[^>]*>|<li[^>]*>|<\/li>|<\/?(?:ul|ol)[^>]*>)/gi;
  const parts = html.split(HTAG);
  const blocks = []; // { items: ReactNode[], isBullet: bool }
  let current = [];
  let isBullet = false;
  const stack = [];

  const finalizeBlock = () => {
    blocks.push({ items: current, isBullet });
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
    // Ouverture d'un élément de liste → nouveau bloc puce
    if (lower.startsWith('<li')) {
      if (current.length > 0) finalizeBlock();
      isBullet = true;
      continue;
    }
    // Frontières de blocs (div/p/li/ul/ol)
    if (lower === '</li>' ||
        lower.startsWith('<div') || lower.startsWith('</div') ||
        lower.startsWith('<p')   || lower.startsWith('</p')   ||
        lower.startsWith('<ul')  || lower.startsWith('</ul')  ||
        lower.startsWith('<ol')  || lower.startsWith('</ol')) {
      if (current.length > 0) finalizeBlock();
      if (lower === '</li>' || lower.startsWith('</ul') || lower.startsWith('</ol')) isBullet = false;
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

  // Bloc "vide" = ne contient que des <br> (ligne blanche issue de l'éditeur)
  // Ces blocs ne sont pas rendus mais ajoutent de la marge aux blocs adjacents.
  const isBlank = (b) => b.items.length > 0 && b.items.every(n => n && typeof n === 'object' && n.type === 'br');

  const contentBlocks = blocks.filter(b => !isBlank(b));
  if (contentBlocks.length === 0) return null;
  if (contentBlocks.length === 1 && !contentBlocks[0].isBullet) return contentBlocks[0].items;

  // Rendu : marge réduite entre blocs consécutifs, plus grande après un bloc vide
  const result = [];
  let pendingBlank = false;
  blocks.forEach((block, i) => {
    if (isBlank(block)) { pendingBlank = true; return; }
    const hasNext = blocks.slice(i + 1).some(b => !isBlank(b));
    const mb = hasNext ? (pendingBlank ? '0.65em' : '0.3em') : 0;
    pendingBlank = false;
    result.push(
      <span key={`p-${i}`} style={{
        display: 'block',
        marginBottom: mb,
        ...(block.isBullet ? { paddingLeft: '1.1em', textIndent: '-1.1em' } : {}),
      }}>
        {block.isBullet && '• '}
        {block.items}
      </span>
    );
  });
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
