import React, { useState, useEffect } from 'react';
import { DA, URGENCE, SUIVI } from '../../lib/constants.js';
import { Ic, BadgeSuivi } from '../ui/Icons.jsx';
import { callAIProxy } from '../../lib/aiProxy.js';

export default function TableauRecap({ localisations, tableauData, onUpdate }) {
  const allItems = localisations.flatMap(loc => {
    const items = loc.sections?.length ? loc.sections.flatMap(s => s.items||[]) : loc.items||[];
    return items.map(it => ({ ...it, _locNom: loc.nom }));
  });

  const derivedRows = allItems.filter(i => i.urgence !== 'basse').map(it => ({
    id: it.id,
    urgence: it.urgence,
    locNom: it._locNom,
    desordre: it.titre + (it.commentaire ? ` — ${it.commentaire.slice(0,80)}` : ''),
    travaux: '',
    suivi: 'rien',
  }));

  const derivedRowsKey = JSON.stringify(derivedRows.map(r => ({ id:r.id, urgence:r.urgence, locNom:r.locNom, desordre:r.desordre })));

  const [rows, setRows] = useState(() => tableauData?.length ? tableauData : derivedRows.map(r => ({ ...r })));
  const [genLoading, setGenLoading] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [editField, setEditField] = useState(null);
  const [editVal, setEditVal] = useState('');

  useEffect(() => {
    const derivedIds = new Set(derivedRows.map(r => r.id));
    const manualRows = rows.filter(r => !derivedIds.has(r.id));
    const next = [
      ...derivedRows.map(row => {
        const existing = rows.find(r => r.id === row.id);
        return existing ? { ...existing, urgence: row.urgence, locNom: row.locNom, desordre: row.desordre } : row;
      }),
      ...manualRows,
    ];
    if (JSON.stringify(next) !== JSON.stringify(rows)) { setRows(next); onUpdate(next); }
  }, [derivedRowsKey]); // eslint-disable-line

  const commit = () => {
    if (editRow === null) return;
    const next = rows.map((r, i) => i === editRow ? { ...r, [editField]: editVal } : r);
    setRows(next); onUpdate(next); setEditRow(null); setEditField(null);
  };

  const addRow = () => {
    const next = [...rows, { id: Date.now(), urgence:'moyenne', locNom:'', desordre:'', travaux:'', suivi:'rien' }];
    setRows(next); onUpdate(next);
  };

  const delRow = i => { const next = rows.filter((_, j) => j !== i); setRows(next); onUpdate(next); };

  const cycleUrgence = i => {
    const next = rows.map((r, j) => j === i ? { ...r, urgence: r.urgence==='haute'?'moyenne':r.urgence==='moyenne'?'basse':'haute' } : r);
    setRows(next); onUpdate(next);
  };

  const cycleSuivi = i => {
    const keys = Object.keys(SUIVI);
    const next = rows.map((r, j) => j === i ? { ...r, suivi: keys[(keys.indexOf(r.suivi||'rien')+1)%keys.length] } : r);
    setRows(next); onUpdate(next);
  };

  const genAutoIA = async () => {
    if (!allItems.length) return;
    setGenLoading(true);
    try {
      const obs = allItems.map(it => `- [${it._locNom}] [${it.urgence}] ${it.titre}${it.commentaire ? ' : ' + it.commentaire.slice(0,100) : ''}`).join('\n');
      const d = await callAIProxy({
        feature: 'recap-generation',
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        system: 'Expert MOE/BET batiment. Reponds UNIQUEMENT en JSON array. Pas de texte autour.',
        messages: [{ role:'user', content: `Observations de visite chantier :\n${obs}\n\nGenere un tableau recapitulatif JSON avec UNIQUEMENT les observations urgentes et a planifier (pas les mineures).\nFormat strict : [{"urgence":"haute|moyenne|basse","locNom":"zone","desordre":"description courte 1 phrase","travaux":"action preconisee courte"}]\nSois succinct et professionnel. Max 15 mots par champ.` }],
      });
      const txt = d.content?.[0]?.text || '[]';
      const parsed = JSON.parse(txt.replace(/```json|```/g, '').trim());
      const next = parsed.map((row, i) => ({ ...row, id: Date.now() + i, suivi: 'rien' }));
      setRows(next); onUpdate(next);
    } catch (e) {
      console.error('IA tableau:', e);
      alert(e.message || 'Fonction IA indisponible');
    }
    setGenLoading(false);
  };

  return (
    <div style={{ background:DA.white,border:`1px solid ${DA.border}`,borderRadius:12,overflow:'hidden' }}>
      <div style={{ padding:'12px 16px',borderBottom:`3px solid ${DA.red}`,display:'flex',alignItems:'center',justifyContent:'space-between',gap:8 }}>
        <div style={{ display:'flex',alignItems:'center',gap:8 }}>
          <Ic n="tbl" s={16}/>
          <p style={{ fontWeight:700,fontSize:13,color:DA.black,margin:0 }}>Tableau récapitulatif</p>
          <span style={{ fontSize:10,color:DA.grayL }}>{rows.length} ligne{rows.length!==1?'s':''}</span>
        </div>
        <div style={{ display:'flex',gap:6 }}>
          <button onClick={genAutoIA} disabled={genLoading || !allItems.length}
            style={{ fontSize:11,display:'flex',alignItems:'center',gap:4,color:'#7C3AED',background:'#F5F3FF',border:'1px solid #DDD6FE',borderRadius:20,padding:'4px 10px',cursor:'pointer',fontWeight:600,opacity:genLoading?0.6:1 }}>
            {genLoading ? <Ic n="spn" s={10}/> : <Ic n="spk" s={10}/>} {genLoading ? 'Génération…' : 'Auto IA'}
          </button>
          <button onClick={addRow} style={{ fontSize:11,display:'flex',alignItems:'center',gap:4,color:DA.red,background:'none',border:'none',cursor:'pointer',fontWeight:600 }}>
            <Ic n="plus" s={12}/> Ligne
          </button>
        </div>
      </div>

      {rows.length === 0 && (
        <div style={{ textAlign:'center',padding:'20px 16px' }}>
          <p style={{ fontSize:12,color:DA.grayL,margin:'0 0 10px' }}>Aucune ligne — ajoutez manuellement ou utilisez Auto IA</p>
        </div>
      )}

      {rows.map((row, i) => {
        const u = URGENCE[row.urgence || 'moyenne'];
        return (
          <div key={row.id||i} style={{ display:'flex',alignItems:'stretch',borderBottom:`1px solid ${DA.border}` }}>
            <div onClick={() => cycleUrgence(i)} style={{ width:5,background:u.dot,cursor:'pointer',flexShrink:0 }} title="Cliquer pour changer urgence"/>
            <div style={{ padding:'8px 12px',flex:1 }}>
              <div style={{ display:'flex',alignItems:'center',gap:6,marginBottom:6,flexWrap:'wrap' }}>
                {row.locNom && <span style={{ fontSize:10,background:DA.grayXL,color:DA.gray,padding:'1px 6px',borderRadius:4,fontWeight:600 }}>{row.locNom}</span>}
                <span onClick={() => cycleUrgence(i)} style={{ display:'inline-flex',alignItems:'center',gap:3,padding:'1px 8px',borderRadius:4,fontSize:10,fontWeight:700,background:u.bg,color:u.text,border:`1px solid ${u.border}`,cursor:'pointer' }}>
                  <span style={{ width:5,height:5,borderRadius:'50%',background:u.dot }}/>{u.label}
                </span>
                <BadgeSuivi suivi={row.suivi||'rien'} small onClick={() => cycleSuivi(i)}/>
                <button onClick={() => delRow(i)} style={{ marginLeft:'auto',color:'#ddd',background:'none',border:'none',cursor:'pointer',padding:2 }}
                  onMouseEnter={e=>e.currentTarget.style.color=DA.red} onMouseLeave={e=>e.currentTarget.style.color='#ddd'}>
                  <Ic n="del" s={12}/>
                </button>
              </div>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8 }}>
                {['desordre','travaux'].map(field => (
                  <div key={field}>
                    <p style={{ fontSize:9,fontWeight:700,color:DA.gray,textTransform:'uppercase',letterSpacing:0.4,margin:'0 0 3px' }}>{field==='desordre'?'Désordre':'Travaux préconisés'}</p>
                    {editRow===i && editField===field
                      ? <textarea autoFocus value={editVal} onChange={e=>setEditVal(e.target.value)} onBlur={commit} rows={2}
                          style={{ width:'100%',fontSize:11,border:`1px solid ${DA.red}`,borderRadius:6,padding:'3px 6px',outline:'none',resize:'none',fontFamily:'inherit',boxSizing:'border-box' }}/>
                      : <p style={{ fontSize:11,color:DA.black,cursor:'text',minHeight:18,lineHeight:1.4,margin:0 }}
                          onClick={() => { setEditRow(i); setEditField(field); setEditVal(row[field]); }}>
                          {row[field] || <span style={{ color:DA.grayL,fontStyle:'italic' }}>{field==='desordre'?'Cliquer pour saisir…':'Travaux à définir…'}</span>}
                        </p>
                    }
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}

      <div style={{ padding:'6px 14px',fontSize:9,color:DA.grayL,background:DA.grayXL }}>
        💡 Bande colorée = urgence · Pastille = suivi · Cliquez texte pour éditer
      </div>
    </div>
  );
}
