import React, { useState } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from './Icons.jsx';

// Un champ Ingénieur(s) peut porter PLUSIEURS jeux d'initiales (« SV, TCM »).
// Stockage rétro-compatible : simple chaîne jointe par ", " — les valeurs existantes à une
// seule entrée restent valides telles quelles. Le filtre « Mes projets » découpe pareil.
export function splitInitials(s) {
  return String(s || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
}

// Éditeur multi-initiales : puces (tap = retirer) + champ d'ajout (Entrée / bouton +).
// Partagé entre les visites (VisitesScreen) et la fiche projet (NewProjet / EditProjet).
// Le brouillon est aussi COMMITTÉ à la perte de focus (onBlur) : cliquer « Valider » /
// « Créer le projet » pendant qu'on tape des initiales ne les perd plus (demande Thomas).
export default function IngenieursEditor({ value, onChange }) {
  const [draft, setDraft] = useState('');
  const list = splitInitials(value);
  const add = () => {
    const v = draft.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (v.length < 2 || list.includes(v)) { setDraft(''); return; }
    onChange([...list, v].join(', '));
    setDraft('');
  };
  const remove = (ini) => onChange(list.filter(x => x !== ini).join(', '));
  return (
    <div>
      {list.length > 0 && (
        <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:6 }}>
          {list.map(ini => (
            <button key={ini} onClick={() => remove(ini)} title={`Retirer ${ini}`}
              style={{ display:'inline-flex', alignItems:'center', gap:5, background:DA.redL, color:DA.red,
                border:'1px solid rgba(185,28,28,0.2)', borderRadius:20, padding:'6px 10px', fontSize:13,
                fontWeight:800, letterSpacing:1, cursor:'pointer' }}>
              {ini} <Ic n="x" s={11}/>
            </button>
          ))}
        </div>
      )}
      <div style={{ display:'flex', gap:6 }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          onBlur={add}
          placeholder={list.length ? 'Ajouter…' : 'TCM'}
          maxLength={5}
          style={{ flex:1, minWidth:0, fontSize:16, fontWeight:800, color:DA.black, border:`1.5px solid ${DA.border}`,
            borderRadius:8, padding:'9px 10px', outline:'none', background:'white', boxSizing:'border-box',
            textTransform:'uppercase', letterSpacing:3, textAlign:'center' }}
        />
        <button onClick={add} disabled={draft.length < 2} title="Ajouter cet ingénieur"
          style={{ width:44, flexShrink:0, borderRadius:8, border:'none', cursor: draft.length < 2 ? 'default' : 'pointer',
            background: draft.length < 2 ? DA.grayXL : DA.red, color: draft.length < 2 ? DA.grayL : 'white',
            display:'flex', alignItems:'center', justifyContent:'center' }}>
          <Ic n="plus" s={16}/>
        </button>
      </div>
    </div>
  );
}
