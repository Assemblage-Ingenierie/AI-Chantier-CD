import React, { useState } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from './Icons.jsx';

// Un champ Ingénieur(s) peut porter PLUSIEURS jeux d'initiales (« SV, TCM »).
// Stockage rétro-compatible : simple chaîne jointe par ", " — les valeurs existantes à une
// seule entrée restent valides telles quelles. Le filtre « Mes projets » découpe pareil.
export function splitInitials(s) {
  return String(s || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
}

// Éditeur multi-initiales COMPACT : puces (tap = retirer) + champ d'ajout + bouton « + »
// sur UNE seule rangée à hauteur FIXE (défilement horizontal si besoin).
// Partagé entre les visites (VisitesScreen) et la fiche projet (NewProjet / EditProjet).
//
// Deux contraintes issues des retours Thomas :
// 1. Le brouillon est committé à la perte de focus (onBlur) : cliquer « Valider » /
//    « Enregistrer » pendant qu'on tape des initiales ne les perd plus.
// 2. La hauteur ne doit JAMAIS changer quand une puce apparaît au blur : sinon le bouton
//    situé dessous se décale AVANT le relâchement du clic, qui « tombe à côté » — il
//    fallait cliquer deux fois. D'où la rangée unique à hauteur fixe (pas de flexWrap).
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
    <div style={{ display:'flex', alignItems:'center', gap:5, height:40, overflowX:'auto', overflowY:'hidden' }}>
      {list.map(ini => (
        <button key={ini} onClick={() => remove(ini)} title={`Retirer ${ini}`}
          style={{ display:'inline-flex', alignItems:'center', gap:4, flexShrink:0, background:DA.redL, color:DA.red,
            border:'1px solid rgba(185,28,28,0.2)', borderRadius:20, padding:'5px 9px', fontSize:12,
            fontWeight:800, letterSpacing:0.8, cursor:'pointer' }}>
          {ini} <Ic n="x" s={10}/>
        </button>
      ))}
      <input
        value={draft}
        onChange={e => setDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        onBlur={add}
        // Pas de « + » en placeholder : avec le bouton + à côté, on voyait DEUX plus (Thomas).
        placeholder={list.length ? '' : 'TCM'}
        maxLength={5}
        style={{ flex:1, minWidth:56, width:56, fontSize:15, fontWeight:800, color:DA.black,
          border:`1.5px solid ${DA.border}`, borderRadius:8, padding:'7px 6px', outline:'none',
          background:'white', boxSizing:'border-box', textTransform:'uppercase', letterSpacing:2,
          textAlign:'center' }}
      />
      <button onClick={add} disabled={draft.length < 2} title="Ajouter cet ingénieur"
        style={{ width:36, height:36, flexShrink:0, borderRadius:8, border:'none',
          cursor: draft.length < 2 ? 'default' : 'pointer',
          background: draft.length < 2 ? DA.grayXL : DA.red, color: draft.length < 2 ? DA.grayL : 'white',
          display:'flex', alignItems:'center', justifyContent:'center' }}>
        <Ic n="plus" s={15}/>
      </button>
    </div>
  );
}
