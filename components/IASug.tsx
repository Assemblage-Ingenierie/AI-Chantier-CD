'use client'
import { useState } from 'react'
import { suggestObservation } from '@/lib/ai'

interface IASugProps {
  content: string
  onApply: (text: string) => void
}

export function IASug({ content, onApply }: IASugProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')

  async function handleOpen() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (!result) {
      setLoading(true)
      try {
        const raw = await suggestObservation(content)
        // Extract text after 💬 emoji
        const m = raw.match(/💬[^:]*:\s*([^]+?)(?=\n🔧|\n\n|$)/)
        setResult(m ? m[1].trim() : raw.split('\n').find(l => l.trim()) ?? raw)
      } catch {
        setResult('ERROR: Impossible de contacter l\'IA.')
      }
      setLoading(false)
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={handleOpen}
        style={{
          fontSize: 11,
          border: `1px solid ${open ? '#8B5CF6' : '#E8E8E8'}`,
          borderRadius: 20,
          padding: '3px 10px',
          background: open ? '#F5F3FF' : 'white',
          color: open ? '#7C3AED' : '#697280',
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        {open ? 'Fermer' : 'Suggestion IA ✦'}
      </button>

      {open && (
        <div style={{
          marginTop: 8,
          background: '#F5F3FF',
          border: '1px solid #DDD6FE',
          borderRadius: 10,
          padding: 12,
        }}>
          {loading ? (
            <div style={{ fontSize: 12, color: '#7C3AED', fontStyle: 'italic' }}>
              Analyse en cours…
            </div>
          ) : (
            <>
              <p style={{ fontSize: 12, color: '#4C1D95', margin: 0, lineHeight: 1.5 }}>{result}</p>
              {result && !result.startsWith('ERROR:') && (
                <button
                  onClick={() => { onApply(result); setOpen(false) }}
                  style={{
                    marginTop: 8,
                    fontSize: 11,
                    padding: '4px 12px',
                    background: '#7C3AED',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Appliquer la reformulation
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
