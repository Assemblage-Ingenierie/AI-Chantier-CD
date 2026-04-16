import React, { useState } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';

export const ASSEMBLAGE_TEAM = [
  { nom: 'Pierre Esselinck',          poste: 'Président',                    email: 'pierre@assemblage.net' },
  { nom: 'Clément Davy',              poste: 'Ingénieur Associé',            email: 'clement@assemblage.net' },
  { nom: 'Thomas Cassetari-Moureaux', poste: 'Ingénieur Structure',          email: 'thomas@assemblage.net' },
  { nom: 'Thibaud Cravatte',          poste: 'Ingénieur Structure',          email: 'thibaud@assemblage.net' },
  { nom: 'Stanislav Varvarici',       poste: 'Ingénieur Structure',          email: 'stanislav@assemblage.net' },
  { nom: 'Maël Bhoyroo',             poste: 'Ingénieur Structure',          email: 'mael@assemblage.net' },
  { nom: 'Malo Babinet',              poste: 'Ingénieur Structure & Amb.',   email: 'malo@assemblage.net' },
  { nom: 'Gabriel Piens',             poste: 'Ingénieur Structure',          email: 'gabriel@assemblage.net' },
  { nom: 'Alexandra Ekima N Demba',   poste: 'Dessinatrice-Projeteuse',      email: 'alexandra@assemblage.net' },
  { nom: 'Aliénor Faucher',          poste: 'Co-resp. Développement',       email: 'alienor@assemblage.net' },
  { nom: 'Amaury Monnier',            poste: "Chargé d'étude",               email: 'amaury@assemblage.net' },
  { nom: 'Chaïma Sghaier',           poste: 'Assistante MOA',               email: 'chaima@assemblage.net' },
  { nom: 'Lou Vincent de Lestrade',   poste: 'Chargée de projet AMO',        email: 'lou@assemblage.net' },
  { nom: 'Louis Jault',               poste: 'Chargé de projet AMO',         email: 'louis@assemblage.net' },
  { nom: 'Margot Vast',               poste: "Chargée d'études",             email: 'margot@assemblage.net' },
  { nom: 'Guillaume Boudry',          poste: 'Ingénieur Structure',          email: 'guillaume@assemblage.net' },
  { nom: 'Axelle Besson',             poste: 'Gestion',                      email: 'gestion@assemblage.net' },
];

const EMPTY = { nom: '', poste: '', email: '', tel: '' };

export default function ParticipantsEditor({ participants = [], onChange }) {
  const [showPicker, setShowPicker] = useState(false);
  const [showForm,   setShowForm]   = useState(false);
  const [form,       setForm]       = useState(EMPTY);
  const [search,     setSearch]     = useState('');

  const add    = (p) => onChange([...participants, { ...p, id: crypto.randomUUID() }]);
  const remove = (id) => onChange(participants.filter(p => p.id !== id));

  const added = new Set(participants.map(p => p.email));

  const filtered = ASSEMBLAGE_TEAM.filter(t =>
    !search || t.nom.toLowerCase().includes(search.toLowerCase()) || t.poste.toLowerCase().includes(search.toLowerCase())
  );

  const addExternal = () => {
    if (!form.nom.trim()) return;
    add({ ...form, isAssemblage: false });
    setForm(EMPTY);
    setShowForm(false);
  };

  return (
    <div>
      <label style={{ fontSize:10, fontWeight:700, color:DA.gray, display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:0.5 }}>
        Intervenants {participants.length > 0 && `(${participants.length})`}
      </label>

      {/* Liste des participants ajoutés */}
      {participants.length > 0 && (
        <div style={{ display:'flex', flexDirection:'column', gap:3, marginBottom:8 }}>
          {participants.map(p => (
            <div key={p.id} style={{ display:'flex', alignItems:'center', gap:6, background:DA.grayXL, borderRadius:8, padding:'6px 8px', border:`1px solid ${DA.border}` }}>
              {p.isAssemblage
                ? <span style={{ fontSize:8, fontWeight:900, color:DA.red, background:'#FFF0F0', borderRadius:4, padding:'2px 5px', flexShrink:0, letterSpacing:0.3 }}>A</span>
                : <Ic n="usr" s={12}/>
              }
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:11, fontWeight:700, color:DA.black, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.nom}</div>
                <div style={{ fontSize:9, color:DA.gray, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {[p.poste, p.email].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button onClick={() => remove(p.id)} style={{ color:DA.grayL, background:'none', border:'none', cursor:'pointer', flexShrink:0, padding:2 }}>
                <Ic n="x" s={12}/>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Picker Assemblage */}
      {showPicker && (
        <div style={{ background:'white', border:`1px solid ${DA.border}`, borderRadius:8, marginBottom:8, boxShadow:'0 2px 10px rgba(0,0,0,0.1)' }}>
          <div style={{ padding:'6px 8px', borderBottom:`1px solid ${DA.border}` }}>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher…"
              style={{ width:'100%', fontSize:11, border:`1px solid ${DA.border}`, borderRadius:6, padding:'5px 8px', outline:'none', boxSizing:'border-box', fontFamily:'inherit' }}
            />
          </div>
          <div style={{ maxHeight:180, overflowY:'auto' }}>
            {filtered.map(t => {
              const isAdded = added.has(t.email);
              const initials = t.nom.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('');
              return (
                <div key={t.email}
                  onClick={() => { if (!isAdded) { add({ ...t, isAssemblage: true }); } }}
                  style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', cursor: isAdded ? 'default' : 'pointer',
                    opacity: isAdded ? 0.4 : 1, borderBottom:`1px solid ${DA.border}`,
                    background:'white', transition:'background 0.1s' }}
                  onMouseEnter={e => { if (!isAdded) e.currentTarget.style.background = DA.grayXL; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'white'; }}>
                  <div style={{ width:24, height:24, borderRadius:'50%', background:DA.red, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <span style={{ fontSize:8, fontWeight:800, color:'white' }}>{initials}</span>
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:DA.black }}>{t.nom}</div>
                    <div style={{ fontSize:9, color:DA.gray }}>{t.poste}</div>
                  </div>
                  {isAdded && <span style={{ fontSize:9, color:DA.grayL }}>✓</span>}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding:12, fontSize:11, color:DA.grayL, textAlign:'center' }}>Aucun résultat</div>
            )}
          </div>
        </div>
      )}

      {/* Formulaire contact externe */}
      {showForm && (
        <div style={{ background:DA.grayXL, border:`1px solid ${DA.border}`, borderRadius:8, padding:10, marginBottom:8 }}>
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            {[['nom','Nom *'],['poste','Poste / Société'],['email','Email'],['tel','Téléphone']].map(([k, lbl]) => (
              <input key={k}
                value={form[k]}
                onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && k === 'tel' && addExternal()}
                placeholder={lbl}
                style={{ width:'100%', fontSize:11, border:`1px solid ${DA.border}`, borderRadius:6, padding:'5px 8px', outline:'none', boxSizing:'border-box', fontFamily:'inherit', background:'white' }}
              />
            ))}
          </div>
          <div style={{ display:'flex', gap:6, marginTop:8 }}>
            <button onClick={addExternal} disabled={!form.nom.trim()}
              style={{ flex:1, padding:'6px 0', borderRadius:8, fontSize:11, fontWeight:700, border:'none',
                background: form.nom.trim() ? DA.black : DA.grayL,
                color:'white', cursor: form.nom.trim() ? 'pointer' : 'not-allowed' }}>
              Ajouter
            </button>
            <button onClick={() => { setShowForm(false); setForm(EMPTY); }}
              style={{ padding:'6px 10px', borderRadius:8, fontSize:11, border:`1px solid ${DA.border}`, background:'white', color:DA.gray, cursor:'pointer' }}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Boutons d'ajout */}
      <div style={{ display:'flex', gap:6 }}>
        <button
          onClick={() => { setShowPicker(!showPicker); setShowForm(false); if (!showPicker) setSearch(''); }}
          style={{ flex:1, fontSize:10, fontWeight:700, padding:'6px 4px', borderRadius:8,
            border:`1.5px solid ${showPicker ? DA.red : DA.border}`,
            background: showPicker ? DA.redL : 'white',
            color: showPicker ? DA.red : DA.gray, cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
          <span style={{ fontSize:9, fontWeight:900, color: showPicker ? DA.red : DA.gray }}>A!</span>
          Assemblage
        </button>
        <button
          onClick={() => { setShowForm(!showForm); setShowPicker(false); }}
          style={{ flex:1, fontSize:10, fontWeight:700, padding:'6px 4px', borderRadius:8,
            border:`1.5px solid ${showForm ? DA.red : DA.border}`,
            background: showForm ? DA.redL : 'white',
            color: showForm ? DA.red : DA.gray, cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
          <Ic n="usr" s={10}/>
          Externe
        </button>
      </div>
    </div>
  );
}
