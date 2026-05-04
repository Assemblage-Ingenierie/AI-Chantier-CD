import React from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';

export default function VisitesScreen({ projet, onBack, onSelectVisite, onUpdateProjet }) {
  const visites = projet.visites || [];

  const formatDate = (d) => d
    ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' })
    : 'Sans date';

  const addVisite = () => {
    const newId = crypto.randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    // Pré-remplir les zones depuis la dernière visite (plans uniquement, sans obs ni annotations)
    const lastVisite = visites[visites.length - 1];
    const localisations = (lastVisite?.localisations || []).map(loc => ({
      id: crypto.randomUUID(),
      nom: loc.nom,
      planBg: loc.planBg || null,
      planData: loc.planData || null,
      planAnnotations: null,
      items: [],
    }));
    const newVisite = {
      id: newId,
      label: `Visite ${visites.length + 1}`,
      dateVisite: today,
      participants: [],
      tableauRecap: [],
      photosParLigne: 2,
      plansEnFin: false,
      rapportPageBreaks: [],
      includeTableauRecap: true,
      includeConclusion: false,
      conclusion: '',
      localisations,
    };
    onUpdateProjet({ visites: [...visites, newVisite] });
    onSelectVisite(newId);
  };

  const deleteVisite = (e, visiteId) => {
    e.stopPropagation();
    const v = visites.find(v => v.id === visiteId);
    const obsCount = (v?.localisations || []).flatMap(l => l.items || []).length;
    const msg = obsCount > 0
      ? `Supprimer "${v?.label || 'cette visite'}" et ses ${obsCount} observation${obsCount > 1 ? 's' : ''} ?`
      : `Supprimer "${v?.label || 'cette visite'}" ?`;
    if (!window.confirm(msg)) return;
    onUpdateProjet({ visites: visites.filter(vv => vv.id !== visiteId) });
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:DA.grayXL }}>

      {/* Header */}
      <div style={{ background:DA.black, padding:'12px 14px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <button onClick={onBack}
            style={{ color:'rgba(255,255,255,0.7)', background:'rgba(255,255,255,0.08)', border:'none', borderRadius:6, padding:'7px 10px', display:'flex', alignItems:'center', gap:3, cursor:'pointer', flexShrink:0 }}>
            <span style={{ display:'inline-block', transform:'rotate(90deg)', lineHeight:0 }}><Ic n="chv" s={14}/></span>
            <span style={{ fontSize:13, fontWeight:600 }}>Projets</span>
          </button>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ fontWeight:800, fontSize:16, color:'white', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{projet.nom}</p>
            {projet.adresse && <p style={{ fontSize:12, color:'rgba(255,255,255,0.45)', margin:'3px 0 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{projet.adresse}</p>}
          </div>
          <span style={{ fontSize:12, color:'rgba(255,255,255,0.4)', fontWeight:600, flexShrink:0 }}>{visites.length} visite{visites.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Liste des visites */}
      <div style={{ flex:1, overflowY:'auto' }}>
        {visites.length === 0 && (
          <div style={{ padding:'48px 24px', textAlign:'center' }}>
            <div style={{ width:48, height:48, borderRadius:12, background:DA.redL, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px', color:DA.red }}>
              <Ic n="fil" s={24}/>
            </div>
            <p style={{ fontWeight:700, fontSize:15, color:DA.black, margin:'0 0 6px' }}>Aucune visite</p>
            <p style={{ color:DA.gray, fontSize:12, margin:0 }}>Créez la première visite pour commencer.</p>
          </div>
        )}

        {[...visites].reverse().map(v => {
          const obsCount = (v.localisations || []).flatMap(l => l.items || []).length;
          const urgCount = (v.localisations || []).flatMap(l => l.items || []).filter(i => i.urgence === 'haute').length;
          const zonesCount = (v.localisations || []).length;
          return (
            <div key={v.id}
              onClick={() => onSelectVisite(v.id)}
              style={{ display:'flex', alignItems:'center', gap:12, padding:'16px 16px', background:'white', borderBottom:`1px solid ${DA.border}`, cursor:'pointer' }}>
              <div style={{ width:44, height:44, borderRadius:10, background:DA.redL, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, color:DA.red }}>
                <Ic n="fil" s={20}/>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ fontWeight:700, fontSize:15, color:DA.black, margin:0 }}>{v.label || 'Visite'}</p>
                <p style={{ fontSize:12, color:DA.gray, margin:'2px 0 0' }}>{formatDate(v.dateVisite)}</p>
                <div style={{ display:'flex', gap:5, marginTop:5, flexWrap:'wrap' }}>
                  {zonesCount > 0 && (
                    <span style={{ fontSize:11, color:DA.grayL, background:DA.grayXL, border:`1px solid ${DA.border}`, borderRadius:20, padding:'2px 8px' }}>
                      {zonesCount} zone{zonesCount > 1 ? 's' : ''}
                    </span>
                  )}
                  {obsCount > 0 && (
                    <span style={{ fontSize:11, color:DA.grayL, background:DA.grayXL, border:`1px solid ${DA.border}`, borderRadius:20, padding:'2px 8px', display:'inline-flex', alignItems:'center', gap:3 }}>
                      <Ic n="pin" s={9}/> {obsCount} obs
                    </span>
                  )}
                  {urgCount > 0 && (
                    <span style={{ fontSize:11, color:DA.red, background:DA.redL, border:`1px solid rgba(185,28,28,0.15)`, borderRadius:20, padding:'2px 8px', fontWeight:700 }}>
                      ⚠ {urgCount} urgente{urgCount > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
                {visites.length > 1 && (
                  <button onClick={e => deleteVisite(e, v.id)}
                    style={{ padding:'7px 8px', background:'none', border:'none', color:'#ccc', cursor:'pointer', borderRadius:8, display:'flex', alignItems:'center' }}
                    onMouseEnter={e => e.currentTarget.style.color = DA.red}
                    onMouseLeave={e => e.currentTarget.style.color = '#ccc'}>
                    <Ic n="del" s={15}/>
                  </button>
                )}
                <span style={{ color:DA.grayL, display:'flex', alignItems:'center', transform:'rotate(-90deg)' }}><Ic n="chv" s={16}/></span>
              </div>
            </div>
          );
        })}

        <button onClick={addVisite}
          style={{ width:'100%', padding:18, display:'flex', alignItems:'center', justifyContent:'center', gap:6, fontSize:15, fontWeight:700, color:'white', background:DA.red, border:'none', cursor:'pointer' }}>
          <Ic n="plus" s={16}/> Nouvelle visite
        </button>
      </div>
    </div>
  );
}
