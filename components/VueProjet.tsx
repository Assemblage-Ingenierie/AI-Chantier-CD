'use client'
import { useState } from 'react'
import type { Projet, Localisation, Item, Participant, TableauRow, Suivi } from '@/lib/types'
import { ItemModal } from './ItemModal'
import { UrgenceBadge, SuiviBadge, cycleUrgence, cycleSuivi } from './ui/Badge'
import { generateTableau } from '@/lib/ai'

type Tab = 'zones' | 'participants' | 'rapport'

interface Props {
  projet: Projet
  onBack: () => void
  onUpdate: (p: Projet) => void
}

export function VueProjet({ projet, onBack, onUpdate }: Props) {
  const [tab, setTab] = useState<Tab>('zones')
  const [editNom, setEditNom] = useState(false)
  const [nom, setNom] = useState(projet.nom)
  const [modal, setModal] = useState<{ locId: number; secId?: number; item: Item | null } | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  const locs = projet.localisations ?? []
  const parts = projet.participants ?? []
  const tableau = projet.tableauRecap ?? []

  function upd(patch: Partial<Projet>) {
    onUpdate({ ...projet, ...patch })
  }

  // --- Zones ---
  function addLoc() {
    const loc: Localisation = { id: Date.now(), nom: 'Nouvelle zone', items: [], sections: [] }
    upd({ localisations: [...locs, loc] })
  }
  function updateLoc(id: number, patch: Partial<Localisation>) {
    upd({ localisations: locs.map(l => l.id === id ? { ...l, ...patch } : l) })
  }
  function deleteLoc(id: number) {
    if (!confirm('Supprimer cette zone ?')) return
    upd({ localisations: locs.filter(l => l.id !== id) })
  }

  // --- Items ---
  function saveItem(locId: number, item: Item) {
    const loc = locs.find(l => l.id === locId)
    if (!loc) return
    const items = loc.items ?? []
    const exists = items.find(i => i.id === item.id)
    const newItems = exists ? items.map(i => i.id === item.id ? item : i) : [...items, item]
    updateLoc(locId, { items: newItems })
    setModal(null)
  }
  function deleteItem(locId: number, itemId: number) {
    const loc = locs.find(l => l.id === locId)
    if (!loc) return
    updateLoc(locId, { items: (loc.items ?? []).filter(i => i.id !== itemId) })
  }
  function cycleItemUrgence(locId: number, itemId: number) {
    const loc = locs.find(l => l.id === locId)
    if (!loc) return
    updateLoc(locId, { items: (loc.items ?? []).map(i => i.id === itemId ? { ...i, urgence: cycleUrgence(i.urgence ?? 'basse') } : i) })
  }
  function cycleItemSuivi(locId: number, itemId: number) {
    const loc = locs.find(l => l.id === locId)
    if (!loc) return
    updateLoc(locId, { items: (loc.items ?? []).map(i => i.id === itemId ? { ...i, suivi: cycleSuivi(i.suivi ?? 'rien') } : i) })
  }

  // --- Participants ---
  function addPart() {
    const p: Participant = { id: Date.now(), nom: 'Nouveau participant', presence: 'present' }
    upd({ participants: [...parts, p] })
  }
  function updatePart(id: number, patch: Partial<Participant>) {
    upd({ participants: parts.map(p => p.id === id ? { ...p, ...patch } : p) })
  }
  function deletePart(id: number) {
    upd({ participants: parts.filter(p => p.id !== id) })
  }

  // --- Tableau ---
  function addRow() {
    const row: TableauRow = { id: Date.now(), urgence: 'moyenne', locNom: '', desordre: '', travaux: '', suivi: 'rien' }
    upd({ tableauRecap: [...tableau, row] })
  }
  function updateRow(id: number, patch: Partial<TableauRow>) {
    upd({ tableauRecap: tableau.map(r => r.id === id ? { ...r, ...patch } : r) })
  }
  function deleteRow(id: number) {
    upd({ tableauRecap: tableau.filter(r => r.id !== id) })
  }
  async function autoIA() {
    const items = locs.flatMap(l =>
      (l.items ?? []).map(i => `[${l.nom}] ${i.titre}${i.commentaire ? ' — ' + i.commentaire : ''} (${i.urgence ?? 'basse'})`)
    ).join('\n')
    if (!items) return alert('Aucune observation à analyser')
    setAiLoading(true)
    try {
      const json = await generateTableau(items)
      const rows = JSON.parse(json) as Omit<TableauRow, 'id'>[]
      upd({ tableauRecap: rows.map(r => ({ ...r, id: Date.now() + Math.random(), suivi: 'rien' as Suivi })) })
    } catch (e) { alert('Erreur IA : ' + String(e)) }
    finally { setAiLoading(false) }
  }

  return (
    <div style={{ background: '#F7F7F7', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ background: '#fff', borderColor: '#E8E8E8' }} className="border-b px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center gap-3 max-w-2xl mx-auto">
          <button onClick={onBack} style={{ color: '#E30513', fontSize: 22 }} className="font-bold">←</button>
          {editNom ? (
            <input autoFocus value={nom}
              onChange={e => setNom(e.target.value)}
              onBlur={() => { upd({ nom }); setEditNom(false) }}
              onKeyDown={e => e.key === 'Enter' && (upd({ nom }), setEditNom(false))}
              style={{ color: '#222', borderColor: '#E30513' }}
              className="flex-1 font-bold text-base border-b-2 outline-none bg-transparent" />
          ) : (
            <h1 onClick={() => setEditNom(true)}
              style={{ color: '#222' }}
              className="flex-1 font-bold text-base truncate cursor-pointer">{projet.nom}</h1>
          )}
        </div>
        {/* Méta */}
        <div className="flex gap-4 mt-1 max-w-2xl mx-auto">
          <input type="date" value={projet.dateVisite ?? ''} onChange={e => upd({ dateVisite: e.target.value })}
            style={{ color: '#697280', fontSize: 12 }} className="bg-transparent outline-none" />
          <input value={projet.maitreOuvrage ?? ''} onChange={e => upd({ maitreOuvrage: e.target.value })}
            placeholder="Maître d'ouvrage"
            style={{ color: '#697280', fontSize: 12 }} className="bg-transparent outline-none flex-1" />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background: '#fff', borderColor: '#E8E8E8' }} className="border-b sticky top-[73px] z-10">
        <div className="flex max-w-2xl mx-auto">
          {([['zones', '🗺 Zones'], ['participants', '👥 Participants'], ['rapport', '📊 Rapport']] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              style={{
                color: tab === t ? '#E30513' : '#697280',
                borderBottomColor: tab === t ? '#E30513' : 'transparent',
                borderBottomWidth: 2,
              }}
              className="flex-1 py-3 text-sm font-semibold transition-colors">
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4">

        {/* === ZONES === */}
        {tab === 'zones' && (
          <div className="space-y-4">
            {locs.length === 0 && (
              <div style={{ background: '#fff', borderColor: '#E8E8E8', color: '#697280' }}
                className="rounded-2xl border p-8 text-center text-sm">
                Aucune zone — ajoutez RDC, R+1, Façade...
              </div>
            )}
            {locs.map(loc => (
              <div key={loc.id} style={{ background: '#fff', borderColor: '#E8E8E8' }} className="rounded-2xl border">
                {/* Loc header */}
                <div className="flex items-center gap-2 p-4 border-b" style={{ borderColor: '#E8E8E8' }}>
                  <span style={{ color: '#697280' }}>🗺</span>
                  <LocNomInput value={loc.nom} onChange={n => updateLoc(loc.id, { nom: n })} />
                  <span style={{ background: '#F9F9F9', color: '#697280' }} className="text-xs px-2 py-1 rounded-lg ml-auto">
                    {(loc.items ?? []).length} obs.
                  </span>
                  <button onClick={() => deleteLoc(loc.id)} style={{ color: '#AAAAAA' }} className="text-lg ml-1">🗑</button>
                </div>
                {/* Items */}
                <div className="divide-y" style={{ borderColor: '#F3F4F6' }}>
                  {(loc.items ?? []).map(item => (
                    <div key={item.id} className="px-4 py-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p style={{ color: '#222' }} className="text-sm font-medium truncate">{item.titre}</p>
                        {item.commentaire && <p style={{ color: '#697280' }} className="text-xs mt-0.5 line-clamp-1">{item.commentaire}</p>}
                        <div className="flex gap-2 mt-1.5 flex-wrap">
                          <UrgenceBadge value={item.urgence ?? 'basse'} small onClick={() => cycleItemUrgence(loc.id, item.id)} />
                          <SuiviBadge value={item.suivi ?? 'rien'} small onClick={() => cycleItemSuivi(loc.id, item.id)} />
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => setModal({ locId: loc.id, item })}
                          style={{ color: '#697280' }} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-sm">✏️</button>
                        <button onClick={() => deleteItem(loc.id, item.id)}
                          style={{ color: '#AAAAAA' }} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-sm">🗑</button>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Add item */}
                <div className="p-3">
                  <button onClick={() => setModal({ locId: loc.id, item: null })}
                    style={{ borderColor: '#E8E8E8', color: '#E30513' }}
                    className="w-full h-10 rounded-xl border-2 border-dashed text-sm font-semibold flex items-center justify-center gap-1.5">
                    + Ajouter une observation
                  </button>
                </div>
              </div>
            ))}
            <button onClick={addLoc}
              style={{ background: '#E30513', color: '#fff' }}
              className="w-full h-14 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2">
              + Ajouter une zone
            </button>
          </div>
        )}

        {/* === PARTICIPANTS === */}
        {tab === 'participants' && (
          <div className="space-y-3">
            {parts.map(p => (
              <div key={p.id} style={{ background: '#fff', borderColor: '#E8E8E8' }} className="rounded-2xl border p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 space-y-2">
                    <input value={p.nom} onChange={e => updatePart(p.id, { nom: e.target.value })}
                      placeholder="Nom *"
                      style={{ borderColor: '#E8E8E8', color: '#222' }}
                      className="w-full px-3 py-2 rounded-xl border text-sm font-semibold outline-none focus:border-red-500" />
                    <div className="grid grid-cols-2 gap-2">
                      <input value={p.role ?? ''} onChange={e => updatePart(p.id, { role: e.target.value })}
                        placeholder="Rôle (MOE, Arch...)"
                        style={{ borderColor: '#E8E8E8', color: '#697280' }}
                        className="px-3 py-2 rounded-xl border text-xs outline-none focus:border-red-500" />
                      <input value={p.tel ?? ''} onChange={e => updatePart(p.id, { tel: e.target.value })}
                        placeholder="Téléphone"
                        style={{ borderColor: '#E8E8E8', color: '#697280' }}
                        className="px-3 py-2 rounded-xl border text-xs outline-none focus:border-red-500" />
                    </div>
                    <input value={p.email ?? ''} onChange={e => updatePart(p.id, { email: e.target.value })}
                      placeholder="Email"
                      style={{ borderColor: '#E8E8E8', color: '#697280' }}
                      className="w-full px-3 py-2 rounded-xl border text-xs outline-none focus:border-red-500" />
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <button onClick={() => deletePart(p.id)} style={{ color: '#AAAAAA' }} className="text-lg">🗑</button>
                    <button onClick={() => updatePart(p.id, { presence: p.presence === 'present' ? 'absent' : 'present' })}
                      style={{
                        background: p.presence === 'present' ? '#F0FDF4' : '#F9F9F9',
                        color: p.presence === 'present' ? '#15803D' : '#AAAAAA',
                        borderColor: p.presence === 'present' ? '#86EFAC' : '#E8E8E8',
                      }}
                      className="px-3 py-1 rounded-xl border text-xs font-medium">
                      {p.presence === 'present' ? '✓ Présent' : '✗ Absent'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <button onClick={addPart}
              style={{ background: '#E30513', color: '#fff' }}
              className="w-full h-14 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2">
              + Ajouter un participant
            </button>
          </div>
        )}

        {/* === RAPPORT === */}
        {tab === 'rapport' && (
          <div className="space-y-4">
            {/* Actions */}
            <div className="flex gap-2">
              <button onClick={autoIA} disabled={aiLoading}
                style={{ background: aiLoading ? '#E8E8E8' : '#30323E', color: aiLoading ? '#AAAAAA' : '#fff' }}
                className="flex-1 h-12 rounded-xl font-semibold text-sm flex items-center justify-center gap-2">
                {aiLoading ? '⏳ Génération...' : '✨ Auto IA'}
              </button>
              <button onClick={() => alert('Export PDF — fonctionnalité à venir')}
                style={{ background: '#E30513', color: '#fff' }}
                className="flex-1 h-12 rounded-xl font-semibold text-sm">
                📄 Export PDF
              </button>
            </div>

            {/* Tableau */}
            {tableau.length === 0 ? (
              <div style={{ background: '#fff', borderColor: '#E8E8E8', color: '#697280' }}
                className="rounded-2xl border p-6 text-center text-sm">
                Cliquez &quot;Auto IA&quot; pour générer le tableau depuis vos observations, ou ajoutez des lignes manuellement.
              </div>
            ) : (
              <div className="space-y-3">
                {tableau.map(row => (
                  <div key={row.id} style={{ background: '#fff', borderColor: '#E8E8E8' }} className="rounded-2xl border p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <UrgenceBadge value={row.urgence} onClick={() => updateRow(row.id, { urgence: cycleUrgence(row.urgence) })} />
                      <input value={row.locNom} onChange={e => updateRow(row.id, { locNom: e.target.value })}
                        placeholder="Zone"
                        style={{ borderColor: '#E8E8E8', color: '#697280' }}
                        className="flex-1 px-2 py-1 rounded-lg border text-xs outline-none focus:border-red-500" />
                      <SuiviBadge value={row.suivi ?? 'rien'} small onClick={() => updateRow(row.id, { suivi: cycleSuivi(row.suivi ?? 'rien') })} />
                      <button onClick={() => deleteRow(row.id)} style={{ color: '#AAAAAA' }} className="text-base ml-1">🗑</button>
                    </div>
                    <input value={row.desordre} onChange={e => updateRow(row.id, { desordre: e.target.value })}
                      placeholder="Désordre constaté..."
                      style={{ borderColor: '#E8E8E8', color: '#222' }}
                      className="w-full px-3 py-2 rounded-xl border text-sm outline-none focus:border-red-500 mb-2" />
                    <input value={row.travaux} onChange={e => updateRow(row.id, { travaux: e.target.value })}
                      placeholder="Travaux préconisés..."
                      style={{ borderColor: '#E8E8E8', color: '#697280' }}
                      className="w-full px-3 py-2 rounded-xl border text-sm outline-none focus:border-red-500" />
                  </div>
                ))}
              </div>
            )}

            <button onClick={addRow}
              style={{ borderColor: '#E8E8E8', color: '#697280' }}
              className="w-full h-12 rounded-2xl border-2 border-dashed font-medium text-sm">
              + Ajouter une ligne
            </button>
          </div>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <ItemModal
          item={modal.item}
          onSave={item => saveItem(modal.locId, item)}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

function LocNomInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value)
  if (editing) return (
    <input autoFocus value={v} onChange={e => setV(e.target.value)}
      onBlur={() => { onChange(v); setEditing(false) }}
      onKeyDown={e => e.key === 'Enter' && (onChange(v), setEditing(false))}
      style={{ color: '#222' }} className="flex-1 font-bold text-sm outline-none border-b border-red-500 bg-transparent" />
  )
  return <span onClick={() => setEditing(true)} style={{ color: '#222' }} className="flex-1 font-bold text-sm cursor-pointer">{value}</span>
}
