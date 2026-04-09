'use client'
import { useState } from 'react'

interface Props {
  onClose: () => void
  onSave: (f: { nom: string; adresse: string; maitreOuvrage: string; photo: string | null }) => void
}

export function NewProjet({ onClose, onSave }: Props) {
  const [f, setF] = useState({ nom: '', adresse: '', maitreOuvrage: '', photo: null as string | null })

  function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setF(prev => ({ ...prev, photo: ev.target?.result as string }))
    reader.readAsDataURL(file)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ background: '#FFFFFF', width: '100%', borderRadius: '16px 16px 0 0', padding: 20, maxHeight: '90vh', overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <p style={{ fontWeight: 800, fontSize: 15, color: '#222222', margin: 0 }}>Nouveau projet</p>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#AAAAAA', fontSize: 20 }}>✕</button>
        </div>

        {/* Photo */}
        <label style={{ position: 'relative', width: '100%', height: 120, borderRadius: 12, border: '2px dashed #E8E8E8', overflow: 'hidden', cursor: 'pointer', background: '#F9F9F9', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
          {f.photo ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.photo} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: 'white', fontSize: 12, background: 'rgba(0,0,0,0.4)', borderRadius: 8, padding: '4px 10px' }}>Changer</span>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 24, margin: 0 }}>📷</p>
              <p style={{ fontSize: 11, color: '#AAAAAA', marginTop: 4 }}>Photo du projet</p>
            </div>
          )}
          <input type="file" accept="image/*" onChange={handlePhoto} style={{ display: 'none' }} />
        </label>

        {/* Champs */}
        {[
          { key: 'nom', label: 'Nom du projet *', placeholder: 'Ex: Résidence Les Lilas' },
          { key: 'adresse', label: 'Adresse', placeholder: 'Ex: 12 rue de la Paix, Paris' },
          { key: 'maitreOuvrage', label: "Maître d'ouvrage", placeholder: 'Ex: Ville de Paris' },
        ].map(({ key, label, placeholder }) => (
          <div key={key} style={{ marginBottom: 12 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#697280', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</p>
            <input
              value={f[key as keyof typeof f] as string}
              onChange={e => setF(prev => ({ ...prev, [key]: e.target.value }))}
              placeholder={placeholder}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #E8E8E8', fontSize: 14, outline: 'none', color: '#222222', boxSizing: 'border-box' }}
            />
          </div>
        ))}

        <button
          onClick={() => { if (f.nom.trim()) { onSave(f); onClose() } }}
          disabled={!f.nom.trim()}
          style={{ width: '100%', padding: '13px 0', background: f.nom.trim() ? '#E30513' : '#E8E8E8', color: f.nom.trim() ? 'white' : '#AAAAAA', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: f.nom.trim() ? 'pointer' : 'default', marginTop: 4 }}
        >
          Créer le projet
        </button>
      </div>
    </div>
  )
}
