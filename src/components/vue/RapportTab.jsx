import React, { useState } from 'react';
import { DA, URGENCE } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import RapportPreview from './RapportPreview.jsx';
import ParticipantsEditor from './ParticipantsEditor.jsx';
import { exportPdf } from '../../lib/generateRapport.js';

export default function RapportTab({ projet, onUpdate }) {
  const [exporting, setExporting] = useState(false);
  const localisations = projet.localisations || [];
  const allItems      = localisations.flatMap(l => l.items || []);

  const pageBreaks = projet.rapportPageBreaks || [];
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
      });
    } catch (e) {
      console.error('Export PDF:', e);
      alert('Erreur lors de la génération du PDF : ' + (e.message || e));
    }
    setExporting(false);
  };

  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden' }}>

      {/* ── Panneau gauche : paramètres ── */}
      <div style={{ width:272, borderRight:`1px solid ${DA.border}`, display:'flex', flexDirection:'column', flexShrink:0, background:DA.white }}>
        <div style={{ flex:1, overflowY:'auto', padding:12, display:'flex', flexDirection:'column', gap:10 }}>

          {/* Résumé */}
          <div style={{ background:DA.grayXL, borderRadius:10, padding:12, border:`1px solid ${DA.border}` }}>
            <p style={{ fontWeight:700, fontSize:12, color:DA.black, margin:'0 0 5px' }}>Résumé</p>
            <p style={{ fontSize:12, color:DA.gray, margin:'0 0 6px' }}>
              {allItems.length} obs. · {localisations.length} zone{localisations.length !== 1 ? 's' : ''}
            </p>
            <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
              {Object.entries(URGENCE).map(([k, u]) => {
                const n = allItems.filter(i => i.urgence === k).length;
                return n > 0 ? (
                  <span key={k} style={{ fontSize:10, padding:'1px 6px', borderRadius:4, background:u.bg, color:u.text, border:`1px solid ${u.border}` }}>
                    {n} {u.label.toLowerCase()}
                  </span>
                ) : null;
              })}
            </div>
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
              <span style={{ fontSize:12, fontWeight:600, color:DA.black }}>Tableau récapitulatif en fin</span>
            </label>
            <p style={{ fontSize:10, color:DA.gray, margin:'3px 0 0 22px' }}>
              Auto-généré depuis les observations non terminées
            </p>
          </div>
        </div>

        {/* Bouton Export */}
        <div style={{ padding:'10px 12px', borderTop:`1px solid ${DA.border}`, flexShrink:0 }}>
          <button
            onClick={handleExport}
            disabled={exporting || allItems.length === 0}
            style={{ width:'100%', padding:'12px 0', borderRadius:12, fontSize:13, fontWeight:800, border:'none',
              cursor: exporting || allItems.length === 0 ? 'not-allowed' : 'pointer',
              background: exporting || allItems.length === 0 ? DA.grayL : DA.red,
              color:'white', display:'flex', alignItems:'center', justifyContent:'center', gap:8,
              boxShadow: allItems.length > 0 ? '0 4px 12px rgba(227,5,19,0.3)' : 'none' }}>
            {exporting ? <Ic n="spn" s={14}/> : <Ic n="fil" s={14}/>}
            {exporting ? 'Génération…' : allItems.length === 0 ? 'Aucune observation' : 'Exporter PDF'}
          </button>
        </div>
      </div>

      {/* ── Panneau droit : aperçu A4 ── */}
      <RapportPreview
        projet={projet}
        localisations={localisations}
        photosParLigne={projet.photosParLigne ?? 2}
        pageBreaks={pageBreaks}
        onTogglePageBreak={togglePageBreak}
        plansEnFin={projet.plansEnFin ?? false}
        includeTableauRecap={projet.includeTableauRecap !== false}
      />
    </div>
  );
}
