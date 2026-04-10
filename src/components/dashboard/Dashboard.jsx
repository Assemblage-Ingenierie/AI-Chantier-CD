import React, { useState } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import ProjectCard from './ProjectCard.jsx';
import PhotoModal from './PhotoModal.jsx';

const STEPS = [
  { n:1, icon:'plus', t:'Créez un projet', d:'"Nouveau" en haut à droite' },
  { n:2, icon:'pin',  t:'Ajoutez vos zones', d:'RDC, R+1, Toiture, Façades…' },
  { n:3, icon:'cam',  t:'Saisissez vos observations', d:'Avec photos, urgence et suivi' },
  { n:4, icon:'fil',  t:'Générez le rapport PDF', d:'Onglet Rapport → Exporter' },
];

function countItems(ps) {
  return ps.reduce((s,p) => s + (p.localisations||[]).reduce((ss,l) => {
    const n = l.sections?.length
      ? l.sections.reduce((sss,sec) => sss + (sec.items||[]).length, 0)
      : (l.items||[]).length;
    return ss + n;
  }, 0), 0);
}
function countUrgent(ps) {
  return ps.reduce((s,p) => s + (p.localisations||[]).reduce((ss,l) => {
    const items = l.sections?.length ? l.sections.flatMap(sec=>sec.items||[]) : (l.items||[]);
    return ss + items.filter(i => i.urgence === 'haute').length;
  }, 0), 0);
}

export default function Dashboard({ projets, onSelect, onNew, onUpd, onArchive, onUnarchive, onDelete }) {
  const [photoTgt, setPhotoTgt] = useState(null);
  const [menuOpen, setMenuOpen] = useState(null);

  const actifs   = projets.filter(p => p.statut !== 'archive');
  const archives = projets.filter(p => p.statut === 'archive');
  const stats = [
    { l:'Projets actifs',  v:actifs.length },
    { l:'Observations',    v:countItems(projets) },
    { l:'Archivés',        v:archives.length },
    { l:'Urgentes',        v:countUrgent(projets), red:true },
  ];

  return (
    <div style={{ padding:16,display:'flex',flexDirection:'column',gap:18 }} onClick={() => menuOpen && setMenuOpen(null)}>

      {/* En-tête */}
      <div style={{ display:'flex',alignItems:'flex-start',justifyContent:'space-between' }}>
        <div>
          <h1 style={{ fontSize:22,fontWeight:900,color:DA.black,margin:0,letterSpacing:-0.5 }}>
            <span style={{ color:DA.red }}>AI</span> chantier
          </h1>
          <p style={{ fontSize:11,color:DA.grayL,margin:'2px 0 0' }}>
            {new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})}
          </p>
        </div>
        <button onClick={onNew} style={{ background:DA.red,color:'white',border:'none',borderRadius:10,padding:'8px 16px',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:6 }}>
          <Ic n="plus" s={14}/> Nouveau
        </button>
      </div>

      {/* Stats */}
      <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10 }}>
        {stats.map(s => (
          <div key={s.l} style={{ background:DA.grayXL,borderRadius:12,padding:'12px 14px',border:`1px solid ${DA.border}` }}>
            <p style={{ fontSize:22,fontWeight:900,color:s.red ? DA.red : DA.black,margin:0 }}>{s.v}</p>
            <p style={{ fontSize:11,color:DA.gray,margin:'2px 0 0' }}>{s.l}</p>
          </div>
        ))}
      </div>

      {/* Projets actifs */}
      <div>
        <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10 }}>
          <h2 style={{ fontSize:13,fontWeight:800,color:DA.black,margin:0 }}>Projets en cours</h2>
          <span style={{ fontSize:11,background:DA.redL,color:DA.red,padding:'2px 8px',borderRadius:10,fontWeight:700 }}>{actifs.length}</span>
        </div>

        {actifs.length === 0 ? (
          <div style={{ borderRadius:14,overflow:'hidden',border:`1.5px solid ${DA.border}`,background:DA.white }}>
            <div style={{ background:'linear-gradient(135deg,#1a1a1a,#333)',padding:'20px 18px 16px',borderBottom:`3px solid ${DA.red}` }}>
              <p style={{ color:'white',fontWeight:800,fontSize:15,margin:'0 0 4px' }}>Bienvenue sur <span style={{ color:DA.red }}>AI</span> chantier</p>
              <p style={{ color:'rgba(255,255,255,0.5)',fontSize:12,margin:0 }}>Votre outil de visite chantier</p>
            </div>
            <div style={{ padding:16 }}>
              <p style={{ fontSize:12,fontWeight:700,color:DA.gray,textTransform:'uppercase',letterSpacing:0.5,margin:'0 0 12px' }}>Comment démarrer</p>
              {STEPS.map(s => (
                <div key={s.n} style={{ display:'flex',alignItems:'flex-start',gap:12,marginBottom:12 }}>
                  <div style={{ width:28,height:28,borderRadius:'50%',background:DA.red,color:'white',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:13,flexShrink:0 }}>{s.n}</div>
                  <div>
                    <p style={{ fontWeight:700,fontSize:13,color:DA.black,margin:0 }}>{s.t}</p>
                    <p style={{ fontSize:11,color:DA.grayL,margin:'2px 0 0' }}>{s.d}</p>
                  </div>
                </div>
              ))}
              <button onClick={onNew} style={{ width:'100%',marginTop:4,background:DA.red,color:'white',border:'none',borderRadius:12,padding:13,fontSize:14,fontWeight:800,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8 }}>
                <Ic n="plus" s={16}/> Créer mon premier projet
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display:'flex',flexDirection:'column',gap:10 }}>
            {actifs.map(p => <ProjectCard key={p.id} p={p} arc={false} onSelect={onSelect} onUpd={onUpd} onArchive={onArchive} onUnarchive={onUnarchive} onDelete={onDelete} menuOpen={menuOpen} setMenuOpen={setMenuOpen} setPhotoTgt={setPhotoTgt}/>)}
          </div>
        )}
      </div>

      {/* Archivés */}
      {archives.length > 0 && (
        <div>
          <h2 style={{ fontSize:12,fontWeight:700,color:DA.grayL,margin:'0 0 10px',display:'flex',alignItems:'center',gap:6 }}>
            <Ic n="arc" s={13}/> Archivés ({archives.length})
          </h2>
          <div style={{ display:'flex',flexDirection:'column',gap:10,opacity:0.65 }}>
            {archives.map(p => <ProjectCard key={p.id} p={p} arc={true} onSelect={onSelect} onUpd={onUpd} onArchive={onArchive} onUnarchive={onUnarchive} onDelete={onDelete} menuOpen={menuOpen} setMenuOpen={setMenuOpen} setPhotoTgt={setPhotoTgt}/>)}
          </div>
        </div>
      )}

      {photoTgt && <PhotoModal projet={photoTgt} onUpd={onUpd} onClose={() => setPhotoTgt(null)}/>}
    </div>
  );
}
