import React, { useEffect, useState } from 'react';
import { DA } from '../../lib/constants.js';
import { subscribePresence, subscribePresenceStatus, groupPresence, colorFor } from '../../lib/presence.js';

// Bulles des personnes connectées (barre du haut, à côté du logo — demande Thomas 26/10) :
// photo du compte (Google), sinon initiales sur fond de couleur. Ma bulle en premier : verte
// = direct actif ; grise = direct indisponible (survol : la raison). Survol d'une autre bulle :
// nom, appareil, projet, observation ; clic : ouvre son projet. Liseré vert = même projet que
// moi ; pastille orange = en train d'écrire dans une observation.

function Face({ person, size = 30, ring = 'white', faded = false }) {
  const [broken, setBroken] = useState(false);
  const showImg = person?.avatar && !broken;
  return (
    <span style={{ position:'relative', display:'flex', width:size, height:size, borderRadius:'50%', border:`2px solid ${ring}`, overflow:'hidden', flexShrink:0,
      background: colorFor(person?.userId), color:'white', fontSize: Math.round(size * 0.36), fontWeight:800, alignItems:'center', justifyContent:'center',
      boxShadow:'0 1px 3px rgba(0,0,0,0.25)', opacity: faded ? 0.45 : 1, filter: faded ? 'grayscale(1)' : 'none' }}>
      {showImg
        ? <img src={person.avatar} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
        : (person?.initials || '?')}
    </span>
  );
}

export default function PresenceBubbles({ projets = [], currentProjectId = null, onOpenProject = null }) {
  const [others, setOthers] = useState([]);
  const [status, setStatus] = useState('off');
  const [me, setMe] = useState(null);
  useEffect(() => subscribePresence(setOthers), []);
  useEffect(() => subscribePresenceStatus((st, m) => { setStatus(st); setMe(m ? { ...m } : null); }), []);
  if (!me) return null;

  const people = groupPresence(others);
  const nomOf = (id) => projets.find(p => p.id === id)?.nom || null;
  const itemOf = (pid, iid) => {
    const p = projets.find(x => x.id === pid);
    for (const v of (p?.visites || [])) for (const l of (v.localisations || [])) for (const it of (l.items || [])) if (it.id === iid) return it.titre || 'une observation';
    return null;
  };
  const shown = people.slice(0, 5);
  const more = people.length - shown.length;
  const live = status === 'ok';
  const meTitle = live
    ? `Vous — travail à plusieurs actif${people.length ? '' : ' (personne d\'autre connecté pour l\'instant)'}`
    : status === 'connecting' ? 'Vous — connexion au direct…' : `Vous — direct indisponible (${status})`;

  return (
    <div style={{ display:'flex', alignItems:'center', marginLeft:14, gap:8 }}>
      <span title={meTitle} aria-label={meTitle} style={{ position:'relative', display:'flex' }}>
        <Face person={me} size={28} faded={!live}/>
        <span style={{ position:'absolute', bottom:-1, right:-1, width:9, height:9, borderRadius:'50%', border:'2px solid white',
          background: live ? DA.urgGrn : status === 'connecting' ? '#F59E0B' : '#9CA3AF' }}/>
      </span>
      {shown.length > 0 && (
        <span style={{ display:'flex', alignItems:'center' }} aria-label={`${people.length} autre${people.length > 1 ? 's' : ''} personne${people.length > 1 ? 's' : ''} connectée${people.length > 1 ? 's' : ''}`}>
          {shown.map((o, i) => {
            const nom = nomOf(o.projectId);
            const obs = o.itemId ? itemOf(o.projectId, o.itemId) : null;
            const here = currentProjectId && o.projectId === currentProjectId;
            const title = `${o.name}${o.device === 'mobile' ? ' (téléphone)' : ''} — ${nom ? `dans « ${nom} »` : 'sur l\'accueil'}${obs ? `, écrit dans « ${obs} »` : ''}`;
            return (
              <button key={`${o.userId}|${o.device}`} title={title} aria-label={title}
                onClick={() => { if (o.projectId && onOpenProject) onOpenProject(o.projectId); }}
                style={{ position:'relative', marginLeft: i ? -7 : 0, padding:0, border:'none', background:'none', borderRadius:'50%', cursor: o.projectId ? 'pointer' : 'default', zIndex: 10 - i, display:'flex' }}>
                <Face person={o} ring={here ? DA.urgGrn : 'white'}/>
                {obs && <span style={{ position:'absolute', bottom:-2, right:-2, width:10, height:10, borderRadius:'50%', background:'#F59E0B', border:'2px solid white' }}/>}
              </button>
            );
          })}
          {more > 0 && (
            <span title={people.slice(5).map(o => o.name).join(', ')}
              style={{ marginLeft:-7, width:30, height:30, borderRadius:'50%', border:'2px solid white', background:DA.grayXL, color:DA.gray, fontSize:11, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center' }}>
              +{more}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
