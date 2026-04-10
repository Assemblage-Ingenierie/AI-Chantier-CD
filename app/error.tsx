'use client'
import { useEffect } from 'react'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[ChantierAI] Erreur inattendue:', error)
  }, [error])

  return (
    <div style={{
      minHeight: '100vh', background: '#30323E', display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: 32, fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ maxWidth: 400, textAlign: 'center' }}>
        <p style={{ color: '#E30513', fontWeight: 700, fontSize: 16, margin: '0 0 8px' }}>
          Erreur inattendue
        </p>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, margin: '0 0 20px', lineHeight: 1.5 }}>
          {error.message}
        </p>
        <button
          onClick={reset}
          style={{
            background: '#E30513', color: 'white', border: 'none',
            borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Recharger l&apos;application
        </button>
      </div>
    </div>
  )
}
