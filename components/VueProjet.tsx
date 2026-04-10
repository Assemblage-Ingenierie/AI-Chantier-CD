'use client'
import { useState, useEffect } from 'react'
import type { Projet, Localisation, Item, Section, Participant, TableauRow, PlanLib, Urgence, Suivi } from '@/lib/types'
import { ItemModal } from './ItemModal'
import { TableauRecap } from './TableauRecap'
import { PlanLibModal } from './PlanLibModal'
import { PlanLocModal } from './PlanLocModal'
import { PreviewRapport } from './PreviewRapport'

const URGENCE_CYCLE: Urgence[] = ['haute', 'moyenne', 'basse']
const SUIVI_CYCLE: Suivi[] = ['rien', 'a_faire', 'en_cours', 'prochaine', 'fait']

const URGENCE: Record<Urgence, { bg:string; text:string; dot:string; border:string; label:string; hex:string }> = {
  haute: { bg:'#FFF0F0', text:'#B91C1C', dot:'#E30513', border:'#FCA5A5', label:'Urgent', hex:'#E30513' },
  moyenne: { bg:'#FFFBEB', text:'#92400E', dot:'#D97706', border:'#FCD34D', label:'À planifier', hex:'#D97706' },
  basse: { bg:'#F0FDF4', text:'#15803D', dot:'#16A34A', border:'#86EFAC', label:'Mineur', hex:'#16A34A' },
}

const SUIVI_MAP: Record<Suivi, { label:string; bg:string; text:string; dot:string; border:string }> = {
  rien: { label:'—', bg:'#F3F4F6', text:'#6B7280', dot:'#9CA3AF', border:'#E5E7EB' },
  a_faire: { label:'À faire', bg:'#FFF7ED', text:'#C2410C', dot:'#F97316', border:'#FED7AA' },
  en_cours: { label:'En cours', bg:'#EFF6FF', text:'#1D4ED8', dot:'#3B82F6', border:'#BFDBFE' },
  prochaine: { label:'Prochaine visite', bg:'#FDF4FF', text:'#7E22CE', dot:'#A855F7', border:'#E9D5FF' },
  fait: { label:'Fait', bg:'#F0FDF4', text:'#15803D', dot:'#22C55E', border:'#BBF7D0' },
}

function cycleUrgence(u: Urgence): Urgence {
  return URGENCE_CYCLE[(URGENCE_CYCLE.indexOf(u) + 1) % URGENCE_CYCLE.length]
}
function cycleSuivi(s: Suivi): Suivi {
  return SUIVI_CYCLE[(SUIVI_CYCLE.indexOf(s) + 1) % SUIVI_CYCLE.length]
}

function UrgenceBadge({ value, onClick }: { value: Urgence; onClick?: () => void }) {
  const u = URGENCE[value]
  return (
    <span onClick={onClick} style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:600, background:u.bg, color:u.text, border:`1px solid ${u.border}`, cursor:onClick?'pointer':'default' }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:u.dot }} />
      {u.label}
    </span>
  )
}

function SuiviBadge({ value, small, onClick }: { value: Suivi; small?: boolean; onClick?: () => void }) {
  const s = SUIVI_MAP[value]
  return (
    <span onClick={onClick} style={{ display:'inline-flex', alignItems:'center', gap:3, padding:small?'1px 6px':'2px 8px', borderRadius:20, fontSize:small?9:10, fontWeight:700, background:s.bg, color:s.text, border:`1px solid ${s.border}`, cursor:onClick?'pointer':'default' }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:s.dot }} />
      {s.label}
    </span>
  )
}

interface Props {
  projet: Projet
  onBack: () => void
  onUpdate: (p: Projet) => void
}

export function VueProjet({ projet, onBack, onUpdate }: Props) {
  const [tab, setTab] = useState<'visite'|'rapport'>('visite')
  const [locs, setLocs] = useState<Localisation[]>(projet.localisations ?? [])
  const [participants, setParticipants] = useState<Participant[]>(projet.participants ?? [])
  const [maitreOuvrage, setMaitreOuvrage] = useState(projet.maitreOuvrage ?? '')
  const [dateVisite, setDateVisite] = useState(projet.dateVisite ?? '')
  const [tableauData, setTableauData] = useState<TableauRow[]>(projet.tableauRecap ?? [])
  const [photosParLigne, setPhotosParLigne] = useState<1|2|3>(projet.photosParLigne ?? 2)
  const [openLoc, setOpenLoc] = useState<number|null>(null)
  const [itemModal, setItemModal] = useState<{locId:number; secId?:number; item:Item|null}|null>(null)
  const [showAddLoc, setShowAddLoc] = useState(false)
  const [newLocNom, setNewLocNom] = useState('')
  const [showAddPart, setShowAddPart] = useState(false)
  const [newPart, setNewPart] = useState<Partial<Participant>>({ nom:'', role:'', tel:'', email:'', presence:'present' })
  const [sortLocMode, setSortLocMode] = useState(false)
  const [dragLoc, setDragLoc] = useState<number|null>(null)
  const [dragLocOver, setDragLocOver] = useState<number|null>(null)
  const [editNomProjet, setEditNomProjet] = useState(false)
  const [nomProjet, setNomProjet] = useState(projet.nom)
  const [planLibrary, setPlanLibrary] = useState<PlanLib[]>(projet.planLibrary ?? [])
  const [showPlanLib, setShowPlanLib] = useState(false)
  const [planLocId, setPlanLocId] = useState<number|null>(null)
  const [showPreview, setShowPreview] = useState(false)

  // Sync up to parent on any change
  useEffect(() => {
    onUpdate({ ...projet, nom: nomProjet, localisations: locs, participants, maitreOuvrage, dateVisite, tableauRecap: tableauData, photosParLigne, planLibrary })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locs, participants, maitreOuvrage, dateVisite, tableauData, photosParLigne, nomProjet, planLibrary])

  // --- Helpers ---
  function getAllItems(p?: Projet) {
    return (p?.localisations ?? locs).flatMap(l =>
      (l.sections?.length ? l.sections.flatMap(s => s.items ?? []) : l.items ?? [])
    )
  }
  function countUrgent(l: Localisation) {
    const items = l.sections?.length ? l.sections.flatMap(s => s.items ?? []) : (l.items ?? [])
    return items.filter(i => i.urgence === 'haute').length
  }
  function barColor(l: Localisation) {
    const u = countUrgent(l)
    if (u > 0) return '#E30513'
    const items = l.sections?.length ? l.sections.flatMap(s => s.items ?? []) : (l.items ?? [])
    if (items.some(i => i.urgence === 'moyenne')) return '#D97706'
    return '#E8E8E8'
  }

  // --- Locs CRUD ---
  function addLoc() {
    if (!newLocNom.trim()) return
    const loc: Localisation = { id: Date.now(), nom: newLocNom.trim(), items: [], sections: [] }
    setLocs([...locs, loc])
    setNewLocNom(''); setShowAddLoc(false)
  }
  function updateLoc(id: number, patch: Partial<Localisation>) {
    setLocs(locs.map(l => l.id === id ? { ...l, ...patch } : l))
  }
  function deleteLoc(id: number) {
    setLocs(locs.filter(l => l.id !== id))
    if (openLoc === id) setOpenLoc(null)
  }

  // --- Items CRUD ---
  function saveItem(locId: number, secId: number|undefined, item: Item) {
    setLocs(locs.map(l => {
      if (l.id !== locId) return l
      if (secId != null) {
        return { ...l, sections: (l.sections ?? []).map(s => s.id !== secId ? s : {
          ...s, items: s.items?.find(i => i.id === item.id)
            ? s.items.map(i => i.id === item.id ? item : i)
            : [...(s.items ?? []), item]
        })}
      }
      const items = l.items ?? []
      return { ...l, items: items.find(i => i.id === item.id)
        ? items.map(i => i.id === item.id ? item : i)
        : [...items, item]
      }
    }))
    setItemModal(null)
  }
  function deleteItem(locId: number, secId: number|undefined, itemId: number) {
    setLocs(locs.map(l => {
      if (l.id !== locId) return l
      if (secId != null) {
        return { ...l, sections: (l.sections ?? []).map(s => s.id !== secId ? s : { ...s, items: (s.items ?? []).filter(i => i.id !== itemId) })}
      }
      return { ...l, items: (l.items ?? []).filter(i => i.id !== itemId) }
    }))
  }
  function cycleItemUrgence(locId: number, secId: number|undefined, itemId: number) {
    setLocs(locs.map(l => {
      if (l.id !== locId) return l
      const mapItem = (i: Item) => i.id === itemId ? { ...i, urgence: cycleUrgence(i.urgence ?? 'basse') } : i
      if (secId != null) return { ...l, sections: (l.sections ?? []).map(s => s.id !== secId ? s : { ...s, items: (s.items ?? []).map(mapItem) }) }
      return { ...l, items: (l.items ?? []).map(mapItem) }
    }))
  }
  function cycleItemSuivi(locId: number, secId: number|undefined, itemId: number) {
    setLocs(locs.map(l => {
      if (l.id !== locId) return l
      const mapItem = (i: Item) => i.id === itemId ? { ...i, suivi: cycleSuivi(i.suivi ?? 'rien') } : i
      if (secId != null) return { ...l, sections: (l.sections ?? []).map(s => s.id !== secId ? s : { ...s, items: (s.items ?? []).map(mapItem) }) }
      return { ...l, items: (l.items ?? []).map(mapItem) }
    }))
  }

  // --- Update item fields (from Preview) ---
  function updateItemFields(locId: number, secId: number|undefined, itemId: number, updates: Partial<Item>) {
    setLocs(locs.map(l => {
      if (l.id !== locId) return l
      const mapItem = (i: Item) => i.id === itemId ? { ...i, ...updates } : i
      if (secId != null) return { ...l, sections: (l.sections ?? []).map(s => s.id !== secId ? s : { ...s, items: (s.items ?? []).map(mapItem) }) }
      return { ...l, items: (l.items ?? []).map(mapItem) }
    }))
  }

  // --- Participants ---
  function addPart() {
    if (!newPart.nom?.trim()) return
    setParticipants([...participants, { id: Date.now(), ...newPart } as Participant])
    setNewPart({ nom:'', role:'', tel:'', email:'', presence:'present' })
    setShowAddPart(false)
  }
  function deletePart(id: number) { setParticipants(participants.filter(p => p.id !== id)) }
  function updatePart(id: number, patch: Partial<Participant>) {
    setParticipants(participants.map(p => p.id === id ? { ...p, ...patch } : p))
  }

  // --- Drag & drop locs ---
  function handleDragStart(idx: number) { setDragLoc(idx) }
  function handleDragOver(e: React.DragEvent, idx: number) { e.preventDefault(); setDragLocOver(idx) }
  function handleDrop(idx: number) {
    if (dragLoc == null || dragLoc === idx) { setDragLoc(null); setDragLocOver(null); return }
    const next = [...locs]
    const [moved] = next.splice(dragLoc, 1)
    next.splice(idx, 0, moved)
    setLocs(next)
    setDragLoc(null); setDragLocOver(null)
  }

  // --- Stats for tabs ---
  const totalItems = getAllItems().length
  const urgentItems = getAllItems().filter(i => i.urgence === 'haute').length

  function renderItems(items: Item[], locId: number, secId?: number) {
    return items.map(item => (
      <div key={item.id}
        style={{ padding:'12px 16px', borderBottom:`1px solid #F3F4F6`, display:'flex', alignItems:'flex-start', gap:12, cursor:'pointer' }}
        onClick={() => setItemModal({ locId, secId, item })}>
        {/* Left dot */}
        <div style={{ width:8, height:8, borderRadius:'50%', background: URGENCE[item.urgence ?? 'basse'].dot, marginTop:4, flexShrink:0 }} />
        {/* Content */}
        <div style={{ flex:1, minWidth:0 }}>
          <p style={{ fontSize:13, fontWeight:600, color:'#222222', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.titre}</p>
          {item.commentaire && <p style={{ fontSize:11, color:'#697280', margin:'2px 0 0', overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>{item.commentaire}</p>}
          <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:4, flexWrap:'wrap' }}>
            <UrgenceBadge value={item.urgence ?? 'basse'} onClick={() => cycleItemUrgence(locId, secId, item.id)} />
            <SuiviBadge value={item.suivi ?? 'rien'} small onClick={() => cycleItemSuivi(locId, secId, item.id)} />
            {(item.photos?.length ?? (item.photo ? 1 : 0)) > 0 && (
              <span style={{ fontSize:10, color:'#AAAAAA' }}>📷 {item.photos?.length ?? 1}</span>
            )}
          </div>
        </div>
        {/* Delete */}
        <button onClick={e => { e.stopPropagation(); deleteItem(locId, secId, item.id) }}
          style={{ background:'none', border:'none', cursor:'pointer', color:'#AAAAAA', fontSize:16, padding:'0 2px', flexShrink:0 }}>
          ×
        </button>
      </div>
    ))
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'#F9F9F9' }}>
      {/* Header */}
      <div style={{ background:'#FFFFFF', borderBottom:`1px solid #E8E8E8`, padding:'10px 16px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <button onClick={onBack} style={{ background:'none', border:'none', cursor:'pointer', color:'#E30513', fontSize:20, padding:0, fontWeight:700 }}>←</button>
          {editNomProjet ? (
            <input autoFocus value={nomProjet} onChange={e => setNomProjet(e.target.value)}
              onBlur={() => setEditNomProjet(false)}
              onKeyDown={e => e.key === 'Enter' && setEditNomProjet(false)}
              style={{ flex:1, fontSize:15, fontWeight:800, color:'#222222', border:'none', borderBottom:`2px solid #E30513`, outline:'none', background:'transparent' }} />
          ) : (
            <p onClick={() => setEditNomProjet(true)}
              style={{ flex:1, fontSize:15, fontWeight:800, color:'#222222', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', cursor:'pointer' }}>{nomProjet}</p>
          )}
          {/* Plan library button */}
          <button onClick={() => setShowPlanLib(true)}
            style={{ background: planLibrary.length > 0 ? '#F0FDF4' : 'none', border: planLibrary.length > 0 ? '1px solid #86EFAC' : '1px solid #E8E8E8', borderRadius:8, cursor:'pointer', color: planLibrary.length > 0 ? '#15803D' : '#697280', fontSize:11, padding:'4px 8px', flexShrink:0, fontWeight:600 }}>
            🗂 Plans {planLibrary.length > 0 ? `(${planLibrary.length})` : ''}
          </button>
        </div>
        {/* Meta */}
        <div style={{ display:'flex', gap:12, marginTop:4, paddingLeft:30 }}>
          <input type="date" value={dateVisite} onChange={e => setDateVisite(e.target.value)}
            style={{ fontSize:11, color:'#AAAAAA', border:'none', background:'transparent', outline:'none', cursor:'pointer' }} />
          <input value={maitreOuvrage} onChange={e => setMaitreOuvrage(e.target.value)}
            placeholder="Maître d'ouvrage"
            style={{ fontSize:11, color:'#AAAAAA', border:'none', background:'transparent', outline:'none', flex:1 }} />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background:'#FFFFFF', borderBottom:`1px solid #E8E8E8`, display:'flex', flexShrink:0 }}>
        {([
          ['visite', `🗺 Visite${totalItems > 0 ? ` (${totalItems})` : ''}${urgentItems > 0 ? ` ⚡${urgentItems}` : ''}`],
          ['rapport', '📊 Rapport'],
        ] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ flex:1, padding:'10px 4px', fontSize:12, fontWeight:700, background:'none', border:'none', cursor:'pointer',
              color: tab === t ? '#E30513' : '#AAAAAA',
              borderBottom: tab === t ? `2.5px solid #E30513` : '2.5px solid transparent' }}>
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex:1, overflowY:'auto' }}>

        {/* === ONGLET VISITE === */}
        {tab === 'visite' && (
          <div style={{ padding:'12px 16px', display:'flex', flexDirection:'column', gap:12 }}>

            {/* Sort mode toggle */}
            {locs.length > 1 && (
              <button onClick={() => setSortLocMode(!sortLocMode)}
                style={{ background: sortLocMode ? '#FFF0F0' : '#F9F9F9', border:`1px solid ${sortLocMode ? '#FCA5A5' : '#E8E8E8'}`, borderRadius:8, padding:'6px 12px', fontSize:11, color: sortLocMode ? '#E30513' : '#697280', cursor:'pointer', fontWeight:600, alignSelf:'flex-end' }}>
                {sortLocMode ? '✓ Fin du tri' : '⇅ Réorganiser'}
              </button>
            )}

            {/* Localisations */}
            {locs.map((loc, idx) => {
              const allItems = loc.sections?.length ? loc.sections.flatMap(s => s.items ?? []) : (loc.items ?? [])
              const isOpen = openLoc === loc.id
              const isDragOver = dragLocOver === idx

              return (
                <div key={loc.id}
                  draggable={sortLocMode}
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={e => handleDragOver(e, idx)}
                  onDrop={() => handleDrop(idx)}
                  style={{ background:'#FFFFFF', borderRadius:12, border:`1.5px solid ${isDragOver ? '#E30513' : '#E8E8E8'}`, overflow:'hidden', opacity: dragLoc === idx ? 0.5 : 1 }}>

                  {/* Loc header */}
                  <div onClick={() => !sortLocMode && setOpenLoc(isOpen ? null : loc.id)}
                    style={{ display:'flex', alignItems:'center', padding:'10px 14px', cursor: sortLocMode ? 'grab' : 'pointer', gap:10 }}>
                    {/* Color bar urgence */}
                    <div style={{ width:4, height:36, borderRadius:2, background: barColor(loc), flexShrink:0 }} />
                    {sortLocMode ? (
                      <p style={{ flex:1, fontSize:13, fontWeight:700, color:'#222222', margin:0 }}>☰ {loc.nom}</p>
                    ) : (
                      <LocNomEdit value={loc.nom} onChange={n => updateLoc(loc.id, { nom: n })} />
                    )}
                    {/* Count badge */}
                    <span style={{ fontSize:10, background:'#F9F9F9', color:'#697280', padding:'2px 8px', borderRadius:10, fontWeight:600, flexShrink:0 }}>
                      {allItems.length}
                    </span>
                    {!sortLocMode && (
                      <>
                        {/* Plan button */}
                        <button onClick={e => { e.stopPropagation(); setPlanLocId(loc.id) }}
                          style={{ background: loc.planBg ? '#FFF0F0' : 'none', border: loc.planBg ? '1px solid #FCA5A5' : 'none', borderRadius:6, cursor:'pointer', color: loc.planBg ? '#E30513' : '#AAAAAA', fontSize:14, padding:'2px 5px', flexShrink:0 }}
                          title="Plan de la zone">📐</button>
                        <span style={{ color:'#AAAAAA', fontSize:12 }}>{isOpen ? '▲' : '▼'}</span>
                        <button onClick={e => { e.stopPropagation(); deleteLoc(loc.id) }}
                          style={{ background:'none', border:'none', cursor:'pointer', color:'#AAAAAA', fontSize:16, padding:0, marginLeft:2 }}>×</button>
                      </>
                    )}
                  </div>

                  {/* Expanded content */}
                  {isOpen && !sortLocMode && (
                    <div style={{ borderTop:`1px solid #F3F4F6` }}>
                      {/* Items directs */}
                      {(loc.items ?? []).length > 0 && renderItems(loc.items ?? [], loc.id)}

                      {/* Sections */}
                      {(loc.sections ?? []).map((sec: Section) => (
                        <div key={sec.id}>
                          <div style={{ padding:'8px 16px', background:'#F9F9F9', borderBottom:`1px solid #F3F4F6`, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                            <p style={{ fontSize:11, fontWeight:700, color:'#697280', margin:0, textTransform:'uppercase', letterSpacing:0.5 }}>{sec.nom}</p>
                            <span style={{ fontSize:10, color:'#AAAAAA' }}>{sec.items?.length ?? 0}</span>
                          </div>
                          {renderItems(sec.items ?? [], loc.id, sec.id)}
                        </div>
                      ))}

                      {/* Add observation */}
                      <div style={{ padding:'10px 14px' }}>
                        <button onClick={() => setItemModal({ locId: loc.id, item: null })}
                          style={{ width:'100%', padding:'9px 0', background:'none', border:`2px dashed #E8E8E8`, borderRadius:8, fontSize:12, color:'#E30513', cursor:'pointer', fontWeight:700 }}>
                          + Ajouter une observation
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Add loc form */}
            {showAddLoc ? (
              <div style={{ background:'#FFFFFF', borderRadius:12, border:`1.5px solid #E8E8E8`, padding:14, display:'flex', gap:8 }}>
                <input autoFocus value={newLocNom} onChange={e => setNewLocNom(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addLoc()}
                  placeholder="Ex: RDC, R+1, Façade Nord..."
                  style={{ flex:1, padding:'8px 12px', border:`1.5px solid #E8E8E8`, borderRadius:8, fontSize:13, outline:'none', color:'#222222' }} />
                <button onClick={addLoc}
                  style={{ background:'#E30513', color:'white', border:'none', borderRadius:8, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer' }}>OK</button>
                <button onClick={() => { setShowAddLoc(false); setNewLocNom('') }}
                  style={{ background:'none', border:'none', cursor:'pointer', color:'#AAAAAA', fontSize:18 }}>×</button>
              </div>
            ) : (
              <button onClick={() => setShowAddLoc(true)}
                style={{ width:'100%', padding:'11px 0', background:'#E30513', color:'white', border:'none', borderRadius:10, fontSize:13, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                + Ajouter une zone
              </button>
            )}

            {/* Participants */}
            <div style={{ background:'#FFFFFF', borderRadius:12, border:`1.5px solid #E8E8E8`, overflow:'hidden', marginTop:4 }}>
              <div style={{ padding:'10px 14px', borderBottom:`1px solid #F3F4F6`, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <p style={{ fontSize:13, fontWeight:700, color:'#222222', margin:0 }}>👥 Participants</p>
                <span style={{ fontSize:10, background:'#F9F9F9', color:'#697280', padding:'2px 8px', borderRadius:10 }}>{participants.length}</span>
              </div>

              {participants.map(p => (
                <div key={p.id} style={{ padding:'10px 14px', borderBottom:`1px solid #F3F4F6`, display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontSize:13, fontWeight:600, color:'#222222', margin:0 }}>{p.nom}</p>
                    <p style={{ fontSize:11, color:'#697280', margin:'1px 0 0' }}>{[p.role, p.tel, p.email].filter(Boolean).join(' · ')}</p>
                  </div>
                  <button onClick={() => updatePart(p.id, { presence: p.presence === 'present' ? 'absent' : 'present' })}
                    style={{ fontSize:10, padding:'3px 8px', borderRadius:10, border:`1px solid ${p.presence === 'present' ? '#86EFAC' : '#E8E8E8'}`, background: p.presence === 'present' ? '#F0FDF4' : '#F9F9F9', color: p.presence === 'present' ? '#15803D' : '#AAAAAA', cursor:'pointer', fontWeight:600 }}>
                    {p.presence === 'present' ? '✓ Présent' : '✗ Absent'}
                  </button>
                  <button onClick={() => deletePart(p.id)}
                    style={{ background:'none', border:'none', cursor:'pointer', color:'#AAAAAA', fontSize:16 }}>×</button>
                </div>
              ))}

              {showAddPart ? (
                <div style={{ padding:12, display:'flex', flexDirection:'column', gap:8 }}>
                  {[
                    { key:'nom', placeholder:'Nom *' },
                    { key:'role', placeholder:'Rôle (MOE, Architecte...)' },
                    { key:'tel', placeholder:'Téléphone' },
                    { key:'email', placeholder:'Email' },
                  ].map(({ key, placeholder }) => (
                    <input key={key} value={String(newPart[key as keyof typeof newPart] ?? '')}
                      onChange={e => setNewPart({ ...newPart, [key]: e.target.value })}
                      placeholder={placeholder}
                      style={{ padding:'8px 12px', border:`1.5px solid #E8E8E8`, borderRadius:8, fontSize:12, outline:'none', color:'#222222' }} />
                  ))}
                  <div style={{ display:'flex', gap:8 }}>
                    <button onClick={addPart}
                      style={{ flex:1, padding:'9px 0', background:'#E30513', color:'white', border:'none', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer' }}>Ajouter</button>
                    <button onClick={() => { setShowAddPart(false); setNewPart({ nom:'', role:'', tel:'', email:'', presence:'present' }) }}
                      style={{ padding:'9px 12px', background:'none', border:`1px solid #E8E8E8`, borderRadius:8, fontSize:12, color:'#697280', cursor:'pointer' }}>Annuler</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowAddPart(true)}
                  style={{ width:'100%', padding:'10px 0', background:'none', border:'none', fontSize:12, color:'#E30513', cursor:'pointer', fontWeight:700 }}>
                  + Ajouter un participant
                </button>
              )}
            </div>
          </div>
        )}

        {/* === ONGLET RAPPORT === */}
        {tab === 'rapport' && (
          <div style={{ display:'flex', flexDirection:'column' }}>
            {/* Preview button */}
            <div style={{ padding:'12px 16px 0' }}>
              <button
                onClick={() => setShowPreview(true)}
                style={{ width:'100%', padding:'10px', background:'#222222', color:'white', border:'none', borderRadius:10, fontSize:13, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                👁 Prévisualiser le rapport complet
              </button>
            </div>
            <TableauRecap
              localisations={locs}
              tableauData={tableauData}
              photosParLigne={photosParLigne}
              onUpdateTableau={setTableauData}
              onChangePhotosParLigne={setPhotosParLigne}
            />
          </div>
        )}
      </div>

      {/* Item Modal */}
      {itemModal && (
        <ItemModal
          item={itemModal.item}
          onSave={item => saveItem(itemModal.locId, itemModal.secId, item)}
          onClose={() => setItemModal(null)}
        />
      )}

      {/* Plan Library Modal */}
      {showPlanLib && (
        <PlanLibModal
          plans={planLibrary}
          onAdd={pl => setPlanLibrary(prev => [...prev, pl])}
          onDelete={id => setPlanLibrary(prev => prev.filter(p => p.id !== id))}
          onClose={() => setShowPlanLib(false)}
        />
      )}

      {/* Plan Loc Modal */}
      {planLocId != null && (() => {
        const loc = locs.find(l => l.id === planLocId)
        if (!loc) return null
        return (
          <PlanLocModal
            loc={loc}
            planLibrary={planLibrary}
            onSave={({ planBg, planData, planAnnotations }) => {
              updateLoc(planLocId, { planBg: planBg || undefined, planData: planData || undefined, planAnnotations: planAnnotations || undefined })
              setPlanLocId(null)
            }}
            onClose={() => setPlanLocId(null)}
          />
        )
      })()}

      {/* Preview Rapport */}
      {showPreview && (
        <PreviewRapport
          projet={{ ...projet, nom: nomProjet, localisations: locs, participants, maitreOuvrage, dateVisite, tableauRecap: tableauData, photosParLigne, planLibrary }}
          onUpdateItem={updateItemFields}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  )
}

function LocNomEdit({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value)
  if (editing) return (
    <input autoFocus value={v} onChange={e => setV(e.target.value)}
      onClick={e => e.stopPropagation()}
      onBlur={() => { onChange(v); setEditing(false) }}
      onKeyDown={e => e.key === 'Enter' && (onChange(v), setEditing(false))}
      style={{ flex:1, fontSize:13, fontWeight:700, color:'#222222', border:'none', borderBottom:`2px solid #E30513`, outline:'none', background:'transparent' }} />
  )
  return (
    <p onClick={e => { e.stopPropagation(); setEditing(true) }}
      style={{ flex:1, fontSize:13, fontWeight:700, color:'#222222', margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', cursor:'text' }}>
      {value}
    </p>
  )
}
