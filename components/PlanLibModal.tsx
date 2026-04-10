'use client'
import { useRef } from 'react'
import type { PlanLib } from '@/lib/types'

interface PlanLibModalProps {
  plans: PlanLib[]
  onAdd: (plan: PlanLib) => void
  onDelete: (id: number) => void
  onClose: () => void
}

export function PlanLibModal({ plans, onAdd, onDelete, onClose }: PlanLibModalProps) {
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string
      const nom = file.name.replace(/\.[^.]+$/, '')

      if (file.type === 'application/pdf') {
        // Load PDF.js and extract all pages
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pdfjsLib = (window as any).pdfjsLib
          if (!pdfjsLib) {
            alert('PDF.js non disponible. Utilisez une image.')
            return
          }
          const pdf = await pdfjsLib.getDocument({ data: dataUrl.split(',')[1] }).promise
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i)
            const viewport = page.getViewport({ scale: 1.5 })
            const canvas = document.createElement('canvas')
            canvas.width = viewport.width
            canvas.height = viewport.height
            const ctx = canvas.getContext('2d')!
            await page.render({ canvasContext: ctx, viewport }).promise
            const bg = canvas.toDataURL('image/png')
            onAdd({ id: Date.now() + i, nom: `${nom} — Page ${i}`, bg, data: dataUrl })
          }
        } catch {
          alert('Erreur lors du chargement du PDF.')
        }
      } else {
        // Image
        onAdd({ id: Date.now(), nom, bg: dataUrl, data: dataUrl })
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 60, display: 'flex', alignItems: 'flex-end' }}
    >
      <div style={{ background: 'white', width: '100%', borderRadius: '16px 16px 0 0', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px 10px', borderBottom: '1px solid #E8E8E8' }}>
          <span style={{ fontSize: 18, marginRight: 8 }}>🗂</span>
          <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>Bibliothèque de plans</span>
          <button
            onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: '#F3F4F6', cursor: 'pointer', fontSize: 14 }}
          >✕</button>
        </div>

        {/* Plan list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
          {plans.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#9CA3AF', fontSize: 13 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🗺</div>
              Aucun plan importé
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {plans.map(pl => (
                <div key={pl.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: '#F9F9F9', borderRadius: 10, border: '1px solid #E8E8E8' }}>
                  {/* Thumbnail */}
                  <div style={{ width: 64, height: 44, borderRadius: 6, overflow: 'hidden', background: '#E5E7EB', flexShrink: 0, border: '1px solid #E8E8E8' }}>
                    <img src={pl.bg} alt={pl.nom} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pl.nom}</div>
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{pl.data ? 'Document PDF' : 'Image'}</div>
                  </div>
                  {/* Delete */}
                  <button
                    onClick={() => onDelete(pl.id)}
                    style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: '#FFF0F0', color: '#E30513', cursor: 'pointer', fontSize: 14, flexShrink: 0 }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add button */}
        <div style={{ padding: '12px 14px 24px', borderTop: '1px solid #E8E8E8' }}>
          <button
            onClick={() => fileRef.current?.click()}
            style={{
              width: '100%', padding: '12px', borderRadius: 10,
              border: '2px dashed #E8E8E8', background: 'white',
              color: '#697280', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <span style={{ fontSize: 16 }}>+</span> Ajouter un plan (PDF, JPG, PNG)
          </button>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={handleFile} style={{ display: 'none' }} />
        </div>
      </div>
    </div>
  )
}
