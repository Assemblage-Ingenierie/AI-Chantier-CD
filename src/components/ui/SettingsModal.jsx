import React, { useState, useEffect } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from './Icons.jsx';
import { getUiScale, setUiScale } from '../../lib/uiPrefs.js';
import { estimatePlanCacheBytes, clearPlanCache } from '../../lib/planThumbCache.js';
import { estimateSnapshotBytes } from '../../lib/backupVault.js';
import { estimatePendingUploadBytes, subscribePendingUploads } from '../../lib/photoUploadQueue.js';
import { estimateOfflineBytesByProject, isProjectOfflineEnabled, setProjectOfflineEnabled, purgeProjectOffline } from '../../lib/offlineCache.js';

function fmtBytes(n) {
  if (!n || n < 1024) return `${n || 0} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

function localStorageBytes() {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      total += (k.length + (localStorage.getItem(k) || '').length) * 2; // UTF-16 ≈ 2 o/car
    }
    return total;
  } catch { return 0; }
}

const SCALES = [
  { k: 'compact', label: 'Compact' },
  { k: 'normal',  label: 'Normal'  },
  { k: 'large',   label: 'Grand'   },
];

export default function SettingsModal({ onClose, projets = [], onPrecacheProject = null }) {
  const [scale, setScale] = useState(getUiScale);
  const [sizes, setSizes] = useState({ plans: null, snapshots: null, pending: null, local: null });
  const [offlineByProject, setOfflineByProject] = useState(null); // { projectId: bytes }
  const [offlinePrefs, setOfflinePrefs] = useState({}); // reflet local des switchs
  const [busyProject, setBusyProject] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [navDebug, setNavDebug] = useState(() => { try { return localStorage.getItem('_navdebug') === '1'; } catch { return false; } });

  const refreshSizes = async () => {
    const [plans, snapshots, pending, byProject] = await Promise.all([
      estimatePlanCacheBytes(), estimateSnapshotBytes(), estimatePendingUploadBytes(),
      estimateOfflineBytesByProject(),
    ]);
    setSizes({ plans, snapshots, pending, local: localStorageBytes() });
    setOfflineByProject(byProject);
  };

  // Switch hors-ligne d'un projet : OFF = purge son cache photos et l'exclut du
  // pré-téléchargement automatique ; ON = réactive et relance le téléchargement.
  const toggleProjectOffline = async (p) => {
    const currentlyOn = offlinePrefs[p.id] ?? isProjectOfflineEnabled(p.id);
    setBusyProject(p.id);
    if (currentlyOn) {
      setProjectOfflineEnabled(p.id, false);
      setOfflinePrefs(o => ({ ...o, [p.id]: false }));
      await purgeProjectOffline(p.id);
    } else {
      setProjectOfflineEnabled(p.id, true);
      setOfflinePrefs(o => ({ ...o, [p.id]: true }));
      try { await onPrecacheProject?.(p.id); } catch { /* best-effort */ }
    }
    await refreshSizes();
    setBusyProject(null);
  };

  useEffect(() => { refreshSizes(); }, []);
  useEffect(() => subscribePendingUploads(setPendingCount), []);

  const applyScale = (k) => { setScale(k); setUiScale(k); };

  const handleClearPlans = async () => {
    setClearing(true);
    await clearPlanCache();
    await refreshSizes();
    setClearing(false);
    setCleared(true);
    setTimeout(() => setCleared(false), 2500);
  };

  const toggleNavDebug = () => {
    setNavDebug(v => {
      const next = !v;
      try { next ? localStorage.setItem('_navdebug', '1') : localStorage.removeItem('_navdebug'); } catch {}
      return next;
    });
  };

  const sectionTitle = { fontSize:11, fontWeight:800, color:DA.gray, textTransform:'uppercase', letterSpacing:0.6, margin:'0 0 10px' };
  const row = { display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, padding:'8px 0' };

  return (
    <div className="modal-overlay-dark">
      <div className="modal-sheet-flex" style={{ maxWidth:480 }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 18px 12px', borderBottom:`1px solid ${DA.border}`, flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:9 }}>
            <Ic n="sld" s={18}/>
            <p style={{ fontWeight:800, fontSize:16, color:DA.black, margin:0 }}>Paramètres</p>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ background:'none', border:'none', cursor:'pointer', color:DA.grayL, width:40, height:40, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Ic n="x" s={20}/>
          </button>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'16px 18px' }}>

          {/* ── Taille de l'interface ── */}
          <div style={{ marginBottom:22 }}>
            <p style={sectionTitle}>Taille de l'interface</p>
            <div style={{ display:'flex', gap:6 }}>
              {SCALES.map(s => (
                <button key={s.k} onClick={() => applyScale(s.k)}
                  style={{ flex:1, padding:'10px 0', borderRadius:9, cursor:'pointer', fontWeight:700,
                    fontSize: s.k === 'compact' ? 12 : s.k === 'large' ? 16 : 14,
                    border: `1.5px solid ${scale === s.k ? DA.red : DA.border}`,
                    background: scale === s.k ? DA.redL : 'white',
                    color: scale === s.k ? DA.red : DA.gray }}>
                  {s.label}
                </button>
              ))}
            </div>
            <p style={{ fontSize:11, color:DA.grayL, margin:'8px 2px 0' }}>
              S'applique aux listes et aux fiches. L'annotation de plans et l'aperçu du rapport gardent leur taille d'origine.
            </p>
          </div>

          {/* ── Hors-ligne par projet ── */}
          <div style={{ marginBottom:22 }}>
            <p style={sectionTitle}>Projets disponibles hors ligne</p>
            <div style={{ border:`1px solid ${DA.border}`, borderRadius:10, padding:'4px 12px' }}>
              {projets.filter(p => p.statut !== 'archive').map((p, i) => {
                const on = offlinePrefs[p.id] ?? isProjectOfflineEnabled(p.id);
                const bytes = offlineByProject?.[p.id] || 0;
                return (
                  <div key={p.id} style={{ ...row, ...(i > 0 ? { borderTop:`1px solid ${DA.grayXL}` } : {}) }}>
                    <div style={{ minWidth:0, flex:1 }}>
                      <div style={{ fontSize:13, color:DA.black, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.nom}</div>
                      <div style={{ fontSize:11, color:DA.grayL, marginTop:1 }}>
                        {offlineByProject == null ? '…' : on ? `${fmtBytes(bytes)} de photos en cache` : 'Hors-ligne désactivé'}
                      </div>
                    </div>
                    <button onClick={() => toggleProjectOffline(p)} disabled={busyProject === p.id}
                      title={on ? 'Désactiver le hors-ligne (supprime le cache local de ce projet)' : 'Activer le hors-ligne (re-télécharge le projet)'}
                      style={{ flexShrink:0, width:46, height:26, borderRadius:20, border:'none', cursor: busyProject === p.id ? 'default' : 'pointer', position:'relative',
                        background: on ? DA.urgGrn : DA.border, opacity: busyProject === p.id ? 0.6 : 1, transition:'background 0.15s' }}>
                      <span style={{ position:'absolute', top:3, left: on ? 23 : 3, width:20, height:20, borderRadius:'50%', background:'white', transition:'left 0.15s', boxShadow:'0 1px 3px rgba(0,0,0,0.3)' }}/>
                    </button>
                  </div>
                );
              })}
              {projets.filter(p => p.statut !== 'archive').length === 0 && (
                <div style={row}><span style={{ fontSize:12, color:DA.grayL }}>Aucun projet actif</span></div>
              )}
            </div>
            <p style={{ fontSize:11, color:DA.grayL, margin:'8px 2px 0' }}>
              Les projets portant vos initiales se téléchargent automatiquement (données, plans, photos)
              pour être consultables sans réseau. Désactiver un projet libère son espace immédiatement.
            </p>
          </div>

          {/* ── Stockage ── */}
          <div style={{ marginBottom:22 }}>
            <p style={sectionTitle}>Stockage local</p>
            <div style={{ border:`1px solid ${DA.border}`, borderRadius:10, padding:'4px 12px' }}>
              <div style={row}>
                <span style={{ fontSize:13, color:DA.black }}>Plans en cache</span>
                <span style={{ fontSize:13, color:DA.gray, fontWeight:600 }}>{sizes.plans == null ? '…' : fmtBytes(sizes.plans)}</span>
              </div>
              <div style={{ ...row, borderTop:`1px solid ${DA.grayXL}` }}>
                <span style={{ fontSize:13, color:DA.black }}>Sauvegardes de secours</span>
                <span style={{ fontSize:13, color:DA.gray, fontWeight:600 }}>{sizes.snapshots == null ? '…' : fmtBytes(sizes.snapshots)}</span>
              </div>
              <div style={{ ...row, borderTop:`1px solid ${DA.grayXL}` }}>
                <span style={{ fontSize:13, color:DA.black }}>Photos en attente d'envoi</span>
                <span style={{ fontSize:13, fontWeight:700, color: pendingCount > 0 ? DA.urgAmb : DA.gray }}>
                  {sizes.pending == null ? '…' : `${fmtBytes(sizes.pending)}${pendingCount > 0 ? ` (${pendingCount})` : ''}`}
                </span>
              </div>
              <div style={{ ...row, borderTop:`1px solid ${DA.grayXL}` }}>
                <span style={{ fontSize:13, color:DA.black }}>Données de l'app</span>
                <span style={{ fontSize:13, color:DA.gray, fontWeight:600 }}>{sizes.local == null ? '…' : fmtBytes(sizes.local)}</span>
              </div>
            </div>

            <button onClick={handleClearPlans} disabled={clearing || pendingCount > 0}
              style={{ width:'100%', marginTop:10, padding:'11px', borderRadius:9, fontSize:13, fontWeight:700,
                border:`1px solid ${DA.border}`, background:'white',
                color: pendingCount > 0 ? DA.grayL : DA.red,
                cursor: (clearing || pendingCount > 0) ? 'default' : 'pointer',
                display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
              {clearing ? <Ic n="spn" s={14}/> : cleared ? <Ic n="chk" s={14}/> : <Ic n="del" s={14}/>}
              {clearing ? 'Nettoyage…' : cleared ? 'Cache vidé' : 'Vider le cache des plans'}
            </button>
            <p style={{ fontSize:11, color:DA.grayL, margin:'8px 2px 0' }}>
              {pendingCount > 0
                ? `Indisponible : ${pendingCount} photo${pendingCount > 1 ? 's' : ''} en attente d'envoi. Reconnectez-vous pour les synchroniser d'abord.`
                : 'Libère de l\'espace. Les plans se retéléchargent automatiquement à la prochaine ouverture d\'un projet. Vos données, photos et observations ne sont pas touchées.'}
            </p>
          </div>

          {/* ── Diagnostic ── */}
          <div style={{ marginBottom:22 }}>
            <p style={sectionTitle}>Diagnostic</p>
            <div style={{ ...row, border:`1px solid ${DA.border}`, borderRadius:10, padding:'10px 12px' }}>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:13, color:DA.black, fontWeight:600 }}>Journal de navigation</div>
                <div style={{ fontSize:11, color:DA.grayL, marginTop:2 }}>Affiche un journal technique en bas d'écran (support).</div>
              </div>
              <button onClick={toggleNavDebug}
                style={{ flexShrink:0, width:46, height:26, borderRadius:20, border:'none', cursor:'pointer', position:'relative',
                  background: navDebug ? DA.urgGrn : DA.border, transition:'background 0.15s' }}>
                <span style={{ position:'absolute', top:3, left: navDebug ? 23 : 3, width:20, height:20, borderRadius:'50%', background:'white', transition:'left 0.15s', boxShadow:'0 1px 3px rgba(0,0,0,0.3)' }}/>
              </button>
            </div>
          </div>

          {/* ── À propos ── */}
          <div>
            <p style={sectionTitle}>À propos</p>
            <p style={{ fontSize:12, color:DA.gray, margin:0, lineHeight:1.6 }}>
              <strong style={{ color:DA.black }}>AI chantier</strong> — Assemblage Ingénierie<br/>
              Outil de visite et de compte-rendu de chantier.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
