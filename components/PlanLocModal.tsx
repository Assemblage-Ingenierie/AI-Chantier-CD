'use client'
import { useState } from 'react'
import type { PlanLib, Localisation } from '@/lib/types'
import { AnnotationEditor } from './AnnotationEditor'

interface PlanLocModalProps {
  loc: Localisation
  planLibrary: PlanLib[]
  onSave: (data: { planBg: string; planData: string | null; planAnnotations: object | null }) => void
  onClose: () => void
}

interface AnnotState {
  paths: object[]
  exported: string
}

export function PlanLocModal({ loc, planLibrary, onSave, onClose }: PlanLocModalProps) {
  const [planBg, setPlanBg] = useState<string>(loc.planBg ?? '')
  const [planData, setPlanData] = useState<string | null>(loc.planData ?? null)
  const [annot, setAnnot] = useState<AnnotState | null>(
    loc.planAnnotations ? (loc.planAnnotations as AnnotState) : null
  )
  const [showAnnot, setShowAnnot] = useState(false)

  const selectedPlan = planLibrary.find(pl => pl.bg === planBg)

  function selectPlan(pl: PlanLib) {
    if (planBg === pl.bg) {
      // Deselect
      setPlanBg('')
      setPlanData(null)
      setAnnot(null)
    } else {
      setPlanBg(pl.bg)
      setPlanData(pl.data ?? null)
      setAnnot(null)
    }
  }

  function handleSaveAnnot(paths: object[], exported: string) {
    setAnnot({ paths, exported })
    setPlanBg(exported) // Use annotated export as the displayed plan
    setShowAnnot(false)
  }

  function handleConfirm() {
    onSave({ planBg, planData, planAnnotations: annot })
  }

  function handleReset() {
    setPlanBg('')
    setPlanData(null)
    setAnnot(null)
  }

  if (showAnnot) {
    return (
      <AnnotationEditor
        bgImage={planBg}
        savedPaths={annot ? (annot.paths as Parameters<typeof AnnotationEditor>[0]['savedPaths']) : []}
        onSave={handleSaveAnnot}
        onClose={() => setShowAnnot(false)}
      />
    )
  }

  const annotCount = annot?.paths?.length ?? 0

  return (
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 50, display: 'flex', alignItems: 'flex-end' }}
    >
      <div style={{ background: 'white', width: '100%', borderRadius: '16px 16px 0 0', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px 10px', borderBottom: '1px solid #E8E8E8' }}>
          <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>Plan — {loc.nom}</span>
          {planLibrary.length > 0 && (
            <span style={{ fontSize: 11, color: '#9CA3AF', marginRight: 8 }}>{planLibrary.length} plan{planLibrary.length > 1 ? 's' : ''}</span>
          )}
          <button
            onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: '#F3F4F6', cursor: 'pointer', fontSize: 14 }}
          >✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
          {/* Library selection */}
          {planLibrary.length > 0 ? (
            <>
              <p style={{ fontSize: 12, color: '#697280', fontWeight: 600, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Choisir dans la bibliothèque
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {planLibrary.map(pl => {
                  const selected = planBg === pl.bg || (selectedPlan?.id === pl.id)
                  return (
                    <div
                      key={pl.id}
                      onClick={() => selectPlan(pl)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: 10,
                        borderRadius: 10, cursor: 'pointer',
                        border: selected ? '2.5px solid #E30513' : '1px solid #E8E8E8',
                        background: selected ? '#FFF0F0' : '#F9F9F9',
                      }}
                    >
                      <div style={{ width: 64, height: 44, borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
                        <img src={pl.bg} alt={pl.nom} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{pl.nom}</div>
                        <div style={{ fontSize: 11, color: '#9CA3AF' }}>{pl.data ? 'PDF' : 'Image'}</div>
                      </div>
                      {selected && <span style={{ color: '#E30513', fontSize: 16 }}>✓</span>}
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#9CA3AF', fontSize: 13 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🗺</div>
              Bibliothèque vide — ajoutez des plans depuis le projet
            </div>
          )}

          {/* Selected plan preview */}
          {planBg && (
            <div style={{ marginTop: 8 }}>
              <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
                <img
                  src={planBg}
                  alt="Plan sélectionné"
                  style={{ width: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 8, border: '1px solid #E8E8E8' }}
                />
                {annotCount > 0 && (
                  <span style={{
                    position: 'absolute', top: 8, right: 8,
                    background: '#E30513', color: 'white', borderRadius: 12,
                    padding: '2px 8px', fontSize: 11, fontWeight: 700,
                  }}>
                    {annotCount} annotation{annotCount > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <button
                onClick={() => setShowAnnot(true)}
                style={{
                  marginTop: 10, width: '100%', padding: '10px',
                  borderRadius: 8, border: '1px solid #E8E8E8',
                  background: 'white', color: '#222222', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                <span>✏️</span> Annoter ce plan
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 14px 24px', borderTop: '1px solid #E8E8E8', display: 'flex', gap: 8 }}>
          {planBg && (
            <button
              onClick={handleReset}
              style={{ padding: '12px 16px', borderRadius: 10, border: '1px solid #E8E8E8', background: 'white', color: '#E30513', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >Supprimer</button>
          )}
          <button
            onClick={handleConfirm}
            style={{ flex: 1, padding: '12px', borderRadius: 10, border: 'none', background: '#E30513', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
          >Confirmer</button>
        </div>
      </div>
    </div>
  )
}
