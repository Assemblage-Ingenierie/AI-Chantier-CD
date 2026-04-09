'use client'
import { useState } from 'react'
import type { Item, Urgence, Suivi } from '@/lib/types'
import { URGENCE_CONFIG, SUIVI_CONFIG } from '@/lib/types'

const URGENCE_LIST: Urgence[] = ['haute', 'moyenne', 'basse']
const SUIVI_LIST: Suivi[] = ['rien', 'a_faire', 'en_cours', 'prochaine', 'fait']

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
  const [photo, setPhoto] = useState<string | undefined>(item?.photo)

  function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setPhoto(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  function handleSave() {
    if (!titre.trim()) return
    onSave({
      id: item?.id ?? Date.now(),
      titre: titre.trim(),
      commentaire: commentaire.trim() || undefined,
      urgence,
      suivi,
      photo,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#fff' }}
        className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 style={{ color: '#222' }} className="font-bold text-lg">
            {item ? 'Modifier l\'observation' : 'Nouvelle observation'}
          </h2>
          <button onClick={onClose} style={{ color: '#697280' }} className="text-2xl leading-none">✕</button>
        </div>

        {/* Titre */}
        <div>
          <label style={{ color: '#697280' }} className="text-xs font-semibold uppercase tracking-wide block mb-1.5">Titre *</label>
          <input value={titre} onChange={e => setTitre(e.target.value)}
            placeholder="Ex: Fissure plafond RDC..."
            style={{ borderColor: '#E8E8E8', color: '#222' }}
            className="w-full px-4 py-3 rounded-xl border text-sm outline-none focus:border-red-500" />
        </div>

        {/* Commentaire */}
        <div>
          <label style={{ color: '#697280' }} className="text-xs font-semibold uppercase tracking-wide block mb-1.5">Commentaire</label>
          <textarea value={commentaire} onChange={e => setCommentaire(e.target.value)}
            placeholder="Description, contexte, notes..."
            rows={3}
            style={{ borderColor: '#E8E8E8', color: '#222' }}
            className="w-full px-4 py-3 rounded-xl border text-sm outline-none focus:border-red-500 resize-none" />
        </div>

        {/* Urgence */}
        <div>
          <label style={{ color: '#697280' }} className="text-xs font-semibold uppercase tracking-wide block mb-2">Urgence</label>
          <div className="flex gap-2">
            {URGENCE_LIST.map(u => {
              const cfg = URGENCE_CONFIG[u]
              const active = urgence === u
              return (
                <button key={u} onClick={() => setUrgence(u)}
                  style={{
                    background: active ? cfg.bg : '#F9F9F9',
                    color: active ? cfg.text : '#697280',
                    borderColor: active ? cfg.border : '#E8E8E8',
                    borderWidth: 2,
                  }}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold border transition-all flex items-center justify-center gap-1.5">
                  <span style={{ background: cfg.dot }} className="w-2 h-2 rounded-full" />
                  {cfg.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Suivi */}
        <div>
          <label style={{ color: '#697280' }} className="text-xs font-semibold uppercase tracking-wide block mb-2">Suivi</label>
          <div className="flex flex-wrap gap-2">
            {SUIVI_LIST.map(s => {
              const cfg = SUIVI_CONFIG[s]
              const active = suivi === s
              return (
                <button key={s} onClick={() => setSuivi(s)}
                  style={{
                    background: active ? cfg.bg : '#F9F9F9',
                    color: active ? cfg.text : '#697280',
                    borderColor: active ? cfg.border : '#E8E8E8',
                    borderWidth: 2,
                  }}
                  className="px-3 py-2 rounded-xl text-sm font-medium border transition-all">
                  {cfg.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Photo */}
        <div>
          <label style={{ color: '#697280' }} className="text-xs font-semibold uppercase tracking-wide block mb-2">Photo</label>
          {photo ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt="observation" className="w-full h-40 object-cover rounded-xl" />
              <button onClick={() => setPhoto(undefined)}
                style={{ background: '#E30513', color: '#fff' }}
                className="absolute top-2 right-2 w-7 h-7 rounded-full text-sm flex items-center justify-center">✕</button>
            </div>
          ) : (
            <label style={{ borderColor: '#E8E8E8', color: '#697280' }}
              className="flex items-center justify-center gap-2 w-full h-14 rounded-xl border-2 border-dashed text-sm cursor-pointer hover:bg-gray-50">
              📷 Ajouter une photo
              <input type="file" accept="image/*" onChange={handlePhoto} className="hidden" />
            </label>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button onClick={onClose}
            style={{ borderColor: '#E8E8E8', color: '#697280' }}
            className="flex-1 h-14 rounded-xl border font-semibold text-sm">
            Annuler
          </button>
          <button onClick={handleSave} disabled={!titre.trim()}
            style={{ background: titre.trim() ? '#E30513' : '#E8E8E8', color: titre.trim() ? '#fff' : '#AAAAAA' }}
            className="flex-1 h-14 rounded-xl font-semibold text-sm transition-colors">
            Sauvegarder
          </button>
        </div>
      </div>
    </div>
  )
}
