import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import {
  loadContacts, upsertContact, deleteContact,
  contactsToCsv, parseContactsCsv, previewImport, importContacts,
  classifyPdfImport,
} from '../../lib/contacts.js';
import { getPdfText } from '../../lib/pdfUtils.js';
import { callAIProxy } from '../../lib/aiProxy.js';

// Lit un File en data URL (base64) pour le passer à PDF.js.
function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// Projets sur lesquels chaque contact est tagué (participant d'au moins une visite).
// Clé de correspondance : email (fiable), repli nom. Renvoie Map(cleContact → [noms projets]).
function computeTagged(projets) {
  const map = new Map();
  const add = (key, projetNom) => {
    if (!key) return;
    const set = map.get(key) || new Set();
    set.add(projetNom);
    map.set(key, set);
  };
  for (const p of (projets || [])) {
    for (const v of (p.visites || [])) {
      for (const part of (v.participants || [])) {
        if (part.email) add(part.email.toLowerCase(), p.nom);
        if (part.nom)   add(part.nom.trim().toLowerCase(), p.nom);
      }
    }
  }
  return map;
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

const EMPTY = { nom: '', poste: '', entreprise: '', email: '', tel: '', isAssemblage: false };

// Cellule éditable EN PLACE : clic → input, Entrée/blur → enregistre, Échap → annule.
// Permet de modifier tout le carnet directement depuis le tableau (demande Thomas).
function EditableCell({ value, placeholder = '—', bold = false, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  useEffect(() => { if (!editing) setDraft(value || ''); }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v !== (value || '')) onCommit(v);
  };
  if (!editing) {
    return (
      <div onClick={() => setEditing(true)} title="Cliquer pour modifier"
        style={{ cursor:'text', minHeight:18, borderRadius:4, padding:'2px 4px', margin:'-2px -4px', fontWeight: bold ? 700 : 400 }}>
        {value || <span style={{ color:DA.grayL }}>{placeholder}</span>}
      </div>
    );
  }
  return (
    <input autoFocus value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value || ''); setEditing(false); } }}
      style={{ width:'100%', minWidth:90, fontSize:13, border:`1.5px solid ${DA.red}`, borderRadius:6, padding:'4px 6px', outline:'none', boxSizing:'border-box', fontFamily:'inherit' }}/>
  );
}

export default function ContactsManagerModal({ projets = [], onClose }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all | assemblage | externe | noemail
  const [editing, setEditing] = useState(null); // contact en cours d'édition (ou EMPTY pour nouveau)
  const [saving, setSaving] = useState(false);
  const [importPreview, setImportPreview] = useState(null); // { parsed, stats }
  const fileRef = useRef();
  // Import depuis PDF (CR d'archi) → extraction IA + dédup floue.
  const pdfRef = useRef();
  const [pdfBusy, setPdfBusy] = useState('');      // message d'étape ('' = inactif)
  const [pdfErr, setPdfErr] = useState('');
  const [pdfResult, setPdfResult] = useState(null); // { toAdd:[{sel,contact}], review:[{sel,parsed,match}], present:[...] }

  const reload = async () => {
    setLoading(true); setErr('');
    try { setContacts(await loadContacts()); }
    catch (e) { setErr(e.message); }
    setLoading(false);
  };
  useEffect(() => { reload(); }, []);

  // Édition en place d'un champ : mise à jour OPTIMISTE (le tableau réagit immédiatement),
  // enregistrement Supabase derrière ; en cas d'échec on recharge (état serveur = vérité).
  const patchContact = async (c, field, value) => {
    const updated = { ...c, [field]: value };
    setContacts(cs => cs.map(x => x.id === c.id ? updated : x));
    try { await upsertContact(updated); }
    catch (e) { setErr(e.message || 'Erreur d\'enregistrement'); reload(); }
  };

  const tagged = useMemo(() => computeTagged(projets), [projets]);
  const projetsOf = (c) => {
    const s = new Set([
      ...(c.email ? [...(tagged.get(c.email.toLowerCase()) || [])] : []),
      ...[...(tagged.get(c.nom.trim().toLowerCase()) || [])],
    ]);
    return [...s];
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter(c => {
      if (filter === 'assemblage' && !c.isAssemblage) return false;
      if (filter === 'externe' && c.isAssemblage) return false;
      if (filter === 'noemail' && c.email) return false;
      if (!q) return true;
      return [c.nom, c.poste, c.entreprise, c.email, c.tel].some(v => (v || '').toLowerCase().includes(q));
    });
  }, [contacts, search, filter]);

  const handleSave = async () => {
    if (!editing?.nom?.trim()) return;
    setSaving(true);
    try { await upsertContact(editing); setEditing(null); await reload(); }
    catch (e) { setErr(e.message); }
    setSaving(false);
  };
  const handleDelete = async (c) => {
    if (!window.confirm(`Supprimer « ${c.nom} » du carnet ?`)) return;
    try { await deleteContact(c.id); await reload(); } catch (e) { setErr(e.message); }
  };

  const handleExport = () => download('intervenants.csv', contactsToCsv(filtered.length ? filtered : contacts));

  const handleFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    const parsed = parseContactsCsv(text);
    if (!parsed.length) { setErr('Aucun contact valide trouvé dans le fichier.'); return; }
    setImportPreview({ parsed, stats: previewImport(parsed, contacts) });
  };
  const confirmImport = async () => {
    setSaving(true);
    try { await importContacts(importPreview.parsed, contacts); setImportPreview(null); await reload(); }
    catch (e) { setErr(e.message); }
    setSaving(false);
  };

  // ── Import depuis un PDF (compte-rendu d'architecte) : texte → IA → dédup floue ──────────
  const handlePdf = async (file) => {
    if (!file) return;
    setPdfErr(''); setPdfResult(null);
    try {
      setPdfBusy('Lecture du PDF…');
      const dataUrl = await fileToDataUrl(file);
      const text = await getPdfText(dataUrl);
      if (!text || text.length < 20) { setPdfErr('PDF illisible ou sans texte (scan image ?).'); setPdfBusy(''); return; }
      setPdfBusy('Analyse des intervenants par l’IA…');
      const prompt = `Extrais TOUS les intervenants (personnes) cités dans ce compte-rendu de chantier : nom complet, poste/rôle, entreprise/société, e-mail, téléphone. Ignore les lignes qui ne sont pas des personnes. Si un champ est absent, mets une chaîne vide.\nRéponds UNIQUEMENT avec un JSON valide de cette forme, sans texte autour :\n{"contacts":[{"nom":"","poste":"","entreprise":"","email":"","tel":""}]}\n\nTEXTE DU COMPTE-RENDU :\n${text}`;
      const r = await callAIProxy({ feature: 'pdf_contacts', json: true, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] });
      const raw = r.content?.[0]?.text || '';
      let parsed;
      try { parsed = JSON.parse((raw.match(/\{[\s\S]*\}/) || [''])[0]); } catch { parsed = null; }
      const list = Array.isArray(parsed?.contacts) ? parsed.contacts : [];
      const clean = list
        .map(c => ({ nom:(c.nom||'').trim(), poste:(c.poste||'').trim(), entreprise:(c.entreprise||'').trim(), email:(c.email||'').trim(), tel:(c.tel||'').trim() }))
        .filter(c => c.nom);
      if (!clean.length) { setPdfErr('Aucun intervenant détecté dans ce PDF.'); setPdfBusy(''); return; }
      const { toAdd, present, review } = classifyPdfImport(clean, contacts);
      // Liste UNIFIÉE, chaque personne avec son statut clair (demande Thomas : « déjà enregistré /
      // pas enregistré / nom proche », et je valide au cas par cas). Défauts SÛRS pour ne jamais
      // créer de doublon par accident : nouveau = coché, nom proche = décoché, déjà là = verrouillé.
      const rows = [
        ...toAdd.map(c => ({ status:'new', sel:true, contact:c, match:null })),
        ...review.map(rv => ({ status:'near', sel:false, contact:rv.parsed, match:rv.match })),
        ...present.map(pr => ({ status:'present', sel:false, contact:pr.parsed, match:pr.match })),
      ];
      setPdfResult({ rows });
      setPdfBusy('');
    } catch (e) {
      setPdfErr(e?.message || 'Échec de l’analyse du PDF'); setPdfBusy('');
    }
  };
  const confirmPdfImport = async () => {
    if (!pdfResult) return;
    setSaving(true);
    try {
      // On n'ajoute QUE les lignes cochées ET jamais un « déjà enregistré » (verrou anti-doublon).
      const chosen = pdfResult.rows.filter(x => x.sel && x.status !== 'present').map(x => x.contact);
      for (const c of chosen) await upsertContact(c);
      setPdfResult(null);
      await reload();
    } catch (e) { setPdfErr(e.message); }
    setSaving(false);
  };

  const th = { textAlign:'left', padding:'11px 12px', color:'white', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:0.5, whiteSpace:'nowrap' };
  const td = { padding:'10px 12px', fontSize:13, color:DA.black, verticalAlign:'middle' };
  const inp = { width:'100%', fontSize:16, border:`1px solid ${DA.border}`, borderRadius:7, padding:'8px 10px', outline:'none', boxSizing:'border-box', fontFamily:'inherit' };
  const FILTERS = [{ k:'all', l:'Tous' }, { k:'assemblage', l:'Assemblage' }, { k:'externe', l:'Externes' }, { k:'noemail', l:'Sans e-mail' }];

  return (
    <div className="modal-overlay-dark">
      <div className="modal-sheet-flex" style={{ maxWidth:'min(1440px, 96vw)' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 18px 12px', borderBottom:`1px solid ${DA.border}`, flexShrink:0 }}>
          <div>
            <p style={{ fontWeight:800, fontSize:17, color:DA.black, margin:0 }}>Carnet d'intervenants</p>
            <p style={{ fontSize:12, color:DA.grayL, margin:'2px 0 0' }}>{contacts.length} contact{contacts.length > 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL, width:40, height:40, display:'flex', alignItems:'center', justifyContent:'center' }}><Ic n="x" s={20}/></button>
        </div>

        {/* Barre d'outils */}
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 18px', borderBottom:`1px solid ${DA.border}`, flexShrink:0, flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, border:`1px solid ${DA.border}`, borderRadius:8, padding:'0 10px', flex:1, minWidth:180, background:'white' }}>
            <Ic n="srt" s={14}/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un intervenant…"
              style={{ flex:1, border:'none', outline:'none', fontSize:16, padding:'9px 0', background:'transparent', fontFamily:'inherit' }}/>
            {search && <button onClick={() => setSearch('')} style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL, display:'flex' }}><Ic n="x" s={14}/></button>}
          </div>
          <div style={{ display:'flex', gap:4 }}>
            {FILTERS.map(f => (
              <button key={f.k} onClick={() => setFilter(f.k)}
                style={{ fontSize:12, fontWeight:700, padding:'8px 11px', borderRadius:7, cursor:'pointer',
                  border:`1px solid ${filter === f.k ? DA.red : DA.border}`, background: filter === f.k ? DA.redL : 'white', color: filter === f.k ? DA.red : DA.gray }}>
                {f.l}
              </button>
            ))}
          </div>
          <div style={{ flex:1 }}/>
          <button onClick={handleExport} title="Exporter en CSV (Excel)"
            style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, fontWeight:700, padding:'8px 12px', borderRadius:8, border:`1px solid ${DA.border}`, background:'white', color:DA.gray, cursor:'pointer' }}>
            <Ic n="dl" s={14}/> Exporter
          </button>
          <button onClick={() => fileRef.current?.click()} title="Importer un CSV"
            style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, fontWeight:700, padding:'8px 12px', borderRadius:8, border:`1px solid ${DA.border}`, background:'white', color:DA.gray, cursor:'pointer' }}>
            <Ic n="dl" s={14} style={{ transform:'rotate(180deg)' }}/> Importer
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display:'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}/>
          <button onClick={() => pdfRef.current?.click()} disabled={!!pdfBusy} title="Importer les intervenants depuis un compte-rendu PDF (IA)"
            style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, fontWeight:700, padding:'8px 12px', borderRadius:8, border:`1px solid ${DA.border}`, background:'white', color: pdfBusy ? DA.grayL : '#6D28D9', cursor: pdfBusy ? 'default' : 'pointer' }}>
            <Ic n="fil" s={14}/> {pdfBusy ? '…' : 'PDF (CR)'}
          </button>
          <input ref={pdfRef} type="file" accept="application/pdf,.pdf" style={{ display:'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handlePdf(f); e.target.value = ''; }}/>
          <button onClick={() => setEditing({ ...EMPTY })}
            style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, fontWeight:800, padding:'8px 14px', borderRadius:8, border:'none', background:DA.red, color:'white', cursor:'pointer' }}>
            <Ic n="plus" s={14}/> Nouveau
          </button>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'12px 18px' }}>
          {err && <div style={{ padding:'8px 12px', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, fontSize:12, color:DA.red, marginBottom:12 }}>{err}</div>}
          {loading && <div style={{ padding:24, textAlign:'center', color:DA.gray, fontSize:13 }}>Chargement…</div>}

          {!loading && (
            <div style={{ overflowX:'auto', border:`1px solid ${DA.border}`, borderRadius:10 }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead>
                  <tr style={{ background:DA.black }}>
                    <th style={{ ...th, minWidth:160 }}>Nom</th><th style={{ ...th, minWidth:170 }}>Poste</th><th style={th}>Entreprise</th><th style={th}>E-mail</th>
                    <th style={th}>Tél.</th><th style={th}>Type</th><th style={th}>Projets</th><th style={{ ...th, textAlign:'right' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c, idx) => {
                    const projs = projetsOf(c);
                    return (
                      <tr key={c.id} style={{ borderTop: idx === 0 ? 'none' : `1px solid ${DA.grayXL}`, background:'white' }}>
                        <td style={{ ...td }}><EditableCell value={c.nom} bold placeholder="Nom" onCommit={v => { if (v) patchContact(c, 'nom', v); }}/></td>
                        <td style={{ ...td, color:DA.gray }}><EditableCell value={c.poste} onCommit={v => patchContact(c, 'poste', v)}/></td>
                        <td style={{ ...td, color:DA.gray }}><EditableCell value={c.entreprise} onCommit={v => patchContact(c, 'entreprise', v)}/></td>
                        <td style={{ ...td, color:DA.gray }}><EditableCell value={c.email} onCommit={v => patchContact(c, 'email', v)}/></td>
                        <td style={{ ...td, color:DA.gray, whiteSpace:'nowrap' }}><EditableCell value={c.tel} onCommit={v => patchContact(c, 'tel', v)}/></td>
                        <td style={td}>
                          <button onClick={() => patchContact(c, 'isAssemblage', !c.isAssemblage)}
                            title="Cliquer pour basculer Assemblage / Externe"
                            style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:20, border:'none', cursor:'pointer', background: c.isAssemblage ? DA.redL : DA.grayXL, color: c.isAssemblage ? DA.red : DA.gray }}>
                            {c.isAssemblage ? 'Assemblage' : 'Externe'}
                          </button>
                        </td>
                        <td style={td}>
                          {projs.length === 0
                            ? <span style={{ color:DA.grayL, fontSize:12 }}>—</span>
                            : <div style={{ display:'flex', flexWrap:'wrap', gap:3, maxWidth:220 }}>
                                {projs.slice(0, 3).map(n => <span key={n} style={{ fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:5, background:'#EFF6FF', color:'#1D4ED8', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:120 }}>{n}</span>)}
                                {projs.length > 3 && <span style={{ fontSize:10, fontWeight:700, color:DA.grayL }}>+{projs.length - 3}</span>}
                              </div>
                          }
                        </td>
                        <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }}>
                          <button onClick={() => setEditing(c)} aria-label="Modifier" title="Modifier"
                            style={{ width:32, height:32, borderRadius:6, border:`1px solid ${DA.border}`, background:'white', color:DA.gray, cursor:'pointer', marginRight:5 }}><Ic n="edt" s={14}/></button>
                          <button onClick={() => handleDelete(c)} aria-label="Supprimer" title="Supprimer du carnet"
                            style={{ width:32, height:32, borderRadius:6, border:`1px solid ${DA.border}`, background:'white', color:DA.grayL, cursor:'pointer' }}><Ic n="del" s={14}/></button>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={8} style={{ padding:24, textAlign:'center', color:DA.grayL, fontSize:13 }}>Aucun intervenant.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Sous-modal : édition/création */}
      {editing && (
        <div className="modal-overlay-dark" style={{ zIndex:10000 }} onClick={() => setEditing(null)}>
          <div className="modal-sheet" style={{ maxWidth:420, padding:20 }} onClick={e => e.stopPropagation()}>
            <p style={{ fontWeight:800, fontSize:15, color:DA.black, margin:'0 0 14px' }}>{editing.id ? 'Modifier le contact' : 'Nouveau contact'}</p>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <input value={editing.nom} onChange={e => setEditing(x => ({ ...x, nom: e.target.value }))} placeholder="Nom *" style={inp}/>
              <input value={editing.poste} onChange={e => setEditing(x => ({ ...x, poste: e.target.value }))} placeholder="Poste (ex : Architecte)" style={inp}/>
              <input value={editing.entreprise || ''} onChange={e => setEditing(x => ({ ...x, entreprise: e.target.value }))} placeholder="Entreprise" style={inp}/>
              <input value={editing.email} onChange={e => setEditing(x => ({ ...x, email: e.target.value }))} placeholder="E-mail" style={inp}/>
              <input value={editing.tel} onChange={e => setEditing(x => ({ ...x, tel: e.target.value }))} placeholder="Téléphone" style={inp}/>
              <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, color:DA.gray, cursor:'pointer' }}>
                <input type="checkbox" checked={!!editing.isAssemblage} onChange={e => setEditing(x => ({ ...x, isAssemblage: e.target.checked }))}/>
                Membre de l'équipe Assemblage
              </label>
            </div>
            <div style={{ display:'flex', gap:8, marginTop:16 }}>
              <button onClick={() => setEditing(null)} style={{ flex:1, padding:'11px', borderRadius:9, border:`1px solid ${DA.border}`, background:'white', color:DA.gray, fontSize:13, fontWeight:600, cursor:'pointer' }}>Annuler</button>
              <button onClick={handleSave} disabled={!editing.nom?.trim() || saving}
                style={{ flex:2, padding:'11px', borderRadius:9, border:'none', background: editing.nom?.trim() ? DA.red : DA.grayL, color:'white', fontSize:13, fontWeight:800, cursor: editing.nom?.trim() ? 'pointer' : 'default' }}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sous-modal : aperçu d'import */}
      {importPreview && (
        <div className="modal-overlay-dark" style={{ zIndex:10000 }} onClick={() => setImportPreview(null)}>
          <div className="modal-sheet" style={{ maxWidth:420, padding:20 }} onClick={e => e.stopPropagation()}>
            <p style={{ fontWeight:800, fontSize:15, color:DA.black, margin:'0 0 6px' }}>Importer {importPreview.stats.total} intervenant{importPreview.stats.total > 1 ? 's' : ''} ?</p>
            <p style={{ fontSize:13, color:DA.gray, margin:'0 0 14px', lineHeight:1.6 }}>
              <strong style={{ color:DA.urgGrn }}>{importPreview.stats.created}</strong> création{importPreview.stats.created > 1 ? 's' : ''} · <strong style={{ color:'#1D4ED8' }}>{importPreview.stats.updated}</strong> mise{importPreview.stats.updated > 1 ? 's' : ''} à jour<br/>
              <span style={{ fontSize:11, color:DA.grayL }}>Aucun contact existant ne sera supprimé.</span>
            </p>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => setImportPreview(null)} style={{ flex:1, padding:'11px', borderRadius:9, border:`1px solid ${DA.border}`, background:'white', color:DA.gray, fontSize:13, fontWeight:600, cursor:'pointer' }}>Annuler</button>
              <button onClick={confirmImport} disabled={saving}
                style={{ flex:2, padding:'11px', borderRadius:9, border:'none', background:DA.red, color:'white', fontSize:13, fontWeight:800, cursor:'pointer' }}>
                {saving ? 'Import…' : 'Confirmer l\'import'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Étape en cours / erreur de l'import PDF */}
      {(pdfBusy || pdfErr) && !pdfResult && (
        <div className="modal-overlay-dark" style={{ zIndex:10000 }} onClick={() => { if (!pdfBusy) setPdfErr(''); }}>
          <div className="modal-sheet" style={{ maxWidth:380, padding:22, textAlign:'center' }} onClick={e => e.stopPropagation()}>
            {pdfBusy ? (
              <>
                <div style={{ marginBottom:10 }}><Ic n="spn" s={26} color="#6D28D9"/></div>
                <p style={{ fontSize:14, color:DA.black, fontWeight:700, margin:0 }}>{pdfBusy}</p>
              </>
            ) : (
              <>
                <p style={{ fontSize:14, color:DA.red, fontWeight:700, margin:'0 0 14px' }}>{pdfErr}</p>
                <button onClick={() => setPdfErr('')} style={{ padding:'10px 18px', borderRadius:9, border:'none', background:DA.red, color:'white', fontSize:13, fontWeight:800, cursor:'pointer' }}>OK</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Écran de revue de l'import PDF — UNE liste, chaque personne avec son statut clair et une
          case à cocher. Rien n'est ajouté sans validation ; « déjà enregistré » est verrouillé. */}
      {pdfResult && (() => {
        const BADGE = {
          new:     { bg:'#ECFDF5', bd:'#A7F3D0', fg:'#065F46', label:'Nouveau' },
          near:    { bg:'#FFFBEB', bd:'#FCD34D', fg:'#92400E', label:'Nom proche' },
          present: { bg:'#F3F4F6', bd:'#E5E7EB', fg:'#6B7280', label:'Déjà enregistré' },
        };
        const rows = pdfResult.rows;
        const nNew = rows.filter(r => r.status === 'new').length;
        const nNear = rows.filter(r => r.status === 'near').length;
        const nPres = rows.filter(r => r.status === 'present').length;
        const nSel = rows.filter(r => r.sel && r.status !== 'present').length;
        const toggle = (i) => setPdfResult(r => ({ ...r, rows: r.rows.map((y, j) => j === i && y.status !== 'present' ? { ...y, sel: !y.sel } : y) }));
        return (
        <div className="modal-overlay-dark" style={{ zIndex:10000 }} onClick={() => setPdfResult(null)}>
          <div className="modal-sheet" style={{ maxWidth:560, padding:20, maxHeight:'90vh', display:'flex', flexDirection:'column' }} onClick={e => e.stopPropagation()}>
            <p style={{ fontWeight:800, fontSize:16, color:DA.black, margin:'0 0 4px' }}>{rows.length} intervenant{rows.length > 1 ? 's' : ''} trouvé{rows.length > 1 ? 's' : ''}</p>
            <p style={{ fontSize:12, color:DA.gray, margin:'0 0 6px' }}>
              <span style={{ color:'#065F46', fontWeight:700 }}>{nNew} nouveau{nNew > 1 ? 'x' : ''}</span> · <span style={{ color:'#92400E', fontWeight:700 }}>{nNear} nom{nNear > 1 ? 's' : ''} proche{nNear > 1 ? 's' : ''}</span> · <span style={{ color:'#6B7280', fontWeight:700 }}>{nPres} déjà là</span>
            </p>
            <p style={{ fontSize:11, color:DA.grayL, margin:'0 0 12px' }}>Coche qui tu veux ajouter. Les « déjà enregistré » sont verrouillés (aucun doublon possible).</p>
            <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:6 }}>
              {rows.map((x, i) => {
                const b = BADGE[x.status];
                const locked = x.status === 'present';
                return (
                  <label key={i} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'8px 10px', borderRadius:9,
                    border:`1px solid ${b.bd}`, background:b.bg, cursor: locked ? 'default' : 'pointer', opacity: locked ? 0.7 : 1 }}>
                    <input type="checkbox" checked={x.sel} disabled={locked} onChange={() => toggle(i)}
                      style={{ marginTop:3, accentColor:DA.red, width:17, height:17, flexShrink:0 }}/>
                    <div style={{ minWidth:0, flex:1 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:7, flexWrap:'wrap' }}>
                        <span style={{ fontSize:13.5, fontWeight:800, color:DA.black }}>{x.contact.nom}</span>
                        <span style={{ fontSize:10, fontWeight:800, color:b.fg, background:'white', border:`1px solid ${b.bd}`, borderRadius:5, padding:'1px 7px', textTransform:'uppercase', letterSpacing:0.3 }}>{b.label}</span>
                      </div>
                      <div style={{ fontSize:11.5, color:DA.gray, marginTop:1 }}>{[x.contact.poste, x.contact.entreprise, x.contact.email, x.contact.tel].filter(Boolean).join(' · ') || '—'}</div>
                      {x.match && (
                        <div style={{ fontSize:11, color:b.fg, marginTop:2 }}>
                          {x.status === 'present' ? '● identique à ' : '≈ ressemble à '}<strong>{x.match.nom}</strong>{x.match.entreprise ? ` (${x.match.entreprise})` : ''}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
            {pdfErr && <div style={{ fontSize:12, color:DA.red, marginTop:8 }}>{pdfErr}</div>}
            <div style={{ display:'flex', gap:8, marginTop:14 }}>
              <button onClick={() => setPdfResult(null)} style={{ flex:1, padding:'11px', borderRadius:9, border:`1px solid ${DA.border}`, background:'white', color:DA.gray, fontSize:13, fontWeight:600, cursor:'pointer' }}>Annuler</button>
              <button onClick={confirmPdfImport} disabled={saving || nSel === 0}
                style={{ flex:2, padding:'11px', borderRadius:9, border:'none', background: nSel === 0 ? DA.grayL : DA.red, color:'white', fontSize:13, fontWeight:800, cursor: nSel === 0 ? 'default' : 'pointer' }}>
                {saving ? 'Ajout…' : nSel === 0 ? 'Rien de sélectionné' : `Ajouter ${nSel} intervenant${nSel > 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
