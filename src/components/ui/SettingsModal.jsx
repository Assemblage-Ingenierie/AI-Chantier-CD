import React, { useState, useEffect } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from './Icons.jsx';
import { estimatePlanCacheBytes, estimatePlanBytesByIds, clearPlanCache } from '../../lib/planThumbCache.js';
import { estimateSnapshotBytes } from '../../lib/backupVault.js';
import { estimatePendingUploadBytes, subscribePendingUploads } from '../../lib/photoUploadQueue.js';
import { estimateOfflineBytesByProject, isProjectOfflineEnabled, setProjectOfflineEnabled, purgeProjectOffline } from '../../lib/offlineCache.js';
import { projectMatchesInitials } from '../../lib/profile.js';
import { getAIProvider, setAIProvider } from '../../lib/aiProxy.js';

function fmtBytes(n) {
  if (!n || n < 1024) return `${n || 0} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

// Poids des DONNÉES d'un projet (textes, observations, annotations…) ≈ sa part du cache
// local. Les gros blobs base64 (images de plans, photos, couvertures) sont exclus : ils
// sont comptés à part (cache photos hors-ligne + cache plans).
function projectDataBytes(p) {
  try {
    return JSON.stringify(p, (k, v) =>
      (k === 'bg' || k === 'data' || k === 'hd' || k === 'photo' || k === 'photoCouverture') && typeof v === 'string' && v.length > 500
        ? undefined : v
    ).length * 2;
  } catch { return 0; }
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

export default function SettingsModal({ onClose, projets = [], profile = null, onPrecacheProject = null }) {
  const [sizes, setSizes] = useState({ plans: null, snapshots: null, pending: null, local: null });
  const [offlineByProject, setOfflineByProject] = useState(null); // { projectId: octets PHOTOS }
  const [detailByProject, setDetailByProject] = useState({}); // { projectId: { plans, donnees } }
  const [offlinePrefs, setOfflinePrefs] = useState({}); // reflet local des switchs
  const [busyProject, setBusyProject] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [aiProvider, setAiProviderState] = useState(getAIProvider()); // moteur IA : 'claude' | 'gemini'

  const refreshSizes = async () => {
    const [plans, snapshots, pending, byProject] = await Promise.all([
      estimatePlanCacheBytes(), estimateSnapshotBytes(), estimatePendingUploadBytes(),
      estimateOfflineBytesByProject(),
    ]);
    setSizes({ plans, snapshots, pending, local: localStorageBytes() });
    setOfflineByProject(byProject);
    // Détail par projet : plans en cache (IndexedDB) + données (texte/observations) —
    // « je veux voir TOUT le projet dans le cache, pas que les photos » (Thomas).
    const detail = {};
    for (const p of projets) {
      if (p.statut === 'archive') continue;
      detail[p.id] = {
        plans: await estimatePlanBytesByIds((p.planLibrary || []).map(pl => pl.id)),
        donnees: projectDataBytes(p),
      };
    }
    setDetailByProject(detail);
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

  const handleClearPlans = async () => {
    setClearing(true);
    await clearPlanCache();
    await refreshSizes();
    setClearing(false);
    setCleared(true);
    setTimeout(() => setCleared(false), 2500);
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

          {/* ── Hors-ligne par projet : UNIQUEMENT « mes projets » (initiales sur une visite) ── */}
          {(() => {
            const myInitials = (profile?.initials || '').trim();
            const mine = projets.filter(p => p.statut !== 'archive' && projectMatchesInitials(p, myInitials));
            return (
          <div style={{ marginBottom:22 }}>
            <p style={sectionTitle}>Mes projets hors ligne</p>
            {!myInitials ? (
              <p style={{ fontSize:12, color:DA.grayL, margin:0, padding:'10px 12px', border:`1px solid ${DA.border}`, borderRadius:10 }}>
                Renseignez vos initiales dans « Mon compte » pour activer le téléchargement automatique de vos projets.
              </p>
            ) : mine.length === 0 ? (
              <p style={{ fontSize:12, color:DA.grayL, margin:0, padding:'10px 12px', border:`1px solid ${DA.border}`, borderRadius:10 }}>
                Aucun projet ne porte vos initiales ({myInitials}) pour l'instant. Ajoutez « {myInitials} » dans le champ
                Ingénieur d'une visite : le projet se téléchargera automatiquement pour le hors-ligne.
              </p>
            ) : (
            <div style={{ border:`1px solid ${DA.border}`, borderRadius:10, padding:'4px 12px' }}>
              {mine.map((p, i) => {
                const on = offlinePrefs[p.id] ?? isProjectOfflineEnabled(p.id);
                const photosB = offlineByProject?.[p.id] || 0;
                const plansB  = detailByProject[p.id]?.plans || 0;
                const dataB   = detailByProject[p.id]?.donnees || 0;
                const total   = photosB + plansB + dataB;
                return (
                  <div key={p.id} style={{ ...row, ...(i > 0 ? { borderTop:`1px solid ${DA.grayXL}` } : {}) }}>
                    <div style={{ minWidth:0, flex:1 }}>
                      <div style={{ fontSize:13, color:DA.black, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.nom}</div>
                      <div style={{ fontSize:11, color:DA.grayL, marginTop:1, lineHeight:1.5 }}>
                        {offlineByProject == null ? '…' : on
                          ? <><strong style={{ color:DA.gray }}>{fmtBytes(total)} en cache</strong> · plans {fmtBytes(plansB)} · photos {fmtBytes(photosB)} · données {fmtBytes(dataB)}</>
                          : 'Hors-ligne désactivé'}
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
            </div>
            )}
            <p style={{ fontSize:11, color:DA.grayL, margin:'8px 2px 0' }}>
              Vos projets (initiales sur une visite) se téléchargent automatiquement — données, plans,
              photos — pour être consultables sans réseau. Désactiver un projet libère son espace immédiatement.
            </p>
          </div>
            );
          })()}

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

          {/* ── Moteur IA (réversible) ── */}
          <div style={{ marginBottom:22 }}>
            <p style={sectionTitle}>Moteur IA</p>
            <div style={{ display:'flex', gap:8 }}>
              {[{ k:'claude', l:'Claude' }, { k:'gemini', l:'Gemini' }].map(o => {
                const active = aiProvider === o.k;
                return (
                  <button key={o.k} onClick={() => { setAIProvider(o.k); setAiProviderState(o.k); }}
                    style={{ flex:1, padding:'11px', borderRadius:9, fontSize:13, fontWeight:700, cursor:'pointer',
                      border:`1.5px solid ${active ? DA.red : DA.border}`,
                      background: active ? DA.red : 'white', color: active ? 'white' : DA.gray, transition:'background 0.15s, border-color 0.15s' }}>
                    {o.l}
                  </button>
                );
              })}
            </div>
            <p style={{ fontSize:11, color:DA.grayL, margin:'8px 2px 0' }}>
              Moteur utilisé pour générer et améliorer les textes (rédaction, correction). <strong>Claude</strong> par défaut. Changement immédiat et réversible à tout moment.
            </p>
          </div>

          {/* ── À propos ── */}
          {/* Le « Journal de navigation » (outil de diagnostic du bouton retour Android,
              juillet 2026) a été retiré : le problème est résolu et le réglage semait la
              confusion. Réactivable au besoin via localStorage._navdebug = '1'. */}
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
