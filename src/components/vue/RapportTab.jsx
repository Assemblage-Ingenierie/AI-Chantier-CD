import React, { useState } from 'react';
import { DA, URGENCE } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import TableauRecap from './TableauRecap.jsx';
import { exportPdf } from '../../lib/generateRapport.js';

export default function RapportTab({ projet, onUpdate }) {
  const [exporting, setExporting] = useState(false);
  const localisations = projet.localisations || [];

  const allItems = localisations.flatMap(l => l.items || []);
  const urgCounts = Object.fromEntries(
    Object.keys(URGENCE).map(k => [k, allItems.filter(i => i.urgence === k).length])
  );

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportPdf({
        projet,
        localisations,
        tableauRecap: projet.tableauRecap || [],
        photosParLigne: projet.photosParLigne ?? 2,
      });
    } catch (e) {
      console.error('Export PDF:', e);
      alert('Erreur lors de la génération du PDF : ' + (e.message || e));
    }
    setExporting(false);
  };

  return (
    <div style={{ height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>

      {/* Contenu scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, paddingBottom: 96, display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Résumé */}
        <div style={{ background: DA.white, borderRadius: 12, padding: 14, border: `1px solid ${DA.border}` }}>
          <p style={{ fontWeight: 700, fontSize: 13, color: DA.black, margin: '0 0 10px' }}>Résumé</p>
          <p style={{ fontSize: 13, color: DA.black, margin: '0 0 8px' }}>
            {allItems.length} obs. · {localisations.length} zone{localisations.length !== 1 ? 's' : ''}
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(URGENCE).map(([k, u]) =>
              urgCounts[k] > 0 ? (
                <span key={k} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: u.bg, color: u.text, border: `1px solid ${u.border}` }}>
                  {urgCounts[k]} {u.label.toLowerCase()}
                </span>
              ) : null
            )}
          </div>
        </div>

        {/* Maître d'ouvrage */}
        <div style={{ background: DA.white, borderRadius: 12, padding: 14, border: `1px solid ${DA.border}` }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: DA.gray, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Maître d'ouvrage
          </label>
          <input
            value={projet.maitreOuvrage || ''}
            onChange={e => onUpdate({ maitreOuvrage: e.target.value })}
            placeholder="Nom du maître d'ouvrage…"
            style={{ width: '100%', fontSize: 13, border: `1px solid ${DA.border}`, borderRadius: 8, padding: '8px 12px', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
          />
        </div>

        {/* Date de visite */}
        <div style={{ background: DA.white, borderRadius: 12, padding: 14, border: `1px solid ${DA.border}` }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: DA.gray, display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Date de la visite
          </label>
          <input
            type="date"
            value={projet.dateVisite || ''}
            onChange={e => onUpdate({ dateVisite: e.target.value || null })}
            style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: `1px solid ${DA.border}`, fontSize: 13, color: DA.black, background: DA.white, outline: 'none', fontFamily: 'inherit' }}
          />
        </div>

        {/* Photos par ligne */}
        <div style={{ background: DA.white, borderRadius: 12, padding: 14, border: `1px solid ${DA.border}` }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: DA.gray, display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Photos par ligne dans le rapport
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[1, 2, 3].map(n => (
              <button
                key={n}
                onClick={() => onUpdate({ photosParLigne: n })}
                style={{ flex: 1, padding: '8px', borderRadius: 10, fontSize: 13, fontWeight: 700, border: `2px solid ${(projet.photosParLigne ?? 2) === n ? DA.red : DA.border}`, background: (projet.photosParLigne ?? 2) === n ? DA.redL : DA.white, color: (projet.photosParLigne ?? 2) === n ? DA.red : DA.gray, cursor: 'pointer' }}>
                {n} {n === 1 ? 'photo' : 'photos'}
              </button>
            ))}
          </div>
        </div>

        {/* Tableau récapitulatif */}
        <TableauRecap
          localisations={localisations}
          tableauData={projet.tableauRecap}
          onUpdate={rows => onUpdate({ tableauRecap: rows })}
        />

      </div>

      {/* Bouton Exporter — sticky en bas */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '12px 16px', background: 'linear-gradient(to top, rgba(244,245,247,1) 70%, rgba(244,245,247,0))', pointerEvents: 'none' }}>
        <button
          onClick={handleExport}
          disabled={exporting || allItems.length === 0}
          style={{ pointerEvents: 'all', width: '100%', padding: '14px 0', borderRadius: 14, fontSize: 14, fontWeight: 800, border: 'none', cursor: exporting || allItems.length === 0 ? 'not-allowed' : 'pointer', background: exporting || allItems.length === 0 ? DA.grayL : DA.red, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'background 0.15s', boxShadow: '0 4px 16px rgba(227,5,19,0.3)' }}>
          {exporting ? <Ic n="spn" s={16} /> : <Ic n="fil" s={16} />}
          {exporting ? 'Génération en cours…' : allItems.length === 0 ? 'Aucune observation à exporter' : 'Exporter le rapport PDF'}
        </button>
      </div>

    </div>
  );
}
