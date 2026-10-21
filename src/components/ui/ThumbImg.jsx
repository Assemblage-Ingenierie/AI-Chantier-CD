import React, { useState, useEffect } from 'react';
import { thumbKey, peekThumb, getThumbUrl, reportThumbOk, reportThumbError, thumbsDisabled, isPlainPath, getSignedOriginal } from '../../lib/photoThumbs.js';

// Vignette allégée d'une photo Supabase (cf. lib/photoThumbs.js). Retourne :
//   src    : URL à afficher — vignette si dispo, ORIGINAL sinon ; null le temps de la signature
//            (≈ 0,2 s, une seule fois par photo grâce au cache 30 j) → afficher un squelette ;
//   onLoad / onError : à brancher sur l'<img>. onError renvoie true s'il a basculé sur
//            l'original (l'<img> va recharger → ne pas traiter comme une vraie erreur).
// Photos locales (data:/blob:) ou hors bucket → src inchangé, aucun effet.
// allowPath : accepte un simple chemin du bucket (couvertures de l'accueil, cf. photoThumbs.js).
export function useThumb(src, width, { allowPath = false } = {}) {
  const key = thumbKey(src, width, allowPath);
  const [state, setState] = useState(() => ({ key, url: key ? peekThumb(key) : null, fallback: false }));

  useEffect(() => {
    if (!key) return;
    const hit = peekThumb(key);
    if (hit) { setState({ key, url: hit, fallback: false }); return; }
    if (thumbsDisabled()) { setState({ key, url: null, fallback: true }); return; }
    setState({ key, url: null, fallback: false });
    let cancelled = false;
    getThumbUrl(src, width, allowPath).then((u) => {
      if (!cancelled) setState({ key, url: u, fallback: !u });
    });
    return () => { cancelled = true; };
    // src est déterminé par key (même chemin) ; un nouveau token d'URL n'impose pas de re-signer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const cur = !key ? null : state.key === key ? state : { url: peekThumb(key), fallback: thumbsDisabled() };
  // Repli sur l'original alors qu'on n'a qu'un SIMPLE chemin (couvertures, allowPath) : on signe
  // l'original nous-mêmes, sinon la carte restait sur l'icône (retour Thomas 21/10).
  const needOrig = !!(allowPath && cur?.fallback && isPlainPath(src));
  const [orig, setOrig] = useState(null); // { src, url }
  useEffect(() => {
    if (!needOrig) return;
    let cancelled = false;
    getSignedOriginal(src).then((u) => { if (!cancelled) setOrig({ src, url: u }); });
    return () => { cancelled = true; };
  }, [needOrig, src]);

  if (!key) return { src, onLoad: () => {}, onError: () => false };
  const usingThumb = !!cur.url && !cur.fallback;
  const fallbackSrc = needOrig ? (orig?.src === src ? orig.url : null) : src;
  return {
    src: usingThumb ? cur.url : (cur.fallback ? fallbackSrc : null),
    onLoad: () => { if (usingThumb) reportThumbOk(); },
    onError: () => {
      if (!usingThumb) return false;
      reportThumbError(key);
      setState({ key, url: null, fallback: true });
      return true;
    },
  };
}

// <img> qui affiche la vignette allégée (width = largeur de la vignette en px, ratio conservé).
// Fond gris pendant la signature. Toutes les autres props sont transmises telles quelles.
export default function ThumbImg({ src, width, onLoad, onError, style, ...rest }) {
  const t = useThumb(src, width);
  return (
    <img {...rest} alt={rest.alt ?? ''} src={t.src || undefined}
      style={t.src ? style : { ...style, background: '#ECECEC' }}
      onLoad={(e) => { t.onLoad(); onLoad?.(e); }}
      onError={(e) => { if (t.onError()) return; onError?.(e); }}/>
  );
}
