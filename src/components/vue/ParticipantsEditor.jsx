import React, { useState } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { loadGlobalContacts, saveGlobalContact, deleteGlobalContact } from '../../lib/contacts.js';

export const ASSEMBLAGE_TEAM = [
  { nom: 'Pierre Esselinck',          poste: 'Président',                    email: 'pierre@assemblage.net',     tel: '07 86 51 55 48' },
  { nom: 'Clément Davy',              poste: 'Ingénieur Associé',            email: 'clement@assemblage.net',    tel: '' },
  { nom: 'Thomas Cassetari-Moureaux', poste: 'Ingénieur Structure',          email: 'thomas@assemblage.net',     tel: '06 61 68 68 08' },
  { nom: 'Thibaud Cravatte',          poste: 'Ingénieur Structure',          email: 'thibaud@assemblage.net',    tel: '07 61 41 36 17' },
  { nom: 'Stanislav Varvarici',       poste: 'Ingénieur Structure',          email: 'stanislav@assemblage.net',  tel: '' },
  { nom: 'Maël Bhoyroo',             poste: 'Ingénieur Structure',          email: 'mael@assemblage.net',       tel: '06 32 55 82 81' },
  { nom: 'Malo Babinet',              poste: 'Ingénieur Structure & Amb.',   email: 'malo@assemblage.net',       tel: '06 99 34 88 60' },
  { nom: 'Gabriel Piens',             poste: 'Ingénieur Structure',          email: 'gabriel@assemblage.net',    tel: '06 67 50 77 06' },
  { nom: 'Alexandra Ekima N Demba',   poste: 'Dessinatrice-Projeteuse',      email: 'alexandra@assemblage.net',  tel: '07 61 76 34 06' },
  { nom: 'Aliénor Faucher',          poste: 'Co-resp. Développement',       email: 'alienor@assemblage.net',    tel: '06 98 46 30 66' },
  { nom: 'Amaury Monnier',            poste: "Chargé d'étude",               email: 'amaury@assemblage.net',     tel: '06 69 08 68 94' },
  { nom: 'Chaïma Sghaier',           poste: 'Assistante MOA',               email: 'chaima@assemblage.net',     tel: '06 98 41 97 29' },
  { nom: 'Lou Vincent de Lestrade',   poste: 'Chargée de projet AMO',        email: 'lou@assemblage.net',        tel: '07 84 45 61 63' },
  { nom: 'Louis Jault',               poste: 'Chargé de projet AMO',         email: 'louis@assemblage.net',      tel: '' },
  { nom: 'Margot Vast',               poste: "Chargée d'études",             email: 'margot@assemblage.net',     tel: '06 62 95 67 93' },
  { nom: 'Guillaume Boudry',          poste: 'Ingénieur Structure',          email: 'guillaume@assemblage.net',  tel: '06 61 39 94 56' },
  { nom: 'Axelle Besson',             poste: 'Gestion',                      email: 'gestion@assemblage.net',    tel: '07 65 62 30 87' },
];

const EMPTY = { nom: '', poste: '', email: '', tel: '' };
const BADGE_W = 24;

// ── Ligne participant ──────────────────────────────────────────────────────────
function ParticipantRow({ p, onRemove, onToggle, onMoveUp, onMoveDown }) {
  const isPresent = !p.presence || p.presence === 'present';
  return (
    <div style={{ display:'flex', alignItems:'center', gap:0, background:DA.grayXL, borderRadius:8,
      border:`1px solid ${DA.border}`, padding:'5px 8px 5px 0' }}>
      {/* Badge – largeur fixe */}
      <div style={{ width:BADGE_W, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
        {p.isAssemblage
          ? <span style={{ fontSize:7, fontWeight:900, color:DA.red, background:'#FFF0F0', borderRadius:3, padding:'1px 3px', lineHeight:1.3 }}>A!</span>
          : <div style={{ width:6, height:6, borderRadius:'50%', background:'#bbb' }}/>
        }
      </div>
      {/* Nom + infos */}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:11, fontWeight:700, color:DA.black, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.nom}</div>
        {(p.poste || p.email) && (
          <div style={{ fontSize:9, color:DA.gray, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {[p.poste, p.email].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
      {/* Réordonner ↑↓ */}
      <div style={{ display:'flex', flexDirection:'column', marginLeft:6, gap:1, flexShrink:0 }}>
        <button onClick={onMoveUp} disabled={!onMoveUp}
          style={{ fontSize:9, lineHeight:1, padding:'2px 5px', borderRadius:4,
            border:`1px solid ${onMoveUp ? DA.border : 'transparent'}`,
            background: onMoveUp ? 'white' : 'transparent',
            color: onMoveUp ? DA.gray : DA.border,
            cursor: onMoveUp ? 'pointer' : 'default' }}>↑</button>
        <button onClick={onMoveDown} disabled={!onMoveDown}
          style={{ fontSize:9, lineHeight:1, padding:'2px 5px', borderRadius:4,
            border:`1px solid ${onMoveDown ? DA.border : 'transparent'}`,
            background: onMoveDown ? 'white' : 'transparent',
            color: onMoveDown ? DA.gray : DA.border,
            cursor: onMoveDown ? 'pointer' : 'default' }}>↓</button>
      </div>
      {/* Toggle présence */}
      <button onClick={onToggle}
        title={isPresent ? 'Marquer absent' : 'Marquer présent'}
        style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:6, border:'none', cursor:'pointer', flexShrink:0, marginLeft:6,
          background: isPresent ? '#DCFCE7' : '#FEE2E2',
          color: isPresent ? '#16A34A' : DA.red }}>
        {isPresent ? '✓ Présent' : '✗ Absent'}
      </button>
      {/* Supprimer */}
      <button onClick={onRemove} style={{ color:DA.grayL, background:'none', border:'none', cursor:'pointer', flexShrink:0, padding:'0 2px', marginLeft:4 }}>
        <Ic n="x" s={12}/>
      </button>
    </div>
  );
}

// ── Composant principal ────────────────────────────────────────────────────────
export default function ParticipantsEditor({ participants = [], onChange }) {
  const [showPicker, setShowPicker] = useState(false);
  const [showExt,    setShowExt]    = useState(() => loadGlobalContacts().length > 0);
  const [showForm,   setShowForm]   = useState(() => loadGlobalContacts().length === 0);
  const [form,       setForm]       = useState(EMPTY);
  const [search,     setSearch]     = useState('');
  const [extSearch,  setExtSearch]  = useState('');
  const [saved,      setSaved]      = useState(() => loadGlobalContacts());

  const add    = (p) => onChange([...participants, { ...p, id: crypto.randomUUID(), presence: 'present' }]);
  const remove = (id) => onChange(participants.filter(p => p.id !== id));
  const toggle = (id) => onChange(participants.map(p =>
    p.id === id ? { ...p, presence: p.presence === 'absent' ? 'present' : 'absent' } : p
  ));
  const move = (id, dir) => {
    const idx = participants.findIndex(p => p.id === id);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= participants.length) return;
    const arr = [...participants];
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
    onChange(arr);
  };

  const deleteSaved = (id) => {
    deleteGlobalContact(id);
    setSaved(loadGlobalContacts());
  };

  const addedEmails = new Set(participants.map(p => p.email).filter(Boolean));

  const filteredTeam = ASSEMBLAGE_TEAM.filter(t =>
    !search || t.nom.toLowerCase().includes(search.toLowerCase()) ||
    t.poste.toLowerCase().includes(search.toLowerCase())
  );

  const filteredSaved = saved.filter(c =>
    !extSearch || c.nom.toLowerCase().includes(extSearch.toLowerCase()) ||
    (c.poste || '').toLowerCase().includes(extSearch.toLowerCase()) ||
    (c.email || '').toLowerCase().includes(extSearch.toLowerCase())
  );

  const addExternal = () => {
    if (!form.nom.trim()) return;
    const contact = { ...form, isAssemblage: false, id: crypto.randomUUID() };
    saveGlobalContact(contact);
    const updated = loadGlobalContacts();
    setSaved(updated);
    onChange([...participants, { ...contact, presence: 'present' }]);
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
          {participants.map((p, i) => (
            <ParticipantRow
              key={p.id}
              p={p}
              onRemove={() => remove(p.id)}
              onToggle={() => toggle(p.id)}
              onMoveUp={i > 0 ? () => move(p.id, -1) : null}
              onMoveDown={i < participants.length - 1 ? () => move(p.id, 1) : null}
            />
          ))}
        </div>
      )}

      {/* ── Picker Assemblage ── */}
      {showPicker && (
        <div style={{ background:'white', border:`1px solid ${DA.border}`, borderRadius:8, marginBottom:8, boxShadow:'0 2px 10px rgba(0,0,0,0.12)' }}>
          <div style={{ padding:'6px 8px', borderBottom:`1px solid ${DA.border}` }}>
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher…"
              style={{ width:'100%', fontSize:11, border:`1px solid ${DA.border}`, borderRadius:6, padding:'5px 8px', outline:'none', boxSizing:'border-box', fontFamily:'inherit' }}/>
          </div>
          <div style={{ maxHeight:200, overflowY:'auto' }}>
            {filteredTeam.map(t => {
              const isAdded = addedEmails.has(t.email);
              const initials = t.nom.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('');
              return (
                <div key={t.email}
                  onClick={() => { if (!isAdded) add({ ...t, isAssemblage: true }); }}
                  style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', cursor: isAdded ? 'default' : 'pointer',
                    opacity: isAdded ? 0.4 : 1, borderBottom:`1px solid ${DA.border}`, background:'white', transition:'background 0.1s' }}
                  onMouseEnter={e => { if (!isAdded) e.currentTarget.style.background = DA.grayXL; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'white'; }}>
                  <div style={{ width:26, height:26, borderRadius:'50%', background:DA.red, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <span style={{ fontSize:8, fontWeight:800, color:'white' }}>{initials}</span>
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:DA.black }}>{t.nom}</div>
                    <div style={{ fontSize:9, color:DA.gray }}>{t.poste}{t.tel ? ` · ${t.tel}` : ''}</div>
                  </div>
                  {isAdded && <span style={{ fontSize:9, color:DA.grayL }}>✓</span>}
                </div>
              );
            })}
            {filteredTeam.length === 0 && <div style={{ padding:12, fontSize:11, color:DA.grayL, textAlign:'center' }}>Aucun résultat</div>}
          </div>
        </div>
      )}

      {/* ── Section Externe ── */}
      {showExt && (
        <div style={{ background:'white', border:`1px solid ${DA.border}`, borderRadius:8, marginBottom:8, boxShadow:'0 2px 10px rgba(0,0,0,0.12)' }}>

          {/* Contacts enregistrés */}
          {(filteredSaved.length > 0 || extSearch || saved.length > 0) ? (
            <>
              <div style={{ padding:'6px 8px', borderBottom:`1px solid ${DA.border}` }}>
                <input value={extSearch} onChange={e => setExtSearch(e.target.value)}
                  placeholder="Rechercher dans les contacts…"
                  style={{ width:'100%', fontSize:11, border:`1px solid ${DA.border}`, borderRadius:6, padding:'5px 8px', outline:'none', boxSizing:'border-box', fontFamily:'inherit' }}/>
              </div>
              <div style={{ maxHeight:180, overflowY:'auto' }}>
                {filteredSaved.map(c => {
                  const isAdded = addedEmails.has(c.email) || participants.some(p => !p.isAssemblage && p.nom === c.nom);
                  const initials = c.nom.split(' ').map(w => w[0]).filter(Boolean).slice(0,2).join('');
                  return (
                    <div key={c.id}
                      style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px',
                        opacity: isAdded ? 0.5 : 1, borderBottom:`1px solid ${DA.border}`, background:'white' }}>
                      <div onClick={() => { if (!isAdded) add({ ...c, isAssemblage: false }); }}
                        style={{ display:'flex', alignItems:'center', gap:8, flex:1, minWidth:0, cursor: isAdded ? 'default' : 'pointer' }}>
                        <div style={{ width:26, height:26, borderRadius:'50%', background:'#555', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                          <span style={{ fontSize:8, fontWeight:800, color:'white' }}>{initials}</span>
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:11, fontWeight:700, color:DA.black }}>{c.nom}</div>
                          <div style={{ fontSize:9, color:DA.gray, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{[c.poste, c.email].filter(Boolean).join(' · ')}</div>
                        </div>
                        {isAdded && <span style={{ fontSize:9, color:DA.grayL, flexShrink:0 }}>✓</span>}
                      </div>
                      {/* Supprimer du carnet */}
                      <button onClick={() => deleteSaved(c.id)}
                        title="Supprimer du carnet"
                        style={{ color:'#FCA5A5', background:'none', border:'none', cursor:'pointer', flexShrink:0, padding:'0 2px' }}>
                        <Ic n="x" s={10}/>
                      </button>
                    </div>
                  );
                })}
                {filteredSaved.length === 0 && extSearch && (
                  <div style={{ padding:10, fontSize:11, color:DA.grayL, textAlign:'center' }}>Aucun résultat</div>
                )}
              </div>
            </>
          ) : null}

          {/* Formulaire nouveau contact */}
          <div style={{ padding:10, borderTop: saved.length > 0 ? `1px solid ${DA.border}` : 'none' }}>
            {!showForm ? (
              <button onClick={() => setShowForm(true)}
                style={{ width:'100%', fontSize:11, fontWeight:600, padding:'6px 0', borderRadius:8,
                  border:`1px dashed ${DA.border}`, background:DA.grayXL, color:DA.gray, cursor:'pointer' }}>
                + Nouveau contact
              </button>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                <div style={{ fontSize:10, fontWeight:700, color:DA.gray, marginBottom:2 }}>Nouveau contact (enregistré automatiquement)</div>
                {[['nom','Nom *'],['poste','Poste / Société'],['email','Email'],['tel','Téléphone']].map(([k, lbl]) => (
                  <input key={k} value={form[k]}
                    onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                    placeholder={lbl}
                    style={{ width:'100%', fontSize:11, border:`1px solid ${DA.border}`, borderRadius:6,
                      padding:'5px 8px', outline:'none', boxSizing:'border-box', fontFamily:'inherit', background:'white' }}/>
                ))}
                <div style={{ display:'flex', gap:6, marginTop:2 }}>
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
          </div>
        </div>
      )}

      {/* ── Boutons d'ajout ── */}
      <div style={{ display:'flex', gap:6 }}>
        <button
          onClick={() => { setShowPicker(!showPicker); setShowExt(false); if (!showPicker) setSearch(''); }}
          style={{ flex:1, fontSize:10, fontWeight:700, padding:'6px 4px', borderRadius:8,
            border:`1.5px solid ${showPicker ? DA.red : DA.border}`,
            background: showPicker ? DA.redL : 'white',
            color: showPicker ? DA.red : DA.gray, cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
          <span style={{ fontSize:9, fontWeight:900 }}>A!</span>
          Assemblage
        </button>
        <button
          onClick={() => { setShowExt(!showExt); setShowPicker(false); if (!showExt) { setExtSearch(''); setSaved(loadGlobalContacts()); } }}
          style={{ flex:1, fontSize:10, fontWeight:700, padding:'6px 4px', borderRadius:8,
            border:`1.5px solid ${showExt ? DA.red : DA.border}`,
            background: showExt ? DA.redL : 'white',
            color: showExt ? DA.red : DA.gray, cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
          <Ic n="usr" s={10}/>
          Externe {saved.length > 0 && <span style={{ fontSize:9, background: showExt ? DA.red : DA.border, color: showExt ? 'white' : DA.gray, borderRadius:10, padding:'0 5px', marginLeft:2 }}>{saved.length}</span>}
        </button>
      </div>
    </div>
  );
}
