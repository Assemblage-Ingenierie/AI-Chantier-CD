'use client'
import { useState, useRef } from 'react'
import type { Item, Urgence, Suivi } from '@/lib/types'

const URGENCE: Record<Urgence, { bg:string; text:string; dot:string; border:string; label:string }> = {
  haute: { bg:'#FFF0F0', text:'#B91C1C', dot:'#E30513', border:'#FCA5A5', label:'Urgent' },
  moyenne: { bg:'#FFFBEB', text:'#92400E', dot:'#D97706', border:'#FCD34D', label:'À planifier' },
  basse: { bg:'#F0FDF4', text:'#15803D', dot:'#16A34A', border:'#86EFAC', label:'Mineur' },
}
const SUIVI_MAP: Record<Suivi, { label:string; bg:string; text:string; dot:string; border:string }> = {
  rien: { label:'—', bg:'#F3F4F6', text:'#6B7280', dot:'#9CA3AF', border:'#E5E7EB' },
  a_faire: { label:'À faire', bg:'#FFF7ED', text:'#C2410C', dot:'#F97316', border:'#FED7AA' },
  en_cours: { label:'En cours', bg:'#EFF6FF', text:'#1D4ED8', dot:'#3B82F6', border:'#BFDBFE' },
  prochaine: { label:'Prochaine visite', bg:'#FDF4FF', text:'#7E22CE', dot:'#A855F7', border:'#E9D5FF' },
  fait: { label:'Fait', bg:'#F0FDF4', text:'#15803D', dot:'#22C55E', border:'#BBF7D0' },
}
const URGENCES: Urgence[] = ['haute', 'moyenne', 'basse']
const SUIVIS: Suivi[] = ['rien', 'a_faire', 'en_cours', 'prochaine', 'fait']

interface Props {
  item: Item | null
  onSave: (item: Item) => void
  onClose: () => void
}

export function ItemModal({ item, onSave, onClose }: Props) {
  const [titre, setTitre] = useState(item?.titre ?? '')
  const [commentaire, setCommentaire] = useState(item?.commentaire ?? '')
  const [urgence, setUrgence] = useState<Urgence>(item?.urgence ?? 'basse')
  const [suivi, setSuivi] = useState<Suivi>(item?.suivi ?? 'rien')
  const [photos, setPhotos] = useState<string[]>(item?.photos ?? (item?.photo ? [item.photo] : []))
  const galleryRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  function readFiles(files: FileList) {
    Array.from(files).forEach(file => {
      const reader = new FileReader()
      reader.onload = ev => setPhotos(prev => [...prev, ev.target?.result as string])
      reader.readAsDataURL(file)
    })
  }

  function removePhoto(idx: number) {
    setPhotos(photos.filter((_, i) => i !== idx))
  }

  function handleSave() {
    if (!titre.trim()) return
    onSave({
      id: item?.id ?? Date.now(),
      titre: titre.trim(),
      commentaire: commentaire.trim() || undefined,
      urgence,
      suivi,
      photos: photos.length > 0 ? photos : undefined,
      photo: photos[0] ?? item?.photo,
    })
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:50, display:'flex', alignItems:'flex-end' }}>
      <div style={{ background:'#FFFFFF', width:'100%', borderRadius:'16px 16px 0 0', padding:20, maxHeight:'90vh', overflowY:'auto' }}>
        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <p style={{ fontWeight:800, fontSize:15, color:'#222222', margin:0 }}>
            {item ? "Modifier l'observation" : 'Nouvelle observation'}
          </p>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#AAAAAA', fontSize:22 }}>×</button>
        </div>

        {/* Titre */}
        <div style={{ marginBottom:14 }}>
          <p style={{ fontSize:11, fontWeight:700, color:'#697280', margin:'0 0 6px', textTransform:'uppercase', letterSpacing:0.3 }}>Titre *</p>
          <input value={titre} onChange={e => setTitre(e.target.value)}
            placeholder="Ex: Fissure plafond RDC..."
            style={{ width:'100%', padding:'10px 12px', border:`1.5px solid #E8E8E8`, borderRadius:10, fontSize:14, outline:'none', color:'#222222', boxSizing:'border-box' }} />
        </div>

        {/* Commentaire */}
        <div style={{ marginBottom:14 }}>
          <p style={{ fontSize:11, fontWeight:700, color:'#697280', margin:'0 0 6px', textTransform:'uppercase', letterSpacing:0.3 }}>Commentaire</p>
          <textarea value={commentaire} onChange={e => setCommentaire(e.target.value)}
            placeholder="Description, contexte, mesures..."
            rows={3}
            style={{ width:'100%', padding:'10px 12px', border:`1.5px solid #E8E8E8`, borderRadius:10, fontSize:13, outline:'none', color:'#222222', resize:'vertical', boxSizing:'border-box', fontFamily:'inherit' }} />
        </div>

        {/* Urgence */}
        <div style={{ marginBottom:14 }}>
          <p style={{ fontSize:11, fontWeight:700, color:'#697280', margin:'0 0 8px', textTransform:'uppercase', letterSpacing:0.3 }}>Urgence</p>
          <div style={{ display:'flex', gap:8 }}>
            {URGENCES.map(u => {
              const cfg = URGENCE[u]
              const active = urgence === u
              return (
                <button key={u} onClick={() => setUrgence(u)}
                  style={{ flex:1, padding:'10px 4px', borderRadius:10, border:`2px solid ${active ? cfg.border : '#E8E8E8'}`, background: active ? cfg.bg : '#F9F9F9', color: active ? cfg.text : '#AAAAAA', cursor:'pointer', fontSize:12, fontWeight:700, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                  <span style={{ width:8, height:8, borderRadius:'50%', background: cfg.dot }} />
                  {cfg.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Suivi */}
        <div style={{ marginBottom:14 }}>
          <p style={{ fontSize:11, fontWeight:700, color:'#697280', margin:'0 0 8px', textTransform:'uppercase', letterSpacing:0.3 }}>Suivi</p>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {SUIVIS.map(s => {
              const cfg = SUIVI_MAP[s]
              const active = suivi === s
              return (
                <button key={s} onClick={() => setSuivi(s)}
                  style={{ padding:'6px 12px', borderRadius:20, border:`2px solid ${active ? cfg.border : '#E8E8E8'}`, background: active ? cfg.bg : '#F9F9F9', color: active ? cfg.text : '#AAAAAA', cursor:'pointer', fontSize:11, fontWeight:700, display:'flex', alignItems:'center', gap:4 }}>
                  <span style={{ width:6, height:6, borderRadius:'50%', background: cfg.dot }} />
                  {cfg.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Photos */}
        <div style={{ marginBottom:16 }}>
          <p style={{ fontSize:11, fontWeight:700, color:'#697280', margin:'0 0 8px', textTransform:'uppercase', letterSpacing:0.3 }}>Photos</p>

          {photos.length > 0 ? (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:8 }}>
              {photos.map((p, idx) => (
                <div key={idx} style={{ position:'relative', aspectRatio:'1', borderRadius:8, overflow:'hidden' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                  <button onClick={() => removePhoto(idx)}
                    style={{ position:'absolute', top:4, right:4, background:'#E30513', color:'white', border:'none', borderRadius:'50%', width:22, height:22, cursor:'pointer', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1 }}>×</button>
                </div>
              ))}
              {/* Add more */}
              <label style={{ aspectRatio:'1', borderRadius:8, border:`2px dashed #E8E8E8`, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', background:'#F9F9F9' }}>
                <span style={{ fontSize:22, color:'#AAAAAA' }}>+</span>
                <input type="file" accept="image/*" multiple onChange={e => e.target.files && readFiles(e.target.files)} style={{ display:'none' }} />
              </label>
            </div>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              <label style={{ height:80, borderRadius:10, border:`2px dashed #E8E8E8`, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', cursor:'pointer', background:'#F9F9F9', gap:4 }}>
                <span style={{ fontSize:22 }}>🖼</span>
                <span style={{ fontSize:11, color:'#AAAAAA', fontWeight:600 }}>Galerie</span>
                <input ref={galleryRef} type="file" accept="image/*" multiple onChange={e => e.target.files && readFiles(e.target.files)} style={{ display:'none' }} />
              </label>
              <label style={{ height:80, borderRadius:10, border:`2px dashed #E8E8E8`, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', cursor:'pointer', background:'#F9F9F9', gap:4 }}>
                <span style={{ fontSize:22 }}>📷</span>
                <span style={{ fontSize:11, color:'#AAAAAA', fontWeight:600 }}>Caméra</span>
                <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={e => e.target.files && readFiles(e.target.files)} style={{ display:'none' }} />
              </label>
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onClose}
            style={{ flex:1, padding:'13px 0', background:'#F9F9F9', color:'#697280', border:`1px solid #E8E8E8`, borderRadius:10, fontSize:13, fontWeight:700, cursor:'pointer' }}>
            Annuler
          </button>
          <button onClick={handleSave} disabled={!titre.trim()}
            style={{ flex:2, padding:'13px 0', background: titre.trim() ? '#E30513' : '#E8E8E8', color: titre.trim() ? 'white' : '#AAAAAA', border:'none', borderRadius:10, fontSize:13, fontWeight:700, cursor: titre.trim() ? 'pointer' : 'default' }}>
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  )
}
