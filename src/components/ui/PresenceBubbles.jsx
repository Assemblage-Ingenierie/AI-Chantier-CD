import React, { useEffect, useState } from 'react';
import { DA } from '../../lib/constants.js';
import { subscribePresence, groupPresence, colorFor } from '../../lib/presence.js';

// Bulles des personnes connectées (barre du haut, à côté du logo — demande Thomas 26/10).
// Invisible quand personne d'autre n'est là. Survol : nom, appareil, projet ; clic : ouvre le
// projet où se trouve la personne. Liseré vert = dans le même projet que moi.
export default function PresenceBubbles({ projets = [], currentProjectId = null, onOpenProject = null }) {
  const [others, setOthers] = useState([]);
  useEffect(() => subscribePresence(setOthers), []);
  const people = groupPresence(others);
  if (!people.length) return null;

  const nomOf = (id) => projets.find(p => p.id === id)?.nom || null;
  const itemOf = (pid, iid) => {
    const p = projets.find(x => x.id === pid);
    for (const v of (p?.visites || [])) for (const l of (v.localisations || [])) for (const it of (l.items || [])) if (it.id === iid) return it.titre || 'une observation';
    return null;
  };
  const shown = people.slice(0, 5);
  const more = people.length - shown.length;

  return (
    <div style={{ display:'flex', alignItems:'center', marginLeft:14 }} aria-label={`${people.length} personne${people.length > 1 ? 's' : ''} connectée${people.length > 1 ? 's' : ''}`}>
      {shown.map((o, i) => {
        const nom = nomOf(o.projectId);
        const obs = o.itemId ? itemOf(o.projectId, o.itemId) : null;
        const here = currentProjectId && o.projectId === currentProjectId;
        const title = `${o.name}${o.device === 'mobile' ? ' (téléphone)' : ''} — ${nom ? `dans « ${nom} »` : 'sur l\'accueil'}${obs ? `, écrit dans « ${obs} »` : ''}`;
        return (
          <button key={`${o.userId}|${o.device}`} title={title} aria-label={title}
            onClick={() => { if (o.projectId && onOpenProject) onOpenProject(o.projectId); }}
            style={{ position:'relative', width:30, height:30, marginLeft: i ? -7 : 0, borderRadius:'50%', border:`2px solid ${here ? DA.urgGrn : 'white'}`,
              background: colorFor(o.userId), color:'white', fontSize:11, fontWeight:800, letterSpacing:0.2, cursor: o.projectId ? 'pointer' : 'default',
              display:'flex', alignItems:'center', justifyContent:'center', padding:0, boxShadow:'0 1px 3px rgba(0,0,0,0.25)', zIndex: 10 - i }}>
            {o.initials || '?'}
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
    </div>
  );
}
