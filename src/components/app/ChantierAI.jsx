import React, { useState } from 'react';
import { DA } from '../../lib/constants.js';
import { useProjets } from '../../hooks/useProjets.js';
import AdminPanel from '../auth/AdminPanel.jsx';
import Dashboard from '../dashboard/Dashboard.jsx';
import NewProjet from '../dashboard/NewProjet.jsx';

export default function ChantierAI({ profile, onLogout }) {
  const [syncStatus, setSyncStatus] = useState('ok');
  const [showAdmin, setShowAdmin] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [ouvert, setOuvert] = useState(null);

  const { projets, updateProjet, deleteProjet, addProjet } = useProjets(setSyncStatus);

  const dotColor = syncStatus === 'ok' ? DA.urgGrn : syncStatus === 'saving' ? DA.urgAmb : DA.red;
  const dotLabel = syncStatus === 'saving' ? 'Sauvegarde…' : syncStatus === 'error' ? 'Erreur sync' : 'Sauvegardé';

  const handleArchive = (id) => { updateProjet(id, { statut: 'archive' }); setOuvert(null); };
  const handleUnarchive = (id) => updateProjet(id, { statut: 'en_cours' });

  return (
    <div style={{ display:'flex',flexDirection:'column',height:'100vh',maxWidth:390,margin:'0 auto',fontFamily:"'Inter',system-ui,sans-serif",background:DA.grayXL }}>

      {/* Header */}
      <div style={{ background:DA.black,padding:'10px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0 }}>
        <div style={{ display:'flex',alignItems:'center',gap:10 }}>
          <div style={{ width:3,height:20,background:DA.red,borderRadius:2 }}/>
          <div style={{ display:'flex',flexDirection:'column',lineHeight:1.1 }}>
            <span style={{ color:DA.red,fontWeight:900,fontSize:12,fontStyle:'italic',letterSpacing:-0.5 }}>
              Assembl<span style={{ color:'white' }}>!</span>age
            </span>
            <span style={{ color:'rgba(255,255,255,0.7)',fontWeight:700,fontSize:9,fontStyle:'italic',letterSpacing:-0.3 }}>ingénierie</span>
          </div>
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
          // VueProjet sera migré à l'étape 5
          <div style={{ height:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:32,textAlign:'center' }}>
            <p style={{ fontWeight:700,fontSize:16,color:DA.black,marginBottom:8 }}>{ouvert.nom}</p>
            <p style={{ color:DA.gray,fontSize:13,marginBottom:24 }}>Vue projet en cours de migration…</p>
            <button onClick={() => setOuvert(null)} style={{ padding:'10px 20px',borderRadius:8,background:DA.red,color:'white',border:'none',fontSize:13,fontWeight:700,cursor:'pointer' }}>← Retour</button>
          </div>
        ) : (
          <div style={{ height:'100%',overflowY:'auto' }}>
            <Dashboard
              projets={projets}
              onSelect={setOuvert}
              onNew={() => setShowNew(true)}
              onUpd={updateProjet}
              onArchive={handleArchive}
              onUnarchive={handleUnarchive}
              onDelete={deleteProjet}
            />
          </div>
        )}
      </div>

      {showNew && <NewProjet onClose={() => setShowNew(false)} onSave={(f) => { addProjet(f); setShowNew(false); }}/>}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)}/>}
    </div>
  );
}
