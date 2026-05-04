import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DA, URGENCE } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import RapportPreview from './RapportPreview.jsx';
import ParticipantsEditor from './ParticipantsEditor.jsx';
import { exportPdf } from '../../lib/generateRapport.js';
import JSZip from 'jszip';

export default function RapportTab({ projet, onUpdate }) {
  const [exporting, setExporting] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 640);
  const localisations = projet.localisations || [];
  const allItems      = localisations.flatMap(l => l.items || []);

  useEffect(() => {
    const onResize = () => setPanelOpen(w => window.innerWidth >= 640 ? true : w);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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

  const [annotScale, setAnnotScale] = useState(() => {
    const v = parseFloat(localStorage.getItem('chantierai_annot_scale') ?? '1');
    return isNaN(v) ? 1 : v;
  });

  const handleAnnotScale = (v) => {
    setAnnotScale(v);
    localStorage.setItem('chantierai_annot_scale', String(v));
  };

  const pageBreaks = projet.rapportPageBreaks || [];

  const recapRows = useMemo(() => {
    if (projet.includeTableauRecap === false) return [];
    const urgOrder = { haute: 0, moyenne: 1, basse: 2 };
    const ovMap = new Map((projet.tableauRecap || []).map(r => [r.itemId, r]));
    return localisations.flatMap(loc =>
      (loc.items || []).filter(i => i.titre && i.suivi !== 'fait').map(i => {
        const ov = ovMap.get(i.id) || {};
        return {
          itemId: i.id,
          locNom:  'zone'     in ov ? ov.zone     : (loc.nom          || ''),
          titre:   'titre'    in ov ? ov.titre    : (i.titre           || ''),
          urgence: 'urgence'  in ov ? ov.urgence  : (i.urgence        || 'basse'),
          solution:'solution' in ov ? ov.solution : (i.commentaire    || ''),
        };
      })
    ).sort((a, b) => (urgOrder[a.urgence] ?? 2) - (urgOrder[b.urgence] ?? 2));
  }, [localisations, projet.includeTableauRecap, projet.tableauRecap]);

  const updateRecapField = useCallback((itemId, field, value) => {
    const curr = projet.tableauRecap || [];
    const has = curr.some(r => r.itemId === itemId);
    onUpdate({ tableauRecap: has
      ? curr.map(r => r.itemId === itemId ? { ...r, [field]: value } : r)
      : [...curr, { itemId, [field]: value }]
    });
  }, [projet.tableauRecap, onUpdate]);
  const togglePageBreak = (id) => {
    const curr = projet.rapportPageBreaks || [];
    onUpdate({ rapportPageBreaks: curr.includes(id) ? curr.filter(x => x !== id) : [...curr, id] });
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportPdf({
        projet,
        localisations,
        photosParLigne:       projet.photosParLigne ?? 2,
        rapportPageBreaks:    projet.rapportPageBreaks || [],
        plansEnFin:           projet.plansEnFin ?? false,
        includeTableauRecap:  projet.includeTableauRecap !== false,
        tableauRecap:         projet.tableauRecap || [],
        annotScale,
        includeConclusion:    projet.includeConclusion ?? false,
        conclusion:           projet.conclusion ?? '',
      });
    } catch (e) {
      console.error('Export PDF:', e);
      alert('Erreur lors de la génération du PDF : ' + (e.message || e));
    }
    setExporting(false);
  };

  const [zipping, setZipping] = useState(false);

  const handleExportPhotos = async () => {
    const allPhotos = localisations.flatMap(loc =>
      (loc.items || []).flatMap(item =>
        (item.photos || []).filter(ph => ph.data).map((ph, idx) => ({
          data: ph.data,
          name: ph.name || `photo_${idx + 1}.jpg`,
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
      const nomProjet = projet.nom ? sanitize(projet.nom) : 'rapport';
      a.href     = url;
      a.download = `${nomProjet}_photos.zip`;
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

  const [search, setSearch] = useState('');
  const filteredRecapRows = search.trim()
    ? recapRows.filter(r =>
        r.titre.toLowerCase().includes(search.toLowerCase()) ||
        r.locNom.toLowerCase().includes(search.toLowerCase())
      )
    : recapRows;

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden', position:'relative' }}>

      {/* ── Panneau gauche : paramètres ── */}
      {panelOpen && (
      <div style={{ width: isMobile ? '100%' : 272, borderRight:`1px solid ${DA.border}`, display:'flex', flexDirection:'column', flexShrink:0, background:DA.white, position: isMobile ? 'absolute' : 'relative', inset: isMobile ? 0 : 'auto', zIndex: isMobile ? 10 : 'auto' }}>

        {/* Boutons Export en haut — toujours visibles */}
        <div style={{ padding:'10px 12px', borderBottom:`1px solid ${DA.border}`, flexShrink:0, display:'flex', flexDirection:'column', gap:6 }}>
          <button
            onClick={handleExport}
            disabled={exporting || allItems.length === 0}
            style={{ width:'100%', padding:'11px 0', borderRadius:10, fontSize:13, fontWeight:800, border:'none',
              cursor: exporting || allItems.length === 0 ? 'not-allowed' : 'pointer',
              background: exporting || allItems.length === 0 ? DA.grayL : DA.red,
              color:'white', display:'flex', alignItems:'center', justifyContent:'center', gap:8,
              boxShadow: allItems.length > 0 ? '0 3px 10px rgba(227,5,19,0.3)' : 'none' }}>
            {exporting ? <Ic n="spn" s={14}/> : <Ic n="fil" s={14}/>}
            {exporting ? 'Génération…' : allItems.length === 0 ? 'Aucune observation' : 'Exporter PDF'}
          </button>

          {/* ZIP photos */}
          <button
            onClick={handleExportPhotos}
            disabled={zipping || totalPhotos === 0}
            style={{ width:'100%', padding:'9px 0', borderRadius:10, fontSize:12, fontWeight:700, border:'none',
              cursor: zipping || totalPhotos === 0 ? 'not-allowed' : 'pointer',
              background: zipping || totalPhotos === 0 ? DA.grayXL : '#1D4ED8',
              color: totalPhotos === 0 ? DA.grayL : 'white',
              display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
            {zipping ? <Ic n="spn" s={13}/> : <Ic n="dl" s={13}/>}
            {zipping ? 'Compression…' : totalPhotos === 0 ? 'Aucune photo' : `Télécharger photos ZIP (${totalPhotos})`}
          </button>
          {totalPhotos > 0 && (
            <p style={{ fontSize:9, color:DA.grayL, margin:0, textAlign:'center', fontStyle:'italic' }}>
              Organisé par zone / observation — prêt pour Drive
            </p>
          )}
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:12, display:'flex', flexDirection:'column', gap:10 }}>

          {/* Recherche */}
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px', background:DA.grayXL, borderRadius:10, border:`1px solid ${DA.border}` }}>
            <Ic n="txt" s={15}/>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filtrer les observations…"
              style={{ flex:1, border:'none', outline:'none', fontSize:14, color:DA.black, background:'transparent', fontFamily:'inherit' }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL, display:'flex' }}>
                <Ic n="x" s={13}/>
              </button>
            )}
          </div>

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
            <p style={{ fontSize:10, color:DA.gray, margin:'3px 0 0 22px' }}>
              Décoché = plans affichés après chaque zone
            </p>
          </div>

          {/* Taille des annotations sur plans */}
          <div>
            <label style={{ fontSize:10, fontWeight:700, color:DA.gray, display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:0.5 }}>
              Taille des légendes sur plans
            </label>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <input type="range" min="0.3" max="2" step="0.1" value={annotScale}
                onChange={e => handleAnnotScale(parseFloat(e.target.value))}
                style={{ flex:1, accentColor:DA.red, cursor:'pointer' }}/>
              <span style={{ fontSize:11, fontWeight:700, color:DA.black, minWidth:32, textAlign:'right' }}>{annotScale.toFixed(1)}×</span>
              {annotScale !== 1 && (
                <button onClick={() => handleAnnotScale(1)}
                  style={{ fontSize:10, color:DA.gray, background:'none', border:`1px solid ${DA.border}`, borderRadius:5, padding:'2px 7px', cursor:'pointer' }}>↺</button>
              )}
            </div>
            <p style={{ fontSize:9.5, color:DA.grayL, margin:'3px 0 0', fontStyle:'italic' }}>
              Affecte l'aperçu, le PDF et l'annotateur
            </p>
          </div>

          {/* Sauts de page actifs */}
          {pageBreaks.length > 0 && (
            <div style={{ background:'#FFF0F0', border:`1px solid #FCA5A5`, borderRadius:10, padding:10 }}>
              <p style={{ fontSize:10, fontWeight:700, color:DA.red, margin:'0 0 6px' }}>
                {pageBreaks.length} saut{pageBreaks.length > 1 ? 's' : ''} de page forcé{pageBreaks.length > 1 ? 's' : ''}
              </p>
              <button onClick={() => onUpdate({ rapportPageBreaks: [] })}
                style={{ fontSize:10, color:DA.red, background:'none', border:`1px solid #FCA5A5`, borderRadius:6, padding:'3px 8px', cursor:'pointer', fontWeight:600 }}>
                Tout effacer
              </button>
            </div>
          )}

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
            {projet.includeTableauRecap !== false && recapRows.length === 0 && (
              <p style={{ fontSize:10, color:DA.grayL, margin:'4px 0 0 22px' }}>Aucune observation non terminée</p>
            )}
            {projet.includeTableauRecap !== false && recapRows.length > 0 && (
              <div style={{ marginTop:8 }}>
                <p style={{ fontSize:9.5, color:DA.gray, margin:'0 0 6px', fontStyle:'italic' }}>
                  Solution pré-remplie depuis les commentaires — modifiable ici
                </p>
                <div style={{ border:`1px solid ${DA.border}`, borderRadius:8, overflow:'hidden' }}>
                  {filteredRecapRows.map((row, i) => {
                    const u = URGENCE[row.urgence] || URGENCE.basse;
                    return (
                      <div key={row.itemId} style={{ display:'grid', gridTemplateColumns:'4px 1fr', borderBottom: i < filteredRecapRows.length - 1 ? `1px solid ${DA.border}` : 'none', background: i%2===0 ? DA.grayXL : 'white' }}>
                        <div style={{ background:u.dot }}/>
                        <div style={{ padding:'7px 8px', display:'flex', flexDirection:'column', gap:5 }}>
                          {/* Zone */}
                          <div>
                            <label style={{ fontSize:8, fontWeight:700, color:DA.grayL, textTransform:'uppercase', letterSpacing:0.4, display:'block', marginBottom:2 }}>Zone</label>
                            <input
                              value={row.locNom}
                              onChange={e => updateRecapField(row.itemId, 'zone', e.target.value)}
                              placeholder="Zone / localisation…"
                              style={{ width:'100%', fontSize:10, border:`1px solid ${DA.border}`, borderRadius:5, padding:'4px 6px', outline:'none', fontFamily:'inherit', color:DA.black, background:'white', boxSizing:'border-box' }}
                            />
                          </div>
                          {/* Désordre */}
                          <div>
                            <label style={{ fontSize:8, fontWeight:700, color:DA.grayL, textTransform:'uppercase', letterSpacing:0.4, display:'block', marginBottom:2 }}>Désordre</label>
                            <input
                              value={row.titre}
                              onChange={e => updateRecapField(row.itemId, 'titre', e.target.value)}
                              placeholder="Désordre…"
                              style={{ width:'100%', fontSize:10, border:`1px solid ${DA.border}`, borderRadius:5, padding:'4px 6px', outline:'none', fontFamily:'inherit', color:DA.black, background:'white', boxSizing:'border-box' }}
                            />
                          </div>
                          {/* Urgence */}
                          <div>
                            <label style={{ fontSize:8, fontWeight:700, color:DA.grayL, textTransform:'uppercase', letterSpacing:0.4, display:'block', marginBottom:2 }}>Urgence</label>
                            <div style={{ display:'flex', gap:4 }}>
                              {['haute','moyenne','basse'].map(lvl => {
                                const uu = URGENCE[lvl];
                                const active = row.urgence === lvl;
                                return (
                                  <button key={lvl} onClick={() => updateRecapField(row.itemId, 'urgence', lvl)}
                                    style={{ flex:1, padding:'3px 0', borderRadius:5, fontSize:9, fontWeight:700, cursor:'pointer',
                                      border:`1.5px solid ${active ? uu.border : DA.border}`,
                                      background: active ? uu.bg : 'white',
                                      color: active ? uu.text : DA.grayL }}>
                                    {uu.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          {/* Solution */}
                          <div>
                            <label style={{ fontSize:8, fontWeight:700, color:DA.grayL, textTransform:'uppercase', letterSpacing:0.4, display:'block', marginBottom:2 }}>Solution</label>
                            <textarea
                              value={row.solution}
                              onChange={e => updateRecapField(row.itemId, 'solution', e.target.value)}
                              placeholder="Solution / action corrective…"
                              rows={2}
                              style={{ fontSize:10, border:`1px solid ${DA.border}`, borderRadius:5, padding:'4px 6px', outline:'none', resize:'vertical', fontFamily:'inherit', color:DA.black, lineHeight:1.4, background:'white', boxSizing:'border-box', width:'100%' }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
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
              <textarea
                value={projet.conclusion ?? ''}
                onChange={e => onUpdate({ conclusion: e.target.value })}
                placeholder="Saisissez votre conclusion…"
                rows={5}
                style={{ marginTop:8, width:'100%', fontSize:11, border:`1px solid ${DA.border}`, borderRadius:8, padding:'8px 10px', outline:'none', boxSizing:'border-box', fontFamily:'inherit', resize:'vertical', color:DA.black, lineHeight:1.5 }}
              />
            )}
          </div>
        </div>

      </div>
      )}

      {/* ── Panneau droit : aperçu A4 ── */}
      <RapportPreview
        projet={projet}
        localisations={localisations}
        photosParLigne={projet.photosParLigne ?? 2}
        pageBreaks={pageBreaks}
        onTogglePageBreak={togglePageBreak}
        plansEnFin={projet.plansEnFin ?? false}
        includeTableauRecap={projet.includeTableauRecap !== false}
        tableauRecap={projet.tableauRecap || []}
        annotScale={annotScale}
        onAnnotScaleChange={handleAnnotScale}
        includeConclusion={projet.includeConclusion ?? false}
        conclusion={projet.conclusion ?? ''}
        onUpdateItem={onUpdateItem}
        onTogglePanel={() => setPanelOpen(v => !v)}
        panelOpen={panelOpen}
      />
    </div>
  );
}
