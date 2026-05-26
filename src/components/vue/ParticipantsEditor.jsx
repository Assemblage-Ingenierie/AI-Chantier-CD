import React, { useState, useEffect, useCallback } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import {
  loadContacts, upsertContact, deleteContact,
  seedAssemblageContacts, migrateLocalContacts,
} from '../../lib/contacts.js';

// Hardcoded Assemblage team — used only for the first-time seeding into Supabase.
const ASSEMBLAGE_TEAM_SEED = [
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

const EMPTY_FORM = { nom: '', poste: '', email: '', tel: '' };
const BADGE_W = 24;

// ── Ligne participant ──────────────────────────────────────────────────────────
function ParticipantRow({ p, onRemove, onToggle, onMoveUp, onMoveDown }) {
  const isPresent = !p.presence || p.presence === 'present';
  return (
    <div style={{ display:'flex', alignItems:'center', gap:0, background:DA.grayXL, borderRadius:8,
      border:`1px solid ${DA.border}`, padding:'5px 8px 5px 0' }}>
      <div style={{ width:BADGE_W, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
        {p.isAssemblage
          ? <span style={{ fontSize:7, fontWeight:900, color:DA.red, background:'#FFF0F0', borderRadius:3, padding:'1px 3px', lineHeight:1.3 }}>A!</span>
          : <div style={{ width:6, height:6, borderRadius:'50%', background:'#bbb' }}/>
        }
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:11, fontWeight:700, color:DA.black, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.nom}</div>
        {(p.poste || p.email) && (
          <div style={{ fontSize:9, color:DA.gray, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {[p.poste, p.email].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
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
      <button onClick={onToggle}
        title={isPresent ? 'Marquer absent' : 'Marquer présent'}
        style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:6, border:'none', cursor:'pointer', flexShrink:0, marginLeft:6,
          background: isPresent ? '#DCFCE7' : '#FEE2E2',
          color: isPresent ? '#16A34A' : DA.red }}>
        {isPresent ? '✓ Présent' : '✗ Absent'}
      </button>
      <button onClick={onRemove} style={{ color:DA.grayL, background:'none', border:'none', cursor:'pointer', flexShrink:0, padding:'0 2px', marginLeft:4 }}>
        <Ic n="x" s={12}/>
      </button>
    </div>
  );
}

// ── Formulaire d'édition inline ────────────────────────────────────────────────
function InlineEditForm({ contact, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ nom: contact.nom, poste: contact.poste || '', email: contact.email || '', tel: contact.tel || '' });
  return (
    <div style={{ padding:'8px 10px', background:'#FFFBEB', border:`1px solid #FCD34D`, borderRadius:8, display:'flex', flexDirection:'column', gap:4 }}>
      <div style={{ fontSize:9, fontWeight:800, color:'#92400E', textTransform:'uppercase', letterSpacing:0.5, marginBottom:2 }}>
        {contact.id ? 'Modifier le contact' : 'Nouveau contact'}
      </div>
      {[['nom','Nom *'],['poste','Poste / Société'],['email','Email'],['tel','Téléphone']].map(([k, lbl]) => (
        <input key={k} value={form[k]}
          onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
          placeholder={lbl}
          style={{ width:'100%', fontSize:11, border:`1px solid ${DA.border}`, borderRadius:6,
            padding:'5px 8px', outline:'none', boxSizing:'border-box', fontFamily:'inherit', background:'white' }}/>
      ))}
      <div style={{ display:'flex', gap:6, marginTop:2 }}>
        <button onClick={() => onSave({ ...contact, ...form })} disabled={!form.nom.trim() || saving}
          style={{ flex:1, padding:'6px 0', borderRadius:8, fontSize:11, fontWeight:700, border:'none',
            background: form.nom.trim() && !saving ? DA.black : DA.grayL,
            color:'white', cursor: form.nom.trim() && !saving ? 'pointer' : 'not-allowed' }}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button onClick={onCancel}
          style={{ padding:'6px 10px', borderRadius:8, fontSize:11, border:`1px solid ${DA.border}`, background:'white', color:DA.gray, cursor:'pointer' }}>
          Annuler
        </button>
      </div>
    </div>
  );
}

// ── Composant principal ────────────────────────────────────────────────────────
export default function ParticipantsEditor({ participants = [], onChange }) {
  const [contacts,     setContacts]     = useState([]);
  const [loadingC,     setLoadingC]     = useState(true);
  const [showPicker,   setShowPicker]   = useState(false);
  const [showExt,      setShowExt]      = useState(false);
  const [showForm,     setShowForm]     = useState(false);
  const [form,         setForm]         = useState(EMPTY_FORM);
  const [search,       setSearch]       = useState('');
  const [extSearch,    setExtSearch]    = useState('');
  const [quickSearch,  setQuickSearch]  = useState('');
  const [editingId,    setEditingId]    = useState(null);
  const [saving,       setSaving]       = useState(false);

  const reloadContacts = useCallback(async () => {
    try {
      const all = await loadContacts();
      setContacts(all);
      return all;
    } catch (err) {
      console.error('Erreur chargement contacts:', err);
      return [];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await migrateLocalContacts();
        await seedAssemblageContacts(ASSEMBLAGE_TEAM_SEED);
        const all = await loadContacts();
        if (!cancelled) {
          setContacts(all);
          const ext = all.filter(c => !c.isAssemblage);
          setShowExt(ext.length > 0);
          setShowForm(ext.length === 0);
        }
      } catch (err) {
        console.error('Erreur init contacts:', err);
      } finally {
        if (!cancelled) setLoadingC(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const assemblageContacts = contacts.filter(c => c.isAssemblage);
  const externalContacts   = contacts.filter(c => !c.isAssemblage);

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

  const handleSaveContact = async (contact) => {
    setSaving(true);
    try {
      const savedId = await upsertContact(contact);
      await reloadContacts();
      setEditingId(null);
      // if it was a new external contact, also add to participants
      if (!contact.id) {
        onChange([...participants, { ...contact, id: savedId, isAssemblage: false, presence: 'present' }]);
        setForm(EMPTY_FORM);
        setShowForm(false);
      }
    } catch (err) {
      console.error('Erreur sauvegarde contact:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteContact = async (id) => {
    try {
      await deleteContact(id);
      await reloadContacts();
    } catch (err) {
      console.error('Erreur suppression contact:', err);
    }
  };

  const addedEmails = new Set(participants.map(p => p.email).filter(Boolean));

  const q = quickSearch.trim().toLowerCase();
  const quickAssemblage = q ? assemblageContacts.filter(c =>
    c.nom.toLowerCase().includes(q) || (c.poste || '').toLowerCase().includes(q)
  ) : [];
  const quickExternal = q ? externalContacts.filter(c =>
    c.nom.toLowerCase().includes(q) ||
    (c.poste || '').toLowerCase().includes(q) ||
    (c.email || '').toLowerCase().includes(q)
  ) : [];
  const hasQuickResults = quickAssemblage.length > 0 || quickExternal.length > 0;

  const filteredAssemblage = assemblageContacts.filter(c =>
    !search || c.nom.toLowerCase().includes(search.toLowerCase()) ||
    (c.poste || '').toLowerCase().includes(search.toLowerCase())
  );

  const filteredExternal = externalContacts.filter(c =>
    !extSearch || c.nom.toLowerCase().includes(extSearch.toLowerCase()) ||
    (c.poste || '').toLowerCase().includes(extSearch.toLowerCase()) ||
    (c.email || '').toLowerCase().includes(extSearch.toLowerCase())
  );

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderAssemblageRow = (c, inDropdown = false) => {
    const isAdded = addedEmails.has(c.email);
    const initials = c.nom.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('');
    const isEditing = editingId === c.id;
    return (
      <div key={c.id}>
        {isEditing ? (
          <div style={{ padding:'6px 8px', borderBottom:`1px solid ${DA.border}` }}>
            <InlineEditForm
              contact={c}
              onSave={handleSaveContact}
              onCancel={() => setEditingId(null)}
              saving={saving}
            />
          </div>
        ) : (
          <div
            onClick={() => { if (!isAdded && !isEditing) { add({ ...c, isAssemblage: true }); if (inDropdown) setQuickSearch(''); } }}
            style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px',
              cursor: isAdded ? 'default' : 'pointer', opacity: isAdded ? 0.4 : 1,
              borderBottom:`1px solid ${DA.border}`, background:'white', transition:'background 0.1s' }}
            onMouseEnter={e => { if (!isAdded) e.currentTarget.style.background = DA.grayXL; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'white'; }}>
            <div style={{ width:26, height:26, borderRadius:'50%', background:DA.red, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <span style={{ fontSize:8, fontWeight:800, color:'white' }}>{initials}</span>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:11, fontWeight:700, color:DA.black }}>{c.nom}</div>
              <div style={{ fontSize:9, color:DA.gray }}>{c.poste}{c.tel ? ` · ${c.tel}` : ''}</div>
            </div>
            {isAdded && <span style={{ fontSize:9, color:DA.grayL }}>✓</span>}
            <button
              onClick={e => { e.stopPropagation(); setEditingId(c.id); }}
              title="Modifier ce contact"
              style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL, padding:'2px 4px', flexShrink:0, display:'flex', alignItems:'center' }}>
              <Ic n="pen" s={10}/>
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderExternalRow = (c, inDropdown = false) => {
    const isAdded = addedEmails.has(c.email) || participants.some(p => !p.isAssemblage && p.nom === c.nom);
    const initials = c.nom.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('');
    const isEditing = editingId === c.id;
    return (
      <div key={c.id}>
        {isEditing ? (
          <div style={{ padding:'6px 8px', borderBottom:`1px solid ${DA.border}` }}>
            <InlineEditForm
              contact={c}
              onSave={handleSaveContact}
              onCancel={() => setEditingId(null)}
              saving={saving}
            />
          </div>
        ) : (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px',
            opacity: isAdded ? 0.5 : 1, borderBottom:`1px solid ${DA.border}`, background:'white' }}>
            <div
              onClick={() => { if (!isAdded) { add({ ...c, isAssemblage: false }); if (inDropdown) setQuickSearch(''); } }}
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
            <button
              onClick={e => { e.stopPropagation(); setEditingId(c.id); }}
              title="Modifier ce contact"
              style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL, padding:'2px 4px', flexShrink:0, display:'flex', alignItems:'center' }}>
              <Ic n="pen" s={10}/>
            </button>
            <button onClick={() => { if (window.confirm(`Supprimer "${c.nom}" du carnet ?`)) handleDeleteContact(c.id); }}
              title="Supprimer du carnet"
              style={{ color:'#FCA5A5', background:'none', border:'none', cursor:'pointer', flexShrink:0, padding:'0 2px' }}>
              <Ic n="x" s={10}/>
            </button>
          </div>
        )}
      </div>
    );
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
          <div style={{ maxHeight:220, overflowY:'auto' }}>
            {loadingC
              ? <div style={{ padding:12, fontSize:11, color:DA.grayL, textAlign:'center' }}>Chargement…</div>
              : filteredAssemblage.length === 0
                ? <div style={{ padding:12, fontSize:11, color:DA.grayL, textAlign:'center' }}>Aucun résultat</div>
                : filteredAssemblage.map(c => renderAssemblageRow(c))
            }
          </div>
        </div>
      )}

      {/* ── Section Externe ── */}
      {showExt && (
        <div style={{ background:'white', border:`1px solid ${DA.border}`, borderRadius:8, marginBottom:8, boxShadow:'0 2px 10px rgba(0,0,0,0.12)' }}>
          {(filteredExternal.length > 0 || extSearch || externalContacts.length > 0) && (
            <>
              <div style={{ padding:'6px 8px', borderBottom:`1px solid ${DA.border}` }}>
                <input value={extSearch} onChange={e => setExtSearch(e.target.value)}
                  placeholder="Rechercher dans les contacts…"
                  style={{ width:'100%', fontSize:11, border:`1px solid ${DA.border}`, borderRadius:6, padding:'5px 8px', outline:'none', boxSizing:'border-box', fontFamily:'inherit' }}/>
              </div>
              <div style={{ maxHeight:180, overflowY:'auto' }}>
                {loadingC
                  ? <div style={{ padding:12, fontSize:11, color:DA.grayL, textAlign:'center' }}>Chargement…</div>
                  : filteredExternal.map(c => renderExternalRow(c))
                }
                {!loadingC && filteredExternal.length === 0 && extSearch && (
                  <div style={{ padding:10, fontSize:11, color:DA.grayL, textAlign:'center' }}>Aucun résultat</div>
                )}
              </div>
            </>
          )}

          {/* Formulaire nouveau contact externe */}
          <div style={{ padding:10, borderTop: externalContacts.length > 0 ? `1px solid ${DA.border}` : 'none' }}>
            {!showForm ? (
              <button onClick={() => setShowForm(true)}
                style={{ width:'100%', fontSize:11, fontWeight:600, padding:'6px 0', borderRadius:8,
                  border:`1px dashed ${DA.border}`, background:DA.grayXL, color:DA.gray, cursor:'pointer' }}>
                + Nouveau contact
              </button>
            ) : (
              <InlineEditForm
                contact={{ nom: form.nom, poste: form.poste, email: form.email, tel: form.tel, isAssemblage: false }}
                onSave={c => { setForm({ nom: c.nom, poste: c.poste, email: c.email, tel: c.tel }); handleSaveContact({ ...c, isAssemblage: false }); }}
                onCancel={() => { setShowForm(false); setForm(EMPTY_FORM); }}
                saving={saving}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Recherche rapide unifiée ── */}
      <div style={{ position:'relative', marginBottom:6 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, border:`1px solid ${quickSearch ? DA.red : DA.border}`, borderRadius:8, padding:'6px 10px', background:'white', transition:'border-color 0.15s' }}>
          <Ic n="txt" s={13}/>
          <input
            value={quickSearch}
            onChange={e => setQuickSearch(e.target.value)}
            placeholder="Rechercher un intervenant…"
            style={{ flex:1, border:'none', outline:'none', fontSize:12, fontFamily:'inherit', background:'transparent', color:DA.black }}
          />
          {quickSearch && (
            <button onClick={() => setQuickSearch('')} style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL, display:'flex', alignItems:'center', padding:0 }}>
              <Ic n="x" s={13}/>
            </button>
          )}
        </div>

        {q && (
          <div style={{ position:'absolute', left:0, right:0, top:'100%', marginTop:3, background:'white', border:`1px solid ${DA.border}`, borderRadius:8, boxShadow:'0 4px 16px rgba(0,0,0,0.12)', zIndex:20, maxHeight:240, overflowY:'auto' }}>
            {!hasQuickResults && (
              <div style={{ padding:'12px 10px', fontSize:11, color:DA.grayL, textAlign:'center' }}>Aucun résultat pour « {quickSearch} »</div>
            )}
            {quickAssemblage.length > 0 && (
              <>
                <div style={{ padding:'5px 10px 3px', fontSize:9, fontWeight:800, color:DA.red, textTransform:'uppercase', letterSpacing:0.5 }}>Assemblage</div>
                {quickAssemblage.map(c => {
                  const isAdded = addedEmails.has(c.email);
                  const initials = c.nom.split(' ').map(w => w[0]).filter(Boolean).slice(0,2).join('');
                  return (
                    <div key={c.id} onClick={() => { if (!isAdded) { add({ ...c, isAssemblage: true }); setQuickSearch(''); } }}
                      style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px', cursor: isAdded ? 'default' : 'pointer', opacity: isAdded ? 0.45 : 1, borderBottom:`1px solid ${DA.border}` }}
                      onMouseEnter={e => { if (!isAdded) e.currentTarget.style.background = DA.grayXL; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'white'; }}>
                      <div style={{ width:26, height:26, borderRadius:'50%', background:DA.red, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <span style={{ fontSize:8, fontWeight:800, color:'white' }}>{initials}</span>
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12, fontWeight:700, color:DA.black }}>{c.nom}</div>
                        <div style={{ fontSize:10, color:DA.gray }}>{c.poste}</div>
                      </div>
                      {isAdded && <span style={{ fontSize:10, color:DA.grayL }}>✓</span>}
                    </div>
                  );
                })}
              </>
            )}
            {quickExternal.length > 0 && (
              <>
                <div style={{ padding:'5px 10px 3px', fontSize:9, fontWeight:800, color:DA.gray, textTransform:'uppercase', letterSpacing:0.5 }}>Contacts externes</div>
                {quickExternal.map(c => {
                  const isAdded = addedEmails.has(c.email) || participants.some(p => !p.isAssemblage && p.nom === c.nom);
                  const initials = c.nom.split(' ').map(w => w[0]).filter(Boolean).slice(0,2).join('');
                  return (
                    <div key={c.id} onClick={() => { if (!isAdded) { add({ ...c, isAssemblage: false }); setQuickSearch(''); } }}
                      style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px', cursor: isAdded ? 'default' : 'pointer', opacity: isAdded ? 0.45 : 1, borderBottom:`1px solid ${DA.border}` }}
                      onMouseEnter={e => { if (!isAdded) e.currentTarget.style.background = DA.grayXL; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'white'; }}>
                      <div style={{ width:26, height:26, borderRadius:'50%', background:'#555', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <span style={{ fontSize:8, fontWeight:800, color:'white' }}>{initials}</span>
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12, fontWeight:700, color:DA.black }}>{c.nom}</div>
                        <div style={{ fontSize:10, color:DA.gray, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{[c.poste, c.email].filter(Boolean).join(' · ')}</div>
                      </div>
                      {isAdded && <span style={{ fontSize:10, color:DA.grayL }}>✓</span>}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>

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
          onClick={() => { setShowExt(!showExt); setShowPicker(false); if (!showExt) setExtSearch(''); }}
          style={{ flex:1, fontSize:10, fontWeight:700, padding:'6px 4px', borderRadius:8,
            border:`1.5px solid ${showExt ? DA.red : DA.border}`,
            background: showExt ? DA.redL : 'white',
            color: showExt ? DA.red : DA.gray, cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
          <Ic n="usr" s={10}/>
          Externe {externalContacts.length > 0 && <span style={{ fontSize:9, background: showExt ? DA.red : DA.border, color: showExt ? 'white' : DA.gray, borderRadius:10, padding:'0 5px', marginLeft:2 }}>{externalContacts.length}</span>}
        </button>
      </div>
    </div>
  );
}
