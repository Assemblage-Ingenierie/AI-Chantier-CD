import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { DA, URGENCE } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import RapportPreview from './RapportPreview.jsx';
import ParticipantsEditor from './ParticipantsEditor.jsx';
import { exportPdf } from '../../lib/generateRapport.js';
import JSZip from 'jszip';
import Annotator from './Annotator.jsx';
import { setPhotoAnnotPref } from '../../lib/photoPrefs.js';

function ConclusionEditor({ value, align, onChange, onAlignChange }) {
  const taRef = useRef();

  const wrap = (before, after) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const newVal = value.slice(0, s) + before + value.slice(s, e) + after + value.slice(e);
    onChange(newVal);
    requestAnimationFrame(() => {
      ta.selectionStart = s + before.length;
      ta.selectionEnd   = e + before.length;
      ta.focus();
    });
  };

  const FMT = [
    { lbl:'G', title:'Gras',     b:'**', a:'**', fw:800 },
    { lbl:'I', title:'Italique', b:'*',  a:'*',  fi:'italic' },
    { lbl:'S', title:'Souligné', b:'__', a:'__', td:'underline' },
  ];
  const ALIGNS = [
    { k:'left',    sym:'←', lbl:'Gauche' },
    { k:'center',  sym:'↔', lbl:'Centrer' },
    { k:'right',   sym:'→', lbl:'Droite' },
    { k:'justify', sym:'☰', lbl:'Justifier' },
  ];

  return (
    <div style={{ marginTop:8 }}>
      <div style={{ display:'flex', gap:3, marginBottom:5, alignItems:'center', flexWrap:'wrap' }}>
        {FMT.map(btn => (
          <button key={btn.lbl}
            onMouseDown={e => { e.preventDefault(); wrap(btn.b, btn.a); }}
            title={btn.title}
            style={{ width:28, height:28, borderRadius:5, border:`1px solid ${DA.border}`, background:'white', cursor:'pointer',
              fontSize:12, fontWeight:btn.fw??400, fontStyle:btn.fi??'normal', textDecoration:btn.td??'none',
              color:DA.black, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            {btn.lbl}
          </button>
        ))}
        <div style={{ width:1, height:20, background:DA.border, margin:'0 2px', flexShrink:0 }}/>
        {ALIGNS.map(a => (
          <button key={a.k}
            onClick={() => onAlignChange(a.k)}
            title={a.lbl}
            style={{ width:28, height:28, borderRadius:5, fontSize:14, cursor:'pointer', flexShrink:0,
              border:`1.5px solid ${align===a.k ? DA.red : DA.border}`,
              background: align===a.k ? DA.redL : 'white',
              color: align===a.k ? DA.red : DA.gray,
              display:'flex', alignItems:'center', justifyContent:'center' }}>
            {a.sym}
          </button>
        ))}
      </div>
      <textarea
        ref={taRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Saisissez votre conclusion…"
        rows={5}
        style={{ width:'100%', fontSize:11, border:`1px solid ${DA.border}`, borderRadius:8, padding:'8px 10px',
          outline:'none', boxSizing:'border-box', fontFamily:'inherit', resize:'vertical', color:DA.black,
          lineHeight:1.5, textAlign:align, background:'white' }}
      />
      <p style={{ fontSize:9, color:DA.grayL, margin:'2px 0 0', fontStyle:'italic' }}>
        Sélectionne du texte → clique G/I/S pour le mettre en forme
      </p>
    </div>
  );
}

export default function RapportTab({ projet, onUpdate }) {
  const [exporting, setExporting] = useState(false);
  const [cutMode, setCutMode] = useState(false);
  const previewRef = useRef();
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 640);
  const [editingPlan, setEditingPlan] = useState(null); // { locId, epIdx, bg, paths }
  const [editingPhoto, setEditingPhoto] = useState(null); // { locId, itemId, photo, bg, paths }
  const [panelW, setPanelW] = useState(() => {
    const saved = parseInt(localStorage.getItem('chantierai_panel_w') || '0', 10);
    return saved >= 220 && saved <= 600 ? saved : 300;
  });
  const dragRef = useRef(null);
  const localisations = projet.localisations || [];
  const allItems      = localisations.flatMap(l => l.items || []);

  useEffect(() => {
    const onResize = () => setPanelOpen(w => window.innerWidth >= 640 ? true : w);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const startDrag = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelW;
    const onMove = (ev) => {
      const newW = Math.min(600, Math.max(220, startW + ev.clientX - startX));
      setPanelW(newW);
      localStorage.setItem('chantierai_panel_w', String(newW));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onUpdateItem = (locId, itemId, updatedItem) => {
    onUpdate({
      localisations: localisations.map(l =>
        l.id !== locId ? l : {
          ...l,
          items: (l.items || []).map(i => i.id !== itemId ? i : { ...i, ...updatedItem }),
        }
      ),
    });
  };

  // 3 échelles indépendantes (texte / forme / symbole), COORDONNÉES avec l'annotateur :
  // mêmes clés localStorage → un réglage est partagé entre l'annotateur et le rapport.
  // Migration depuis l'ancienne échelle unique 'chantierai_annot_scale'.
  const _oldAnnot = (() => {
    const v = parseFloat(localStorage.getItem('chantierai_annot_scale') ?? '1');
    return (isNaN(v) || v > 1.5) ? 1 : Math.max(0.3, Math.min(5, v));
  })();
  const _read = (k, fb) => { const v = parseFloat(localStorage.getItem(k) ?? String(fb)); return isNaN(v) ? fb : Math.max(0.3, Math.min(5, v)); };
  const [scaleText,   setScaleText]   = useState(() => _read('chantierai_scale_text', _oldAnnot));
  const [scaleSymbol, setScaleSymbol] = useState(() => _read('chantierai_scale_symbol', _oldAnnot));
  const [scaleShape,  setScaleShape]  = useState(() => _read('chantierai_scale_shape', 1));
  const annotScales = useMemo(() => ({ text: scaleText, shape: scaleShape, symbol: scaleSymbol }), [scaleText, scaleShape, scaleSymbol]);
  const setScale = (kind, v) => {
    if (kind === 'text')   { setScaleText(v);   localStorage.setItem('chantierai_scale_text', String(v)); }
    if (kind === 'shape')  { setScaleShape(v);  localStorage.setItem('chantierai_scale_shape', String(v)); }
    if (kind === 'symbol') { setScaleSymbol(v); localStorage.setItem('chantierai_scale_symbol', String(v)); }
  };

  // Échelles SÉPARÉES pour les annotations des PHOTOS (indépendantes des plans). Défaut 1× →
  // les rapports existants ne bougent pas tant qu'on n'y touche pas. Appliquées au rendu des
  // annotations photo dans le rapport (couche overlay).
  const [scaleTextPhoto,   setScaleTextPhoto]   = useState(() => _read('chantierai_scale_photo_text', 1));
  const [scaleSymbolPhoto, setScaleSymbolPhoto] = useState(() => _read('chantierai_scale_photo_symbol', 1));
  const [scaleShapePhoto,  setScaleShapePhoto]  = useState(() => _read('chantierai_scale_photo_shape', 1));
  const photoAnnotScales = useMemo(() => ({ text: scaleTextPhoto, shape: scaleShapePhoto, symbol: scaleSymbolPhoto }), [scaleTextPhoto, scaleShapePhoto, scaleSymbolPhoto]);
  const setScalePhoto = (kind, v) => {
    if (kind === 'text')   { setScaleTextPhoto(v);   localStorage.setItem('chantierai_scale_photo_text', String(v)); }
    if (kind === 'shape')  { setScaleShapePhoto(v);  localStorage.setItem('chantierai_scale_photo_shape', String(v)); }
    if (kind === 'symbol') { setScaleSymbolPhoto(v); localStorage.setItem('chantierai_scale_photo_symbol', String(v)); }
  };

  const pageBreaks = projet.rapportPageBreaks || [];

  // Nettoie le commentaire : supprime HTML, markdown, puis tronque
  const shortSolution = (comment) => {
    if (!comment) return '';
    const clean = comment
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
      .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\n+/g, ' ')
      .trim();
    if (clean.length <= 70) return clean;
    const cut = clean.lastIndexOf(' ', 70);
    return clean.slice(0, cut > 20 ? cut : 70) + '…';
  };

  const recapRows = useMemo(() => {
    if (projet.includeTableauRecap === false) return [];
    const urgOrder = { haute: 0, moyenne: 1, basse: 2 };
    const ovMap = new Map((projet.tableauRecap || []).map(r => [r.itemId, r]));
    // Une observation alimente le récap si elle a du contenu (intitulé OU commentaire OU photos)
    // — pas seulement un intitulé. Sinon, en retirant les intitulés, les observations
    // disparaissaient du tableau récapitulatif.
    const hasContent = (i) => !!(
      (i.titre && i.titre.trim()) ||
      (i.commentaire && i.commentaire.replace(/<[^>]+>/g, '').trim()) ||
      (i.photos || []).some(p => p.data)
    );
    // Lignes issues des items (hors "fait" et hors "excluded")
    const itemRows = localisations.flatMap(loc =>
      (loc.items || []).filter(i => hasContent(i) && i.suivi !== 'fait').map(i => {
        const ov = ovMap.get(i.id) || {};
        if (ov.excluded) return null;
        return {
          itemId: i.id,
          isCustom: false,
          locNom:   'zone'     in ov ? ov.zone     : (loc.nom     || ''),
          titre:    'titre'    in ov ? ov.titre    : (i.titre      || ''),
          urgence:  'urgence'  in ov ? ov.urgence  : (i.urgence   || 'basse'),
          solution: 'solution' in ov ? ov.solution : '',
          commentaire: i.commentaire || '',
        };
      }).filter(Boolean)
    ).sort((a, b) => (urgOrder[a.urgence] ?? 2) - (urgOrder[b.urgence] ?? 2));
    // Lignes personnalisées ajoutées manuellement
    const customRows = (projet.tableauRecap || [])
      .filter(r => r.isCustom)
      .map(r => ({ itemId: r.itemId, isCustom: true, locNom: r.zone || '', titre: r.titre || '', urgence: r.urgence || 'basse', solution: r.solution || '', commentaire: '' }));
    return [...itemRows, ...customRows];
  }, [localisations, projet.includeTableauRecap, projet.tableauRecap]);

  // Accepte (itemId, field, value) OU (itemId, { field1: v1, field2: v2 }) pour mettre à jour
  // plusieurs champs en un seul appel — évite le bug de closure obsolète quand genRow écrit
  // titre ET solution coup sur coup (le 2e appel écrasait le 1er sur le même tableauRecap figé).
  const updateRecapField = useCallback((itemId, field, value) => {
    const patch = (typeof field === 'object' && field !== null) ? field : { [field]: value };
    const curr = projet.tableauRecap || [];
    const has = curr.some(r => r.itemId === itemId);
    onUpdate({ tableauRecap: has
      ? curr.map(r => r.itemId === itemId ? { ...r, ...patch } : r)
      : [...curr, { itemId, ...patch }]
    });
  }, [projet.tableauRecap, onUpdate]);

  const deleteRecapRow = useCallback((itemId, isCustom) => {
    const curr = projet.tableauRecap || [];
    if (isCustom) {
      onUpdate({ tableauRecap: curr.filter(r => r.itemId !== itemId) });
    } else {
      // Marque comme excluded (pas physiquement supprimé pour permettre le retour)
      const has = curr.some(r => r.itemId === itemId);
      onUpdate({ tableauRecap: has
        ? curr.map(r => r.itemId === itemId ? { ...r, excluded: true } : r)
        : [...curr, { itemId, excluded: true }]
      });
    }
  }, [projet.tableauRecap, onUpdate]);

  const addCustomRow = useCallback(() => {
    const id = 'custom_' + crypto.randomUUID();
    const curr = projet.tableauRecap || [];
    onUpdate({ tableauRecap: [...curr, { itemId: id, isCustom: true, zone: '', titre: '', urgence: 'basse', solution: '' }] });
  }, [projet.tableauRecap, onUpdate]);
  const togglePageBreak = (id) => {
    const curr = projet.rapportPageBreaks || [];
    if (curr.includes(id)) {
      onUpdate({ rapportPageBreaks: curr.filter(x => x !== id) });
      return;
    }
    // _pmsN = bloc dérivé d'une coupure de texte — résoudre vers le vrai break _pN stocké
    const pmsMatch = id.match(/^(.+)_pms(\d+)$/);
    if (pmsMatch) {
      const base = pmsMatch[1];
      const n = parseInt(pmsMatch[2]);
      const pBreaks = curr
        .filter(x => { const m = x.match(/^(.+)_p(\d+)$/); return m && m[1] === base; })
        .sort((a, b) => parseInt(a.match(/_p(\d+)$/)[1]) - parseInt(b.match(/_p(\d+)$/)[1]));
      const target = pBreaks[n - 1];
      if (target) { onUpdate({ rapportPageBreaks: curr.filter(x => x !== target) }); return; }
    }
    onUpdate({ rapportPageBreaks: [...curr, id] });
  };

  const handleExport = () => {
    previewRef.current?.print();
  };

  const [zipping, setZipping] = useState(false);

  const handleExportPhotos = async () => {
    const allPhotos = localisations.flatMap(loc =>
      (loc.items || []).flatMap(item =>
        (item.photos || []).filter(ph => ph.data).map((ph, idx) => ({
          data: ph.data,
          name: ph.name || `photo_${idx + 1}.webp`,
          locNom: loc.nom || 'Sans zone',
          itemTitre: item.titre || 'Sans titre',
        }))
      )
    );
    if (allPhotos.length === 0) { alert('Aucune photo disponible.'); return; }

    setZipping(true);
    try {
      const zip = new JSZip();
      const sanitize = s => s.replace(/[^a-zA-Z0-9À-ÿ _-]/g, '_').trim().slice(0, 60);
      const counts = {};
      for (const ph of allPhotos) {
        const folder = sanitize(ph.locNom);
        const base   = sanitize(ph.itemTitre);
        const key    = `${folder}/${base}`;
        counts[key]  = (counts[key] || 0) + 1;
        const ext    = ph.name.includes('.') ? ph.name.split('.').pop() : 'jpg';
        const fname  = `${base}_${counts[key]}.${ext}`;
        try {
          if (ph.data.startsWith('data:')) {
            const b64 = ph.data.includes(',') ? ph.data.split(',')[1] : ph.data;
            zip.folder(folder).file(fname, b64, { base64: true });
          } else {
            const resp = await fetch(ph.data);
            if (!resp.ok) continue;
            const blob = await resp.blob();
            zip.folder(folder).file(fname, blob);
          }
        } catch { /* skip photo en erreur */ }
      }
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const datePart = projet.dateVisite ? projet.dateVisite.replace(/-/g, '_') : null;
      const nomVisite = projet.visiteNom ? sanitize(projet.visiteNom) : null;
      const ingPart = projet.ingenieur ? `_(${projet.ingenieur})` : '';
      const parts = [datePart, nomVisite].filter(Boolean);
      const zipName = parts.length > 0 ? `${parts.join('_')}${ingPart}` : sanitize(projet.nom || 'rapport');
      a.href     = url;
      a.download = `${zipName}_photos.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      console.error('ZIP photos:', e);
      alert('Erreur lors de la création du ZIP : ' + (e.message || e));
    }
    setZipping(false);
  };

  const totalPhotos = useMemo(() =>
    localisations.flatMap(l => l.items || []).reduce((s, i) => s + (i.photos || []).filter(p => p.data).length, 0),
  [localisations]);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden', position:'relative' }}>

      {/* ── Panneau gauche : paramètres ── */}
      {panelOpen && (
      <div style={{ width: isMobile ? '100%' : panelW, display:'flex', flexDirection:'column', flexShrink:0, background:DA.white, position: isMobile ? 'absolute' : 'relative', inset: isMobile ? 0 : 'auto', zIndex: isMobile ? 10 : 'auto' }}>

        {/* Bouton retour — visible uniquement sur mobile */}
        {isMobile && (
          <div style={{ padding:'8px 12px', borderBottom:`1px solid ${DA.border}`, flexShrink:0, background:'#f8f8f8' }}>
            <button
              onClick={() => setPanelOpen(false)}
              style={{ display:'flex', alignItems:'center', gap:7, padding:'8px 14px', borderRadius:8, border:`1px solid ${DA.border}`, background:'white', cursor:'pointer', fontSize:13, fontWeight:700, color:DA.black, width:'100%' }}>
              <span style={{ fontSize:16, lineHeight:1, marginTop:-1 }}>‹</span>
              Retour à l'aperçu
            </button>
          </div>
        )}

        <div style={{ flex:1, overflowY:'auto', padding:12, display:'flex', flexDirection:'column', gap:10 }}>

          {/* Intervenants */}
          <ParticipantsEditor
            participants={projet.participants || []}
            onChange={ps => onUpdate({ participants: ps })}
          />

          {/* Maître d'ouvrage */}
          <div>
            <label style={{ fontSize:10, fontWeight:700, color:DA.gray, display:'block', marginBottom:4, textTransform:'uppercase', letterSpacing:0.5 }}>
              Maître d'ouvrage
            </label>
            <input
              value={projet.maitreOuvrage || ''}
              onChange={e => onUpdate({ maitreOuvrage: e.target.value })}
              placeholder="Nom du maître d'ouvrage…"
              style={{ width:'100%', fontSize:12, border:`1px solid ${DA.border}`, borderRadius:8, padding:'7px 10px', outline:'none', boxSizing:'border-box', fontFamily:'inherit' }}
            />
          </div>

          {/* Date de visite */}
          <div>
            <label style={{ fontSize:10, fontWeight:700, color:DA.gray, display:'block', marginBottom:4, textTransform:'uppercase', letterSpacing:0.5 }}>
              Date de la visite
            </label>
            <input
              type="date"
              value={projet.dateVisite || ''}
              onChange={e => onUpdate({ dateVisite: e.target.value || null })}
              style={{ width:'100%', padding:'7px 10px', borderRadius:8, border:`1px solid ${DA.border}`, fontSize:12, color:DA.black, background:DA.white, outline:'none', fontFamily:'inherit', boxSizing:'border-box' }}
            />
          </div>

          {/* Photos par ligne */}
          <div>
            <label style={{ fontSize:10, fontWeight:700, color:DA.gray, display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:0.5 }}>
              Photos par ligne (PDF)
            </label>
            <div style={{ display:'flex', gap:6 }}>
              {[1, 2, 3].map(n => (
                <button key={n} onClick={() => onUpdate({ photosParLigne: n })}
                  style={{ flex:1, padding:'7px 0', borderRadius:8, fontSize:12, fontWeight:700,
                    border:`2px solid ${(projet.photosParLigne ?? 2) === n ? DA.red : DA.border}`,
                    background:(projet.photosParLigne ?? 2) === n ? DA.redL : DA.white,
                    color:(projet.photosParLigne ?? 2) === n ? DA.red : DA.gray,
                    cursor:'pointer' }}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Taille des annotations — PLANS — 3 échelles indépendantes (coordonnées avec l'annotateur) */}
          <div>
            <label style={{ fontSize:10, fontWeight:700, color:DA.gray, display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:0.5 }}>
              Taille des annotations · Plans
            </label>
            {[
              { kind:'text',   lbl:'Texte',    val:scaleText },
              { kind:'shape',  lbl:'Formes',   val:scaleShape },
              { kind:'symbol', lbl:'Symboles', val:scaleSymbol },
            ].map(s => (
              <div key={s.kind} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
                <span style={{ fontSize:10, fontWeight:600, color:DA.gray, minWidth:58 }}>{s.lbl}</span>
                <input type="range" min="0.3" max="3" step="0.1" value={s.val}
                  onChange={e => setScale(s.kind, parseFloat(e.target.value))}
                  style={{ flex:1, accentColor:DA.red, cursor:'pointer' }}/>
                <span style={{ fontSize:11, fontWeight:700, color:DA.black, minWidth:30, textAlign:'right' }}>{s.val.toFixed(1)}×</span>
              </div>
            ))}
            <p style={{ fontSize:9.5, color:DA.grayL, margin:'3px 0 0', fontStyle:'italic' }}>
              Affecte les marqueurs des plans. Réglages partagés avec l'annotateur.
            </p>
          </div>

          {/* Taille des annotations — PHOTOS — échelles distinctes des plans */}
          <div>
            <label style={{ fontSize:10, fontWeight:700, color:DA.gray, display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:0.5 }}>
              Taille des annotations · Photos
            </label>
            {[
              { kind:'text',   lbl:'Texte',    val:scaleTextPhoto },
              { kind:'shape',  lbl:'Formes',   val:scaleShapePhoto },
              { kind:'symbol', lbl:'Symboles', val:scaleSymbolPhoto },
            ].map(s => (
              <div key={s.kind} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
                <span style={{ fontSize:10, fontWeight:600, color:DA.gray, minWidth:58 }}>{s.lbl}</span>
                <input type="range" min="0.3" max="3" step="0.1" value={s.val}
                  onChange={e => setScalePhoto(s.kind, parseFloat(e.target.value))}
                  style={{ flex:1, accentColor:DA.red, cursor:'pointer' }}/>
                <span style={{ fontSize:11, fontWeight:700, color:DA.black, minWidth:30, textAlign:'right' }}>{s.val.toFixed(1)}×</span>
              </div>
            ))}
            <p style={{ fontSize:9.5, color:DA.grayL, margin:'3px 0 0', fontStyle:'italic' }}>
              Affecte les annotations dessinées sur les photos (texte, flèches, symboles).
            </p>
          </div>

          {/* Plans en fin de rapport */}
          <div>
            <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
              <input
                type="checkbox"
                checked={projet.plansEnFin ?? false}
                onChange={e => onUpdate({ plansEnFin: e.target.checked })}
                style={{ cursor:'pointer', width:14, height:14, accentColor:DA.red }}
              />
              <span style={{ fontSize:12, fontWeight:600, color:DA.black }}>Plans en fin de rapport</span>
            </label>
          </div>

          {/* Sauts de page */}
          <button
            onClick={() => setCutMode(v => !v)}
            style={{ padding:'8px 0', borderRadius:8, fontSize:11, fontWeight:700,
              border: cutMode ? `1.5px solid ${DA.red}` : `1px solid ${DA.border}`,
              background: cutMode ? '#FFF0F0' : 'white',
              color: cutMode ? DA.red : DA.black,
              display:'flex', alignItems:'center', justifyContent:'center', gap:6, cursor:'pointer' }}>
            ✂ {cutMode ? "Mode coupe actif" : 'Saut de page'}
          </button>

          {/* Tableau récapitulatif */}
          <div>
            <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
              <input
                type="checkbox"
                checked={projet.includeTableauRecap !== false}
                onChange={e => onUpdate({ includeTableauRecap: e.target.checked })}
                style={{ cursor:'pointer', width:14, height:14, accentColor:DA.red }}
              />
              <span style={{ fontSize:12, fontWeight:600, color:DA.black }}>Tableau récapitulatif</span>
            </label>
            {projet.includeTableauRecap !== false && (
              <p style={{ fontSize:10, color:DA.grayL, margin:'3px 0 0 22px', fontStyle:'italic' }}>
                Modifiable directement dans l'aperçu →
              </p>
            )}
          </div>

          {/* Conclusion */}
          <div>
            <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
              <input
                type="checkbox"
                checked={projet.includeConclusion ?? false}
                onChange={e => onUpdate({ includeConclusion: e.target.checked })}
                style={{ cursor:'pointer', width:14, height:14, accentColor:DA.red }}
              />
              <span style={{ fontSize:12, fontWeight:600, color:DA.black }}>Ajouter une conclusion</span>
            </label>
            {(projet.includeConclusion ?? false) && (
              <p style={{ fontSize:10, color:DA.grayL, margin:'3px 0 0 22px', fontStyle:'italic' }}>
                Modifiable directement dans l'aperçu →
              </p>
            )}
          </div>
        </div>

      </div>
      )}

      {/* ── Poignée de redimensionnement ── */}
      {panelOpen && !isMobile && (
        <div
          onMouseDown={startDrag}
          style={{ width:5, flexShrink:0, cursor:'col-resize', background:'transparent', borderRight:`1px solid ${DA.border}`, position:'relative', zIndex:5 }}
          title="Glisser pour redimensionner"
        >
          <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', width:3, height:32, borderRadius:2, background:DA.border }}/>
        </div>
      )}

      {/* ── Panneau droit : aperçu A4 ── */}
      <RapportPreview
        ref={previewRef}
        projet={projet}
        localisations={localisations}
        photosParLigne={projet.photosParLigne ?? 2}
        pageBreaks={pageBreaks}
        onTogglePageBreak={togglePageBreak}
        plansEnFin={projet.plansEnFin ?? false}
        includeTableauRecap={projet.includeTableauRecap !== false}
        tableauRecap={projet.tableauRecap || []}
        annotScales={annotScales}
        photoAnnotScales={photoAnnotScales}
        includeConclusion={projet.includeConclusion ?? false}
        conclusion={projet.conclusion ?? ''}
        conclusionAlign={projet.conclusionAlign ?? 'left'}
        onUpdateItem={onUpdateItem}
        onTogglePanel={() => setPanelOpen(v => !v)}
        panelOpen={panelOpen}
        panelW={isMobile ? 0 : panelW}
        cutMode={cutMode}
        onCutModeChange={setCutMode}
        onExportPdf={handleExport}
        onExportPhotos={handleExportPhotos}
        totalPhotos={totalPhotos}
        zipping={zipping}
        recapRows={recapRows}
        onUpdateRecap={updateRecapField}
        onDeleteRecap={deleteRecapRow}
        onAddCustomRow={addCustomRow}
        onUpdateConclusion={v => onUpdate({ conclusion: v })}
        onUpdateConclusionAlign={a => onUpdate({ conclusionAlign: a })}
        onAnnotScaleChange={(kind, v) => setScale(kind, v)}
        onEditPlan={(locId, epIdx, bg, paths) => setEditingPlan({ locId, epIdx, bg, paths })}
        onAnnotatePhoto={(locId, item, photo) => {
          if (!photo?.data) return;
          setEditingPhoto({ locId, itemId: item.id, photo, bg: photo.data, paths: photo.annotations || [] });
        }}
      />

      {/* ── Annotateur plan (ajustement rapide depuis le rapport) ── */}
      {editingPlan && (
        <Annotator
          bgImage={editingPlan.bg}
          savedPaths={editingPlan.paths}
          exportSizeMultiplier={2}
          initialTool="select"
          title="Ajuster les annotations du plan"
          onClose={() => setEditingPlan(null)}
          onSave={(newPaths) => {
            const updatedLocs = localisations.map(l => {
              if (l.id !== editingPlan.locId) return l;
              if (editingPlan.epIdx === null) {
                return { ...l, planAnnotations: { ...(l.planAnnotations || {}), paths: newPaths, exported: null } };
              }
              return {
                ...l,
                extraPlans: (l.extraPlans || []).map((ep, i) =>
                  i === editingPlan.epIdx ? { ...ep, planAnnotations: { ...(ep.planAnnotations || {}), paths: newPaths, exported: null } } : ep
                ),
              };
            });
            onUpdate({ localisations: updatedLocs });
            setEditingPlan(null);
          }}
        />
      )}

      {/* ── Annotateur photo (retouche rapide depuis le rapport) ── */}
      {editingPhoto && (
        <Annotator
          bgImage={editingPhoto.bg}
          savedPaths={editingPhoto.paths}
          title="Annoter la photo"
          onClose={() => setEditingPhoto(null)}
          onSave={(paths, exported, dims) => {
            const loc = localisations.find(l => l.id === editingPhoto.locId);
            const item = loc?.items?.find(i => i.id === editingPhoto.itemId);
            if (item) {
              // Échelle durable (survit au reload) — même filet que l'éditeur.
              setPhotoAnnotPref(editingPhoto.photo?._id, { annotW: dims?.w, annotH: dims?.h, annotSizeScale: dims?.annotSizeScale });
              const updatedPhotos = (item.photos || []).map(p => p === editingPhoto.photo
                ? { ...p, annotations: paths, annotated: exported, annotW: dims?.w, annotH: dims?.h, annotSizeScale: dims?.annotSizeScale ?? null }
                : p);
              onUpdateItem(editingPhoto.locId, editingPhoto.itemId, { photos: updatedPhotos, _photosHydrated: true });
            }
            setEditingPhoto(null);
          }}
        />
      )}
    </div>
  );
}
