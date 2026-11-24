import React, { useState } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { DRIVE_DESTS } from '../../lib/driveReport.js';

// Bas du rapport : « Enregistrer le PDF sur le Drive » + menu du dossier (demande Thomas 24/11).
// Jamais imprimé (data-print="hide").
const LS_KEY = 'chantierai_drive_dest_v1';
const readDest = () => { try { const v = localStorage.getItem(LS_KEY); return DRIVE_DESTS.some(d => d.id === v) ? v : 'visites'; } catch { return 'visites'; } };

export default function DriveSaveBar({ onSave, compact = false }) {
  const [dest, setDest] = useState(readDest);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState('');
  const choose = (v) => { setDest(v); try { localStorage.setItem(LS_KEY, v); } catch { /* ignore */ } };
  const save = async () => {
    if (busy) return;
    setBusy(true); setErr(''); setDone(null); setProgress(0);
    try { setDone(await onSave(dest, setProgress)); }
    catch (e) { setErr(e?.message || 'Envoi impossible'); }
    setBusy(false);
  };
  return (
    <div data-print="hide" style={compact
      ? { background:'white', borderRadius:9, border:`1px solid ${DA.border}`, padding:'9px 10px', display:'flex', flexDirection:'column', gap:7 }
      : { width:630, margin:'18px auto 0', background:'white', borderRadius:10, boxShadow:'0 2px 14px rgba(0,0,0,0.3)', padding:'12px 14px', display:'flex', flexDirection:'column', gap:8, fontFamily:"'Open Sans', sans-serif" }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
        <Ic n="arc" s={15}/>
        <span style={{ fontSize:12.5, fontWeight:800, color:DA.black }}>Enregistrer le PDF sur le Drive</span>
        <span style={{ flex: compact ? '1 0 100%' : 1 }}/>
        <select value={dest} onChange={e => choose(e.target.value)} disabled={busy} aria-label="Dossier du Drive"
          style={{ fontSize:12, padding:'6px 8px', borderRadius:7, border:`1px solid ${DA.border}`, background:'white', color:DA.black, fontFamily:'inherit', ...(compact ? { flex:1, minWidth:0 } : {}) }}>
          {DRIVE_DESTS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        <button onClick={save} disabled={busy}
          style={{ display:'flex', alignItems:'center', gap:6, border:'none', borderRadius:7, padding:'7px 12px', fontSize:12, fontWeight:800, color:'white', background: busy ? '#9CA3AF' : DA.red, cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? <Ic n="spn" s={13}/> : <Ic n="snd" s={13}/>}
          {busy ? (progress > 0 ? `Envoi ${Math.round(progress * 100)} %` : 'Préparation du PDF…') : 'Enregistrer'}
        </button>
      </div>
      {done && (
        <div style={{ fontSize:11.5, color:'#15803D', background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:7, padding:'6px 9px', lineHeight:1.45 }}>
          ✓ {done.replaced ? 'PDF mis à jour (l\'ancienne version reste dans l\'historique du Drive)' : 'PDF enregistré'} dans <strong>{done.folderName}</strong>
          {' · '}<a href={done.fileUrl || done.folderUrl} target="_blank" rel="noreferrer" style={{ color:'#15803D', fontWeight:700 }}>Ouvrir</a>
        </div>
      )}
      {err && <div style={{ fontSize:11.5, color:'#B91C1C', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:7, padding:'6px 9px' }}>{err}</div>}
    </div>
  );
}
