'use client'
import { useState } from 'react'
import type { Localisation, TableauRow, Urgence, Suivi } from '@/lib/types'
import { generateTableau } from '@/lib/ai'

const URGENCE_CYCLE: Urgence[] = ['haute', 'moyenne', 'basse']
const SUIVI_CYCLE: Suivi[] = ['rien', 'a_faire', 'en_cours', 'prochaine', 'fait']
const URGENCE: Record<Urgence, { dot:string; label:string; bg:string; text:string; border:string }> = {
  haute: { dot:'#E30513', label:'Urgent', bg:'#FFF0F0', text:'#B91C1C', border:'#FCA5A5' },
  moyenne: { dot:'#D97706', label:'À planifier', bg:'#FFFBEB', text:'#92400E', border:'#FCD34D' },
  basse: { dot:'#16A34A', label:'Mineur', bg:'#F0FDF4', text:'#15803D', border:'#86EFAC' },
}
const SUIVI_MAP: Record<Suivi, { label:string; bg:string; text:string; border:string; dot:string }> = {
  rien: { label:'—', bg:'#F3F4F6', text:'#6B7280', border:'#E5E7EB', dot:'#9CA3AF' },
  a_faire: { label:'À faire', bg:'#FFF7ED', text:'#C2410C', border:'#FED7AA', dot:'#F97316' },
  en_cours: { label:'En cours', bg:'#EFF6FF', text:'#1D4ED8', border:'#BFDBFE', dot:'#3B82F6' },
  prochaine: { label:'Prochaine visite', bg:'#FDF4FF', text:'#7E22CE', border:'#E9D5FF', dot:'#A855F7' },
  fait: { label:'Fait', bg:'#F0FDF4', text:'#15803D', border:'#BBF7D0', dot:'#22C55E' },
}

interface Props {
  localisations: Localisation[]
  tableauData: TableauRow[]
  photosParLigne: 1|2|3
  onUpdateTableau: (rows: TableauRow[]) => void
  onChangePhotosParLigne: (n: 1|2|3) => void
}

export function TableauRecap({ localisations, tableauData, photosParLigne, onUpdateTableau, onChangePhotosParLigne }: Props) {
  const [aiLoading, setAiLoading] = useState(false)

  function addRow() {
    const row: TableauRow = { id: Date.now(), urgence: 'moyenne', locNom: '', desordre: '', travaux: '', suivi: 'rien' }
    onUpdateTableau([...tableauData, row])
  }
  function updateRow(id: number, patch: Partial<TableauRow>) {
    onUpdateTableau(tableauData.map(r => r.id === id ? { ...r, ...patch } : r))
  }
  function deleteRow(id: number) {
    onUpdateTableau(tableauData.filter(r => r.id !== id))
  }
  function cycleRowUrgence(id: number, current: Urgence) {
    const next = URGENCE_CYCLE[(URGENCE_CYCLE.indexOf(current) + 1) % URGENCE_CYCLE.length]
    updateRow(id, { urgence: next })
  }
  function cycleRowSuivi(id: number, current: Suivi) {
    const next = SUIVI_CYCLE[(SUIVI_CYCLE.indexOf(current) + 1) % SUIVI_CYCLE.length]
    updateRow(id, { suivi: next })
  }

  async function autoIA() {
    const items = localisations.flatMap(l =>
      (l.sections?.length ? l.sections.flatMap(s => s.items ?? []) : (l.items ?? []))
        .map(i => `[${l.nom}] ${i.titre}${i.commentaire ? ' — ' + i.commentaire : ''} (${i.urgence ?? 'basse'})`)
    ).join('\n')
    if (!items) return alert('Aucune observation à analyser')
    setAiLoading(true)
    try {
      const json = await generateTableau(items)
      const rows = JSON.parse(json) as Omit<TableauRow, 'id' | 'suivi'>[]
      onUpdateTableau(rows.map(r => ({ ...r, id: Date.now() + Math.random(), suivi: 'rien' as Suivi })))
    } catch (e) { alert('Erreur IA : ' + String(e)) }
    finally { setAiLoading(false) }
  }

  return (
    <div style={{ padding:'12px 16px', display:'flex', flexDirection:'column', gap:12 }}>
      {/* Actions bar */}
      <div style={{ display:'flex', gap:8 }}>
        <button onClick={autoIA} disabled={aiLoading}
          style={{ flex:1, padding:'10px 0', background: aiLoading ? '#F9F9F9' : '#30323E', color: aiLoading ? '#AAAAAA' : 'white', border:'none', borderRadius:10, fontSize:12, fontWeight:700, cursor: aiLoading ? 'default' : 'pointer' }}>
          {aiLoading ? '⏳ Génération IA...' : '✨ Auto IA'}
        </button>
        <button onClick={addRow}
          style={{ flex:1, padding:'10px 0', background:'none', border:`1.5px solid #E8E8E8`, borderRadius:10, fontSize:12, fontWeight:700, color:'#697280', cursor:'pointer' }}>
          + Ajouter une ligne
        </button>
      </div>

      {/* Photos par ligne */}
      <div style={{ background:'#FFFFFF', borderRadius:10, border:`1px solid #E8E8E8`, padding:'10px 14px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <p style={{ fontSize:12, fontWeight:600, color:'#697280', margin:0 }}>Photos par ligne dans le rapport</p>
        <div style={{ display:'flex', gap:4 }}>
          {([1,2,3] as const).map(n => (
            <button key={n} onClick={() => onChangePhotosParLigne(n)}
              style={{ width:30, height:30, borderRadius:8, border:`2px solid ${photosParLigne === n ? '#E30513' : '#E8E8E8'}`, background: photosParLigne === n ? '#FFF0F0' : '#F9F9F9', color: photosParLigne === n ? '#E30513' : '#AAAAAA', cursor:'pointer', fontSize:12, fontWeight:700 }}>
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Rows */}
      {tableauData.length === 0 ? (
        <div style={{ background:'#FFFFFF', borderRadius:12, border:`1.5px dashed #E8E8E8`, padding:'24px 16px', textAlign:'center' }}>
          <p style={{ fontSize:13, color:'#AAAAAA', margin:'0 0 8px' }}>Tableau vide</p>
          <p style={{ fontSize:11, color:'#AAAAAA', margin:0 }}>Cliquez &quot;Auto IA&quot; pour générer depuis vos observations</p>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {tableauData.map(row => {
            const u = URGENCE[row.urgence]
            const s = SUIVI_MAP[row.suivi ?? 'rien']
            return (
              <div key={row.id} style={{ background:'#FFFFFF', borderRadius:12, border:`1.5px solid #E8E8E8`, overflow:'hidden' }}>
                {/* Row header */}
                <div style={{ display:'flex', alignItems:'stretch' }}>
                  {/* Urgence bar - cliquable pour cycler */}
                  <div onClick={() => cycleRowUrgence(row.id, row.urgence)}
                    style={{ width:5, background: u.dot, cursor:'pointer', flexShrink:0 }} />
                  <div style={{ flex:1, padding:'10px 12px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                      <span style={{ fontSize:10, background:u.bg, color:u.text, border:`1px solid ${u.border}`, padding:'2px 8px', borderRadius:4, fontWeight:700 }}>
                        {u.label}
                      </span>
                      <input value={row.locNom} onChange={e => updateRow(row.id, { locNom: e.target.value })}
                        placeholder="Zone"
                        style={{ flex:1, fontSize:11, color:'#697280', border:`1px solid #E8E8E8`, borderRadius:6, padding:'2px 8px', outline:'none' }} />
                      <span onClick={() => cycleRowSuivi(row.id, row.suivi ?? 'rien')}
                        style={{ fontSize:10, background:s.bg, color:s.text, border:`1px solid ${s.border}`, padding:'2px 6px', borderRadius:10, cursor:'pointer', fontWeight:700, whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:3 }}>
                        <span style={{ width:6, height:6, borderRadius:'50%', background:s.dot }} />
                        {s.label}
                      </span>
                      <button onClick={() => deleteRow(row.id)}
                        style={{ background:'none', border:'none', cursor:'pointer', color:'#AAAAAA', fontSize:16, padding:0 }}>×</button>
                    </div>
                    <input value={row.desordre} onChange={e => updateRow(row.id, { desordre: e.target.value })}
                      placeholder="Désordre constaté..."
                      style={{ width:'100%', fontSize:12, color:'#222222', border:`1px solid #E8E8E8`, borderRadius:8, padding:'7px 10px', outline:'none', marginBottom:6, boxSizing:'border-box' }} />
                    <input value={row.travaux} onChange={e => updateRow(row.id, { travaux: e.target.value })}
                      placeholder="Travaux préconisés..."
                      style={{ width:'100%', fontSize:12, color:'#697280', border:`1px solid #E8E8E8`, borderRadius:8, padding:'7px 10px', outline:'none', boxSizing:'border-box' }} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
