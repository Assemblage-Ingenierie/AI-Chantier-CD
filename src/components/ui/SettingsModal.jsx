import React, { useState, useEffect } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from './Icons.jsx';
import { estimatePlanCacheBytes, estimatePlanBytesByIds, clearPlanCache } from '../../lib/planThumbCache.js';
import { estimateSnapshotBytes } from '../../lib/backupVault.js';
import { estimatePendingUploadBytes, subscribePendingUploads } from '../../lib/photoUploadQueue.js';
import { estimateOfflineBytesByProject, isProjectOfflineEnabled, setProjectOfflineEnabled, purgeProjectOffline } from '../../lib/offlineCache.js';
import { projectMatchesInitials } from '../../lib/profile.js';
import { getAIProvider, setAIProvider } from '../../lib/aiProxy.js';
import { detectPlatform, canInstallNative, isAppInstalled, promptInstall, subscribeInstall } from '../../lib/pwaInstall.js';
import { subscribePendingChanges } from '../../lib/pendingSync.js';

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
  const [pendingCount, setPendingCount] = useState(0);   // photos en attente d'envoi
  const [pendingChanges, setPendingChanges] = useState(0); // projets modifiés non synchronisés
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [aiProvider, setAiProviderState] = useState(getAIProvider()); // moteur IA : 'claude' | 'gemini'
  // « Télécharger l'application » (PWA) : plateforme dont les instructions sont dépliées,
  // dispo de l'installation native, état installé, message de résultat.
  const [dlPlatform, setDlPlatform] = useState(detectPlatform()); // 'android' | 'ios' | 'desktop'
  const [nativeReady, setNativeReady] = useState(canInstallNative());
  const [appInstalled, setAppInstalled] = useState(isAppInstalled());
  const [installMsg, setInstallMsg] = useState('');

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
  useEffect(() => subscribePendingChanges(setPendingChanges), []);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  // Dispo de l'install native / état installé peuvent changer après l'ouverture (capture
  // tardive de l'événement, ou installation depuis l'invite). On reste synchro.
  useEffect(() => subscribeInstall(() => { setNativeReady(canInstallNative()); setAppInstalled(isAppInstalled()); }), []);

  const handleInstallNative = async () => {
    const outcome = await promptInstall();
    if (outcome === 'accepted') setInstallMsg('Installation lancée ✓');
    else if (outcome === 'dismissed') setInstallMsg('Installation annulée');
    else setInstallMsg('');
    setNativeReady(canInstallNative());
  };

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

          {/* ── SAUVEGARDE : état clair « tout est sauvegardé » vs « en attente » (demande Thomas :
                que Margaux/Pierre sachent AVANT de fermer que rien n'est perdu). ── */}
          {(() => {
            const allSynced = pendingCount === 0 && pendingChanges === 0;
            const parts = [];
            if (pendingChanges > 0) parts.push(`${pendingChanges} modif${pendingChanges > 1 ? 's' : ''}`);
            if (pendingCount > 0) parts.push(`${pendingCount} photo${pendingCount > 1 ? 's' : ''}`);
            const bg = allSynced ? '#EAF7EE' : (online ? '#FFF6E6' : '#FDECEC');
            const bd = allSynced ? '#8FD3A6' : (online ? '#F0C674' : '#F3A6A6');
            const fg = allSynced ? '#1E7A3D' : (online ? '#8A5A00' : '#8A1F1F');
            return (
              <div style={{ marginBottom:22 }}>
                <p style={sectionTitle}>Sauvegarde</p>
                <div style={{ border:`1px solid ${bd}`, background:bg, borderRadius:10, padding:'12px 14px', display:'flex', alignItems:'flex-start', gap:10 }}>
                  <span style={{ flexShrink:0, marginTop:1, color:fg }}>
                    <Ic n={allSynced ? 'chk' : (online ? 'spn' : 'wifioff')} s={18}/>
                  </span>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:14, fontWeight:800, color:fg }}>
                      {allSynced
                        ? 'Tout est sauvegardé ✓'
                        : online
                          ? `Synchronisation… (${parts.join(' + ')})`
                          : `Hors ligne — ${parts.length ? parts.join(' + ') + ' en attente' : 'tout est gardé sur l’appareil'}`}
                    </div>
                    <div style={{ fontSize:12, color:fg, opacity:0.85, marginTop:2, lineHeight:1.45 }}>
                      {allSynced
                        ? 'Photos et données sont bien enregistrées sur le serveur. Tu peux fermer l’app sans risque.'
                        : online
                          ? 'Envoi en cours vers le serveur — garde l’app ouverte quelques secondes.'
                          : 'Rien n’est perdu : tout est gardé sur l’appareil et sera envoyé automatiquement dès le retour du réseau.'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

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
            <div style={{ display:'flex', gap:6 }}>
              {[{ k:'claude', l:'Claude', s:'défaut' }, { k:'gemini-flash', l:'Gemini Flash', s:'rapide' }, { k:'gemini-pro', l:'Gemini Pro', s:'précis' }].map(o => {
                const active = aiProvider === o.k;
                return (
                  <button key={o.k} onClick={() => { setAIProvider(o.k); setAiProviderState(o.k); }}
                    style={{ flex:1, padding:'9px 6px', borderRadius:9, fontSize:12, fontWeight:700, cursor:'pointer', lineHeight:1.25,
                      border:`1.5px solid ${active ? DA.red : DA.border}`,
                      background: active ? DA.red : 'white', color: active ? 'white' : DA.gray, transition:'background 0.15s, border-color 0.15s' }}>
                    {o.l}<br/><span style={{ fontSize:10, fontWeight:600, opacity:0.85 }}>{o.s}</span>
                  </button>
                );
              })}
            </div>
            <p style={{ fontSize:11, color:DA.grayL, margin:'8px 2px 0' }}>
              Moteur utilisé pour générer et améliorer les textes (rédaction, correction). <strong>Claude</strong> par défaut.
              <strong> Gemini Pro</strong> = meilleure qualité/précision mais plus lent ; <strong>Flash</strong> = rapide. Réversible à tout moment.
            </p>
          </div>

          {/* ── Télécharger l'application (PWA) ── */}
          <div style={{ marginBottom:22 }}>
            <p style={sectionTitle}>Télécharger l'application</p>
            {appInstalled ? (
              <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, color:DA.gray, padding:'10px 12px', border:`1px solid ${DA.border}`, borderRadius:10 }}>
                <Ic n="chk" s={16}/> L'application est déjà installée sur cet appareil.
              </div>
            ) : (
            <>
              {/* Sélecteur de plateforme (3 boutons) — révèle les instructions adaptées */}
              <div style={{ display:'flex', gap:6 }}>
                {[{ k:'android', l:'Android' }, { k:'ios', l:'iPhone / iPad' }, { k:'desktop', l:'Ordinateur' }].map(o => {
                  const active = dlPlatform === o.k;
                  return (
                    <button key={o.k} onClick={() => { setDlPlatform(o.k); setInstallMsg(''); }}
                      style={{ flex:1, padding:'9px 6px', borderRadius:9, fontSize:12, fontWeight:700, cursor:'pointer', lineHeight:1.25,
                        border:`1.5px solid ${active ? DA.red : DA.border}`,
                        background: active ? DA.red : 'white', color: active ? 'white' : DA.gray, transition:'background 0.15s, border-color 0.15s' }}>
                      {o.l}
                    </button>
                  );
                })}
              </div>

              <div style={{ marginTop:10, border:`1px solid ${DA.border}`, borderRadius:10, padding:'12px 14px' }}>
                {/* Android & Ordinateur : installation native en un clic si dispo, sinon manuel */}
                {(dlPlatform === 'android' || dlPlatform === 'desktop') && (
                  nativeReady ? (
                    <>
                      <button onClick={handleInstallNative}
                        style={{ width:'100%', padding:'12px', borderRadius:9, border:'none', background:DA.red, color:'white',
                          fontSize:14, fontWeight:800, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                        <Ic n="dl" s={16}/> Installer l'application
                      </button>
                      {installMsg && <p style={{ fontSize:12, color:DA.gray, margin:'8px 2px 0', textAlign:'center' }}>{installMsg}</p>}
                    </>
                  ) : dlPlatform === 'android' ? (
                    <ol style={{ margin:0, paddingLeft:18, fontSize:13, color:DA.gray, lineHeight:1.7 }}>
                      <li>Ouvrez le menu <strong>⋮</strong> (3 points) en haut à droite de Chrome</li>
                      <li>Appuyez sur <strong>« Ajouter à l'écran d'accueil »</strong> ou <strong>« Installer l'application »</strong></li>
                      <li style={{ color:DA.grayL }}>Sur Samsung Internet : menu ⋮ → « Ajouter page à » → « Écran d'accueil »</li>
                    </ol>
                  ) : (
                    <ol style={{ margin:0, paddingLeft:18, fontSize:13, color:DA.gray, lineHeight:1.7 }}>
                      <li>Dans Chrome ou Edge, cliquez sur l'icône <strong>installer</strong> (écran avec flèche) à droite de la barre d'adresse</li>
                      <li>Ou menu <strong>⋮</strong> → <strong>« Installer AI chantier… »</strong></li>
                    </ol>
                  )
                )}

                {/* iOS : pas d'installation native possible → instructions Partager (Safari) */}
                {dlPlatform === 'ios' && (
                  <ol style={{ margin:0, paddingLeft:18, fontSize:13, color:DA.gray, lineHeight:1.7 }}>
                    <li>Ouvrez le site dans <strong>Safari</strong></li>
                    <li>Appuyez sur <strong>Partager</strong> <span style={{ whiteSpace:'nowrap' }}>(carré avec flèche ↑)</span> en bas de l'écran</li>
                    <li>Faites défiler et appuyez sur <strong>« Sur l'écran d'accueil »</strong></li>
                  </ol>
                )}
              </div>
              <p style={{ fontSize:11, color:DA.grayL, margin:'8px 2px 0' }}>
                AI chantier s'installe comme une vraie application (icône sur l'écran d'accueil, plein écran,
                fonctionne hors connexion) — sans passer par un store, gratuitement.
              </p>
            </>
            )}
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
