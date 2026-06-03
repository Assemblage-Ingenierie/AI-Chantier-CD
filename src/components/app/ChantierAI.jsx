import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { useProjets } from '../../hooks/useProjets.js';
import { useBrandingLogo } from '../../lib/branding.js';
import { fetchRemoteTimestamps } from '../../lib/storage.js';
import { processDriveQueue } from '../../lib/driveUpload.js';
import AdminPanel from '../auth/AdminPanel.jsx';
import Dashboard from '../dashboard/Dashboard.jsx';
import NewProjet from '../dashboard/NewProjet.jsx';
import EditProjet from '../dashboard/EditProjet.jsx';
import VueProjet from './VueProjet.jsx';
import VisitesScreen from './VisitesScreen.jsx';

export default function ChantierAI({ profile, onLogout }) {
  // Logo wordmark complet — utiliser le PNG HD local pour éviter qu'un fichier
  // Supabase incorrect (e.g. sigle uploadé sur le path du logo) ne casse le header.
  const headerLogoUrl = '/logo_Ai_rouge_HD.png';
  const logoUrl = useBrandingLogo();
  const [syncStatus, setSyncStatus] = useState('ok');
  const [showAdmin, setShowAdmin] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [ouvert, setOuvert] = useState(null);
  const [selectedVisiteId, setSelectedVisiteId] = useState(null);

  const { projets, updateProjet, deleteProjet, deletePlanFromLibrary, addProjet, hydrated, remoteLoaded, loadError, hydratePhotos, hydratePlans, hydratePlanLibrary, undo, canUndo, refreshNow } = useProjets(setSyncStatus);
  const [splashTimedOut, setSplashTimedOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshNow();
      // Re-hydrate plan library + plan blobs (force) to refresh missing/stale plan backgrounds
      // when a project is open — corrige les plans gris après synchro depuis un autre appareil.
      if (ouvert) {
        const lm = await hydratePlanLibrary(ouvert.id, { force: true });
        await hydratePlans(ouvert.id, lm, { force: true });
      }
    } finally { setRefreshing(false); }
  };

  // Vérifie toutes les 30s s'il y a des utilisateurs en attente d'approbation
  useEffect(() => {
    if (profile?.role !== 'admin') return;
    const check = async () => {
      try {
        const { getSupabase } = await import('../../supabase.js');
        const sb = await getSupabase();
        const { count } = await sb.from('aichantier_profiles').select('*', { count: 'exact', head: true }).eq('is_approved', false);
        setPendingCount(count ?? 0);
      } catch {}
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [profile?.role]);
  const [undoToast, setUndoToast] = useState(null);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  // Process queued Drive uploads when app loads or connection is restored
  useEffect(() => {
    processDriveQueue();
    window.addEventListener('online', processDriveQueue);
    return () => window.removeEventListener('online', processDriveQueue);
  }, []);

  const [staleIds, setStaleIds] = useState(new Set());
  const projetsRef = useRef(projets);
  useEffect(() => { projetsRef.current = projets; }, [projets]);

  // Poll léger toutes les 60s (+ au focus fenêtre) pour détecter les MàJ distantes
  useEffect(() => {
    if (!remoteLoaded) return;
    const check = async () => {
      try {
        const ts = await fetchRemoteTimestamps();
        const s = new Set();
        for (const r of ts) {
          const local = projetsRef.current.find(p => p.id === r.id);
          if (local && r.updated_at && local.updatedAt && r.updated_at > local.updatedAt) s.add(r.id);
        }
        setStaleIds(s);
      } catch {}
    };
    check();
    const iv = setInterval(check, 60_000);
    window.addEventListener('focus', check);
    return () => { clearInterval(iv); window.removeEventListener('focus', check); };
  }, [remoteLoaded]);

  useEffect(() => {
    const goOnline  = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online',  goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);
  const undoToastRef = useRef(null);

  // --- Navigation arrière (swipe iOS / bouton Android) ---
  const ouvertRef = useRef(ouvert);
  const selectedVisiteIdRef = useRef(selectedVisiteId);
  // useLayoutEffect : met à jour les refs IMMÉDIATEMENT après le rendu (sync),
  // évite que le handler popstate lise des valeurs obsolètes juste après un setState
  React.useLayoutEffect(() => { ouvertRef.current = ouvert; }, [ouvert]);
  React.useLayoutEffect(() => { selectedVisiteIdRef.current = selectedVisiteId; }, [selectedVisiteId]);

  // Lazy loading photos : charger uniquement la visite sélectionnée
  useEffect(() => {
    if (ouvert && selectedVisiteId) {
      hydratePhotos(ouvert.id, selectedVisiteId);
    }
  }, [selectedVisiteId, ouvert?.id]);
  const childBackHandler = useRef(null); // fn() → true si le modal a géré le retour

  const setBackHandler = useCallback((fn) => { childBackHandler.current = fn; }, []);

  // ── Gestion du retour arrière + DIAGNOSTIC (#navdebug) ─────────────────────
  // Buffer de sentinelles modéré, protégé par try/catch (Chrome throttle pushState
  // à ~100 appels/30s → au-delà il LÈVE une exception). Diagnostic activable via
  // l'URL #navdebug pour observer le comportement réel sur appareil (history.length,
  // popstate, exceptions pushState) — impossible à reproduire hors Android PWA.
  // Activation robuste : #navdebug dans l'URL (persisté en localStorage car la PWA se
  // relance toujours sur "/" sans le hash) OU flag localStorage déjà posé. #navdebugoff coupe.
  const [navDebugOn, setNavDebugOn] = useState(() => {
    try {
      const h = window.location.hash || '';
      if (h.includes('navdebugoff')) { localStorage.removeItem('_navdebug'); return false; }
      if (h.includes('navdebug')) { localStorage.setItem('_navdebug', '1'); return true; }
      return localStorage.getItem('_navdebug') === '1';
    } catch { return false; }
  });
  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash || '';
      if (h.includes('navdebugoff')) { try { localStorage.removeItem('_navdebug'); } catch {} setNavDebugOn(false); }
      else if (h.includes('navdebug')) { try { localStorage.setItem('_navdebug', '1'); } catch {} setNavDebugOn(true); }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  // Activation alternative : 5 taps rapides sur le coin haut-gauche (marche dans la PWA
  // installée, sans manipuler l'URL). Bascule le diagnostic et persiste le flag.
  const tapCntRef = useRef(0);
  const tapTimerRef = useRef(null);
  const onDebugTap = useCallback(() => {
    tapCntRef.current += 1;
    clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => { tapCntRef.current = 0; }, 1500);
    if (tapCntRef.current >= 5) {
      tapCntRef.current = 0;
      setNavDebugOn(on => {
        const next = !on;
        try { next ? localStorage.setItem('_navdebug', '1') : localStorage.removeItem('_navdebug'); } catch {}
        return next;
      });
    }
  }, []);

  // Journal PERSISTANT (localStorage) → survit à la fermeture de l'app, pour voir le retour
  // qui ferme. `i=` = position réelle dans l'historique (Navigation API). Un « mount » au
  // milieu de la séquence = un rechargement (reset) intempestif.
  const [navDebug, setNavDebug] = useState(() => {
    try { return JSON.parse(localStorage.getItem('_navlog') || '[]'); } catch { return []; }
  });
  const logNav = useCallback((msg) => {
    if (!navDebugOn) return;
    const idx = (typeof window !== 'undefined' && window.navigation?.currentEntry) ? window.navigation.currentEntry.index : '?';
    const line = `${new Date().toISOString().slice(17, 23)} ${msg} H=${history.length} i=${idx}`;
    setNavDebug(d => {
      const next = [...d.slice(-19), line];
      try { localStorage.setItem('_navlog', JSON.stringify(next)); } catch {}
      return next;
    });
  }, [navDebugOn]);

  const armBuffer = useCallback((n) => {
    let pushed = 0;
    for (let i = 0; i < n; i++) {
      try { history.pushState({ pwaSentinel: true }, ''); pushed++; }
      catch (e) { logNav(`pushState THREW @${i} ${e.name}`); break; }
    }
    return pushed;
  }, [logNav]);

  useEffect(() => {
    try { history.replaceState({ pwaSentinel: true }, ''); } catch { /* noop */ }
    const p = armBuffer(20);
    logNav(`mount armed=${p}`);

    // Android peut vider l'historique lors d'une mise en arrière-plan (BFCache / freeze).
    // On réarme dès que la page redevient visible ou est restaurée depuis BFCache.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        const r = armBuffer(10);
        logNav(`rearm-visible=${r}`);
      }
    };
    const onPageShow = (e) => {
      if (e.persisted) { const r = armBuffer(10); logNav(`rearm-pageshow=${r}`); }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [armBuffer, logNav]);

  useEffect(() => {
    let _lastNav = 0;
    const handler = () => {
      logNav(`popstate ouv=${!!ouvertRef.current} vis=${!!selectedVisiteIdRef.current} child=${!!childBackHandler.current}`);
      // Réarme le buffer (consomme 1, repousse 4 → solde +3 si pushState fonctionne).
      armBuffer(4);
      // Debounce : deux appuis très rapprochés (< 350ms) ne reculent que d'un niveau.
      const now = Date.now();
      if (now - _lastNav < 350) { logNav('debounced'); return; }
      _lastNav = now;

      if (childBackHandler.current?.()) {
        logNav('child handled');
      } else if (selectedVisiteIdRef.current) {
        setSelectedVisiteId(null); logNav('-> visite=null');
      } else if (ouvertRef.current) {
        setOuvert(null); logNav('-> ouvert=null');
      } else {
        logNav('rien à dépiler (racine)');
      }
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [armBuffer, logNav]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndo()) {
          undo();
          setUndoToast('Modification annulée');
          clearTimeout(undoToastRef.current);
          undoToastRef.current = setTimeout(() => setUndoToast(null), 2500);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo]);

  // Après 6s sans réponse Supabase, afficher le cache local avec bandeau "sync en cours"
  useEffect(() => {
    if (remoteLoaded) return;
    const t = setTimeout(() => setSplashTimedOut(true), 6000);
    return () => clearTimeout(t);
  }, [remoteLoaded]);

  // Garder le splash jusqu'à avoir quelque chose à afficher :
  // - timeout déclenché ET cache local non vide → dashboard + bandeau jaune
  // - cache local vide → splash jusqu'au chargement Supabase (évite les tuiles vides)
  const hasDataToShow = hydrated && projets.length > 0;
  const showSplash = !remoteLoaded && (!splashTimedOut || !hasDataToShow);

  const dotColor = syncStatus === 'ok' ? DA.urgGrn : syncStatus === 'saving' ? DA.urgAmb : DA.red;
  const dotLabel = syncStatus === 'saving' ? 'Sauvegarde…' : syncStatus === 'error' ? 'Erreur sync' : 'Sauvegardé';

  const handleArchive = (id) => { updateProjet(id, { statut: 'archive' }); setOuvert(null); };
  const handleUnarchive = (id) => {
    updateProjet(id, { statut: 'en_cours' });
    hydratePhotos(id);
    hydratePlanLibrary(id).then(lm => hydratePlans(id, lm));
  };

  if (showSplash) return (
    <div style={{ position:'fixed',inset:0,background:'white',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:32,zIndex:9999 }}>
      {logoUrl && <img src={logoUrl} alt="Assemblage Ingénierie" style={{ width:220,maxWidth:'60vw',objectFit:'contain' }}/>}
      <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:10,color:DA.grayL }}>
        <Ic n="spn" s={28}/>
        <span style={{ fontSize:11,letterSpacing:1,textTransform:'uppercase',fontWeight:600 }}>Chargement…</span>
      </div>
    </div>
  );

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 900;

  return (
    <div style={{ display:'flex',flexDirection:'column',height:'100dvh',width:'100%',fontFamily:"'Inter',system-ui,sans-serif",background:DA.grayXL }}>

      {/* Zone invisible (coin haut-gauche) : 5 taps activent le diagnostic retour (#navdebug) */}
      <div onClick={onDebugTap} style={{ position:'fixed', top:0, left:0, width:44, height:44, zIndex:100000, background:'transparent' }} />

      {/* Header — caché sur mobile quand dans un projet */}
      {!(isMobile && ouvert) && <div style={{ background:DA.white,borderBottom:`1px solid ${DA.border}`,padding:'8px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0 }}>
        <div style={{ display:'flex',alignItems:'center',cursor: ouvert ? 'pointer' : 'default' }} onClick={() => setOuvert(null)}>
          <img src={headerLogoUrl} alt="Assemblage Ingénierie" style={{ height:36,objectFit:'contain' }}/>
        </div>
        <div style={{ display:'flex',alignItems:'center',gap:8 }}>
          {profile?.role === 'admin' && (
            <button onClick={() => { setShowAdmin(true); setPendingCount(0); }} style={{ position:'relative',background:DA.redL,border:'none',color:DA.red,fontSize:11,fontWeight:600,padding:'4px 8px',borderRadius:6,cursor:'pointer' }}>
              Admin
              {pendingCount > 0 && (
                <span style={{ position:'absolute',top:-6,right:-6,background:DA.red,color:'white',borderRadius:'50%',width:16,height:16,fontSize:10,fontWeight:800,display:'flex',alignItems:'center',justifyContent:'center',lineHeight:1 }}>{pendingCount}</span>
              )}
            </button>
          )}
          {onLogout && (
            <button onClick={onLogout} style={{ background:'none',border:`1px solid ${DA.border}`,color:DA.gray,fontSize:10,padding:'3px 7px',borderRadius:5,cursor:'pointer' }}>Sortir</button>
          )}
          <button onClick={handleRefresh} disabled={refreshing} title="Actualiser depuis le serveur"
            style={{ display:'flex',alignItems:'center',gap:4,background:'none',border:`1px solid ${DA.border}`,color:DA.gray,fontSize:10,fontWeight:600,padding:'3px 8px',borderRadius:5,cursor:refreshing?'default':'pointer' }}>
            {refreshing ? <Ic n="spn" s={11}/> : <Ic n="rld" s={11}/>}
            Actualiser
          </button>
          <div style={{ display:'flex',alignItems:'center',gap:5,padding:'3px 8px',borderRadius:8,background:syncStatus==='error'?DA.redL:syncStatus==='saving'?'#FEF3C7':DA.grayXL,transition:'background 0.3s' }}>
            {syncStatus === 'saving' ? <Ic n="spn" s={10}/> : <div style={{ width:6,height:6,borderRadius:'50%',background:dotColor,transition:'background 0.3s' }}/>}
            <span style={{ color:syncStatus==='error'?DA.red:syncStatus==='saving'?DA.urgAmb:DA.grayL,fontSize:10,fontWeight:600,transition:'color 0.3s' }}>{dotLabel}</span>
          </div>
        </div>
      </div>}

      {/* Bandeau connexion lente — desktop ou hors projet */}
      {!remoteLoaded && splashTimedOut && hasDataToShow && !(isMobile && ouvert) && (
        <div style={{ background:'#78350F', padding:'6px 16px', display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          <Ic n="spn" s={12}/>
          <span style={{ fontSize:11, color:'#FEF3C7', fontWeight:600 }}>Synchronisation en cours — données du cache affichées</span>
        </div>
      )}

      {/* Bandeau hors ligne — toujours visible, desktop + mobile */}
      {!isOnline && (
        <div style={{ background:'#1C1917', padding:'7px 16px', display:'flex', alignItems:'center', gap:8, flexShrink:0, zIndex:40 }}>
          <span style={{ fontSize:14 }}>📵</span>
          <span style={{ fontSize:12, color:'#FEF3C7', fontWeight:700, flex:1 }}>Hors ligne — modifications sauvegardées localement, synchronisation à la reconnexion</span>
        </div>
      )}

      {/* Pastille sync mobile — VisitesScreen et VueProjet ont leur propre indicateur dans leur header */}
      {isMobile && ouvert && false && (
        <div style={{ position:'fixed', bottom:18, right:14, zIndex:50, display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6, pointerEvents:'none' }}>
          {!isOnline && (
            <div style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:10, background:'#1C1917', boxShadow:'0 2px 12px rgba(0,0,0,0.35)' }}>
              <span style={{ fontSize:11 }}>📵</span>
              <span style={{ fontSize:11, color:'#FEF3C7', fontWeight:700 }}>Hors ligne</span>
            </div>
          )}
          {isOnline && !remoteLoaded && splashTimedOut && hasDataToShow && (
            <div style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:10, background:'#78350F', boxShadow:'0 2px 12px rgba(0,0,0,0.25)' }}>
              <Ic n="spn" s={11}/>
              <span style={{ fontSize:11, color:'#FEF3C7', fontWeight:700 }}>Sync en cours…</span>
            </div>
          )}
          <div style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 10px', borderRadius:10,
            background: syncStatus==='error' ? '#FEE2E2' : syncStatus==='saving' ? '#FEF3C7' : 'white',
            boxShadow:'0 2px 12px rgba(0,0,0,0.18)', border: `1px solid ${syncStatus==='error'?'#FCA5A5':syncStatus==='saving'?'#FDE68A':'#E5E5E5'}` }}>
            {syncStatus === 'saving' ? <Ic n="spn" s={11}/> : <div style={{ width:7, height:7, borderRadius:'50%', background:dotColor }}/>}
            <span style={{ fontSize:12, fontWeight:700, color: syncStatus==='error'?DA.red:syncStatus==='saving'?'#92400E':DA.gray }}>{dotLabel}</span>
          </div>
        </div>
      )}

      {/* Bandeau erreur de chargement */}
      {loadError && projets.length === 0 && (
        <div style={{ background:'#7f1d1d', padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <Ic n="x" s={14} color="#FCA5A5"/>
            <div>
              <span style={{ fontSize:12, color:'#FEF2F2', fontWeight:700 }}>Impossible de charger les projets</span>
              <span style={{ fontSize:10, color:'rgba(252,161,161,0.8)', marginLeft:8 }}>{loadError}</span>
            </div>
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{ background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.3)', color:'#fff', fontSize:11, fontWeight:700, padding:'4px 10px', borderRadius:6, cursor:'pointer', flexShrink:0 }}
          >
            Réessayer
          </button>
        </div>
      )}

      {/* Corps */}
      <div style={{ flex:1,overflow:'hidden' }}>
        {ouvert && selectedVisiteId ? (
          <VueProjet
            projet={projets.find(p => p.id === ouvert.id) ?? ouvert}
            visiteId={selectedVisiteId}
            onBack={() => setSelectedVisiteId(null)}
            onRefresh={handleRefresh}
            refreshing={refreshing}
            onUpdate={upd => updateProjet(ouvert.id, upd)}
            onDeletePlan={id => deletePlanFromLibrary(ouvert.id, id)}
            setBackHandler={setBackHandler}
            syncStatus={syncStatus}
          />
        ) : ouvert ? (
          <VisitesScreen
            projet={projets.find(p => p.id === ouvert.id) ?? ouvert}
            onBack={() => { setOuvert(null); setSelectedVisiteId(null); }}
            onSelectVisite={setSelectedVisiteId}
            onUpdateProjet={upd => updateProjet(ouvert.id, upd)}
            syncStatus={syncStatus}
            onRefresh={handleRefresh}
            refreshing={refreshing}
          />
        ) : (
          <div style={{ height:'100%',overflowY:'auto' }}>
            <Dashboard
              projets={projets}
              remoteLoaded={remoteLoaded}
              staleIds={staleIds}
              onSelect={(p) => { setOuvert(p); setSelectedVisiteId(null); hydratePlanLibrary(p.id).then(lm => hydratePlans(p.id, lm)); }}
              onNew={() => setShowNew(true)}
              onUpd={updateProjet}
              onArchive={handleArchive}
              onUnarchive={handleUnarchive}
              onDelete={deleteProjet}
              onEdit={setEditTarget}
            />
          </div>
        )}
      </div>

      {showNew && <NewProjet onClose={() => setShowNew(false)} onSave={(f) => { addProjet(f); setShowNew(false); }}/>}
      {editTarget && <EditProjet projet={editTarget} onClose={() => setEditTarget(null)} onSave={(f) => { updateProjet(editTarget.id, f); setEditTarget(null); }}/>}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} onPendingCountChange={setPendingCount}/>}

      {undoToast && (
        <div style={{ position:'fixed',bottom:24,left:'50%',transform:'translateX(-50%)',background:'rgba(30,30,30,0.92)',color:'#fff',padding:'10px 20px',borderRadius:10,fontSize:13,fontWeight:600,boxShadow:'0 4px 20px rgba(0,0,0,0.3)',zIndex:9999,pointerEvents:'none',display:'flex',alignItems:'center',gap:8 }}>
          <Ic n="und" s={15}/>
          {undoToast}
        </div>
      )}

      {navDebugOn && (
        <div onClick={() => { try { localStorage.removeItem('_navlog'); } catch {} setNavDebug([]); }}
          style={{ position:'fixed', bottom:0, left:0, right:0, zIndex:99999, background:'rgba(0,0,0,0.92)', color:'#0f0', fontSize:10, fontFamily:'monospace', padding:'6px 8px', maxHeight:200, overflowY:'auto', lineHeight:1.5 }}>
          <div style={{ color:'#ff0', fontWeight:700 }}>
            navAPI={String('navigation' in window)} · dm={window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser'} · H={history.length} (tap = vider)
          </div>
          {navDebug.map((l, i) => <div key={i} style={l.includes('RELOAD') ? { color:'#f55', fontWeight:700 } : undefined}>{l}</div>)}
        </div>
      )}
    </div>
  );
}
