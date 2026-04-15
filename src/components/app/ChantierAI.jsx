import React, { useState } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { useProjets } from '../../hooks/useProjets.js';
import AdminPanel from '../auth/AdminPanel.jsx';
import Dashboard from '../dashboard/Dashboard.jsx';
import NewProjet from '../dashboard/NewProjet.jsx';
import EditProjet from '../dashboard/EditProjet.jsx';
import VueProjet from './VueProjet.jsx';

export default function ChantierAI({ profile, onLogout }) {
  const [syncStatus, setSyncStatus] = useState('ok');
  const [showAdmin, setShowAdmin] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [ouvert, setOuvert] = useState(null);

  const { projets, updateProjet, deleteProjet, addProjet, hydrated, remoteLoaded, hydratePhotos } = useProjets(setSyncStatus);

  // Écran de chargement : toujours attendre que Supabase ait répondu
  // Empêche toute interaction (création, suppression) avant que les données soient stables
  const showSplash = !remoteLoaded;

  const dotColor = syncStatus === 'ok' ? DA.urgGrn : syncStatus === 'saving' ? DA.urgAmb : DA.red;
  const dotLabel = syncStatus === 'saving' ? 'Sauvegarde…' : syncStatus === 'error' ? 'Erreur sync' : 'Sauvegardé';

  const handleArchive = (id) => { updateProjet(id, { statut: 'archive' }); setOuvert(null); };
  const handleUnarchive = (id) => updateProjet(id, { statut: 'en_cours' });

  if (showSplash) return (
    <div style={{ position:'fixed',inset:0,background:'white',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:32,zIndex:9999 }}>
      <img src="/logo_Ai_rouge_HD.png" alt="Assemblage Ingénierie" style={{ width:220,maxWidth:'60vw',objectFit:'contain' }}/>
      <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:10,color:DA.grayL }}>
        <Ic n="spn" s={28}/>
        <span style={{ fontSize:11,letterSpacing:1,textTransform:'uppercase',fontWeight:600 }}>Chargement…</span>
      </div>
    </div>
  );

  return (
    <div style={{ display:'flex',flexDirection:'column',height:'100vh',width:'100%',fontFamily:"'Inter',system-ui,sans-serif",background:DA.grayXL }}>

      {/* Header */}
      <div style={{ background:DA.black,padding:'10px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0 }}>
        <div style={{ display:'flex',alignItems:'center' }}>
          <img src="/logo_Ai_rouge_HD.png" alt="Assemblage Ingénierie" style={{ height:28,objectFit:'contain' }}/>
        </div>
        <div style={{ display:'flex',alignItems:'center',gap:8 }}>
          {profile?.role === 'admin' && (
            <button onClick={() => setShowAdmin(true)} style={{ background:'rgba(255,255,255,0.1)',border:'none',color:'rgba(255,255,255,0.7)',fontSize:11,fontWeight:600,padding:'4px 8px',borderRadius:6,cursor:'pointer' }}>Admin</button>
          )}
          {onLogout && (
            <button onClick={onLogout} style={{ background:'none',border:'1px solid rgba(255,255,255,0.2)',color:'rgba(255,255,255,0.5)',fontSize:10,padding:'3px 7px',borderRadius:5,cursor:'pointer' }}>Sortir</button>
          )}
          <div style={{ display:'flex',alignItems:'center',gap:5 }}>
            <div style={{ width:5,height:5,borderRadius:'50%',background:dotColor,transition:'background 0.3s' }}/>
            <span style={{ color:'rgba(255,255,255,0.3)',fontSize:10 }}>{dotLabel}</span>
          </div>
        </div>
      </div>

      {/* Corps */}
      <div style={{ flex:1,overflow:'hidden' }}>
        {ouvert ? (
          <VueProjet
            projet={projets.find(p => p.id === ouvert.id) ?? ouvert}
            onBack={() => setOuvert(null)}
            onUpdate={upd => updateProjet(ouvert.id, upd)}
          />
        ) : (
          <div style={{ height:'100%',overflowY:'auto' }}>
            <Dashboard
              projets={projets}
              onSelect={(p) => { setOuvert(p); hydratePhotos(p.id); }}
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
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)}/>}
    </div>
  );
}
