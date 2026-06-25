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

// Détecte si le contenu est du HTML — regex plus robuste que includes() pour gérer
// les balises avec attributs comme <u style="...">, <span class="...">.
function isHtml(text) {
  if (!text) return false;
  return /<\/?(strong|b|em|i|u|s|strike|del|br|div|p|ul|ol|li|span|h[1-6]|blockquote|img)\b/i.test(text)
    || text.includes('&gt;') || text.includes('&lt;') || text.includes('&amp;') || text.includes('&nbsp;');
}

// Rendu React depuis HTML via le DOM — gère TOUS les attributs (style, class…), entités,
// balises bloc/inline/liste. Remplace l'ancien parser HTAG qui ne reconnaissait pas
// les balises avec attributs (<u style="font-family:inherit"> restait en texte brut).
function renderHtml(html) {
  if (!html) return null;
  // Rétrocompat : anciens commentaires dont les balises ont été encodées en entités.
  // Le pattern (?:[^&]|&(?!gt;))*? tolère les ; dans les valeurs CSS (font-family: inherit;).
  let prepared = html;
  if (prepared.includes('&lt;') || prepared.includes('&gt;')) {
    prepared = prepared.replace(/&lt;(\/?(?:div|p|br|ul|ol|li|strong|b|em|i|u|s|strike|del|span)(?:[^&]|&(?!gt;))*?)&gt;/gi, '<$1>');
  }

  const container = document.createElement('div');
  container.innerHTML = prepared;

  let key = 0;
  const k = () => key++;
  const blocks = [];
  let current = [];
  let isBullet = false;

  const flush = () => {
    if (current.length > 0) {
      blocks.push({ items: [...current], isBullet });
      current = [];
      isBullet = false;
    }
  };

  const BLOCK_TAGS = new Set(['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']);

  const walk = (node, b, it, u, s) => {
    if (node.nodeType === 3) { // TEXT_NODE — DOM décode les entités automatiquement
      const text = node.textContent;
      if (!text) return;
      text.split('\n').forEach((line, i) => {
        if (i > 0) flush();
        if (!line) return;
        let el = line;
        if (s) el = <s key={k()}>{el}</s>;
        if (u) el = <u key={k()}>{el}</u>;
        if (it) el = <em key={k()}>{el}</em>;
        if (b) el = <strong key={k()}>{el}</strong>;
        current.push(el);
      });
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();

    // <br> : un saut simple ferme la ligne courante ; un <br> alors que rien n'a été
    // écrit depuis le dernier saut = ligne vide voulue (aération) → on la matérialise.
    // Sans ça, les <br><br> consécutifs (selon le navigateur) étaient avalés.
    if (tag === 'br') {
      if (current.length === 0) blocks.push({ items: [], isBullet: false });
      else flush();
      return;
    }

    // Image collée dans le commentaire (feature « comme Word ») : rendue sur sa propre ligne,
    // largeur (data-w %) et alignement (data-align) tels que réglés dans l'éditeur.
    if (tag === 'img') {
      const src = node.getAttribute('src');
      if (src) {
        flush();
        const align = node.getAttribute('data-align') || 'center';
        const wAttr = parseFloat(node.getAttribute('data-w'));
        const width = Number.isFinite(wAttr) ? `${Math.max(10, Math.min(100, wAttr))}%` : '60%';
        const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
        blocks.push({ items: [
          <span key={k()} style={{ display: 'flex', justifyContent: justify, margin: '6px 0' }}>
            <img src={src} alt="" style={{ width, maxWidth: '100%', height: 'auto', borderRadius: 4, display: 'block' }}/>
          </span>
        ], isBullet: false });
      }
      return;
    }

    if (BLOCK_TAGS.has(tag)) {
      flush();
      const beforeCount = blocks.length;
      const beforeLen = current.length;
      for (const child of node.childNodes) walk(child, b, it, u, s);
      if (current.length > 0) flush();
      else if (blocks.length === beforeCount && beforeLen === 0 && blocks.length > 0) {
        // Div/p vide (ou contenant seulement <br>) entre du contenu → ligne vide
        blocks.push({ items: [], isBullet: false });
      }
      return;
    }

    if (tag === 'ul' || tag === 'ol') {
      flush();
      for (const child of node.childNodes) {
        if (child.nodeType !== 1 || child.tagName.toLowerCase() !== 'li') continue;
        flush();
        isBullet = true;
        for (const liChild of child.childNodes) walk(liChild, b, it, u, s);
        flush();
      }
      return;
    }

    if (tag === 'li') {
      flush();
      isBullet = true;
      for (const child of node.childNodes) walk(child, b, it, u, s);
      flush();
      return;
    }

    const nb = b || tag === 'strong' || tag === 'b';
    const ni = it || tag === 'em' || tag === 'i';
    const nu = u || tag === 'u';
    const ns = s || tag === 's' || tag === 'strike' || tag === 'del';
    // span et balises inconnues : passage transparent (style ignoré, contenu rendu)
    for (const child of node.childNodes) walk(child, nb, ni, nu, ns);
  };

  walk(container, false, false, false, false);

  if (!blocks.length) return null;

  const isBlank = (bl) => bl.items.length === 0 || bl.items.every(n => n && typeof n === 'object' && n.type === 'br');
  const contentBlocks = blocks.filter(bl => !isBlank(bl));
  if (!contentBlocks.length) return null;
  if (contentBlocks.length === 1 && !contentBlocks[0].isBullet) return contentBlocks[0].items;

  const result = [];
  let blanksBefore = 0; // nombre de lignes vides consécutives avant le prochain bloc
  blocks.forEach((block, i) => {
    if (isBlank(block)) { blanksBefore++; return; }
    const hasNext = blocks.slice(i + 1).some(bl => !isBlank(bl));
    // Espacement d'une ligne vide ≈ une vraie ligne (aération visible, proche de l'éditeur).
    // Pas de marge en tête (result vide) → évite un décalage si le texte commence par un saut.
    const mt = (blanksBefore > 0 && result.length > 0) ? `${blanksBefore * 1.5}em` : undefined;
    // Les puces respirent nettement plus (espace proche de l'éditeur, demande utilisateur).
    const mb = hasNext ? (block.isBullet ? '0.8em' : '0.3em') : 0;
    blanksBefore = 0;
    result.push(
      <span key={`p-${i}`} style={{
        display: 'block',
        ...(mt ? { marginTop: mt } : {}),
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
