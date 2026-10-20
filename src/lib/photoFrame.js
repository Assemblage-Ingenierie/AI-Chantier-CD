// CADRE D'UNE PHOTO DANS LE RAPPORT — source unique pour le rapport (RapportPreview) et
// l'annotateur (zone grisée « hors cadre », demande Thomas 20/10 : « j'annote au pif et mon
// annotation sort du cadre sans que je le voie »).
//
// Le rapport affiche chaque photo dans une cellule 4:3 (paysage) ou 3:4 (portrait), en
// object-fit: cover + object-position cropX% cropY% + zoom (scale cropZoom autour du même point).
// Option « Image entière » (cropFit) : object-fit: contain → toute la photo, bandes blanches.

// Recadrage automatique quand l'utilisateur n'a rien réglé : centre la cellule (4:3) sur les
// annotations pour ne pas les couper. (Logique historique de RapportPreview.effectiveCrop.)
export function autoCropXY(annotations, W, H) {
  let x = 50, y = 50;
  if (!annotations?.length || !W || !H) return [x, y];
  if (W / H >= 4 / 3) {
    const drawW = Math.round(H * 4 / 3);
    const excess = W - drawW;
    if (excess > 0) {
      const xs = annotations.filter(a => a.x != null).map(a => a.x);
      if (xs.length) {
        const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
        x = Math.max(0, Math.min(100, ((mid - drawW / 2) / excess) * 100));
      }
    }
  } else {
    const drawH = Math.round(W / (4 / 3));
    const excess = H - drawH;
    if (excess > 0) {
      const ys = annotations.filter(a => a.y != null).map(a => a.y);
      if (ys.length) {
        const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
        y = Math.max(0, Math.min(100, ((mid - drawH / 2) / excess) * 100));
      }
    }
  }
  return [x, y];
}

// [cx, cy, cz] utilisés par le rapport. `annotations`, W, H : par défaut ceux de la photo
// (l'annotateur passe ses annotations EN COURS et les dimensions de son canevas).
export function reportCrop(photo, annotations = photo?.annotations, W = photo?.annotW, H = photo?.annotH) {
  const cz = photo?.cropZoom ?? 1;
  if (photo?.cropX !== undefined || photo?.cropY !== undefined) return [photo.cropX ?? 50, photo.cropY ?? 50, cz];
  const [x, y] = autoCropXY(annotations, W, H);
  return [x, y, cz];
}

// Partie de l'image VISIBLE dans la cellule du rapport, en fractions de l'image (0..1) :
// { x, y, w, h }, ou null si toute l'image est visible (image entière, ou même format).
export function reportVisibleRect(imgW, imgH, { orient = 'landscape', cx = 50, cy = 50, cz = 1, fit = false } = {}) {
  if (fit || !imgW || !imgH) return null;
  const cellAR = orient === 'portrait' ? 3 / 4 : 4 / 3;
  const imgAR = imgW / imgH;
  // object-fit: cover — fraction de l'image couverte par la cellule (zoom 1).
  const fw = imgAR > cellAR ? cellAR / imgAR : 1;
  const fh = imgAR > cellAR ? 1 : imgAR / cellAR;
  const x0 = (1 - fw) * (cx / 100), y0 = (1 - fh) * (cy / 100);
  // scale(cz) autour du point (cx%, cy%) de la cellule → fenêtre visible réduite d'autant.
  const z = Math.max(1, cz || 1);
  const ox = cx / 100, oy = cy / 100;
  const r = { x: x0 + fw * ox * (1 - 1 / z), y: y0 + fh * oy * (1 - 1 / z), w: fw / z, h: fh / z };
  if (r.w > 0.995 && r.h > 0.995) return null;
  return r;
}
