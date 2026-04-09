'use client'
import { useState, useEffect } from 'react'
import { Logo } from './ui/Logo'

interface Props { onLogin: (session: unknown) => void }

export function LoginScreen({ onLogin }: Props) {
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [magic, setMagic] = useState(false)
  const [sbClient, setSbClient] = useState<unknown>(null)

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(cfg => {
      if (cfg.url && cfg.key) {
        import('@supabase/supabase-js').then(({ createClient }) => {
          setSbClient(createClient(cfg.url, cfg.key))
        })
      }
    }).catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!sbClient) { setError('Config error'); return }
    setLoading(true); setError('')
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = sbClient as any
      if (tab === 'login') {
        const { data, error: err } = await sb.auth.signInWithPassword({ email, password })
        if (err) throw err
        if (data?.session) onLogin(data.session)
      } else {
        const { error: err } = await sb.auth.signUp({ email, password })
        if (err) throw err
        setError('Compte créé — vérifiez votre email pour confirmer.')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally { setLoading(false) }
  }

  async function handleGoogle() {
    if (!sbClient) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (sbClient as any).auth.signInWithOAuth({ provider: 'google' })
  }

  async function handleMagic() {
    if (!sbClient || !email) { setError('Saisissez votre email'); return }
    setLoading(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (sbClient as any).auth.signInWithOtp({ email })
    setMagic(true); setLoading(false)
  }

  return (
    <div style={{ background: '#30323E' }} className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Logo size="md" />
        </div>

        {/* Tabs */}
        <div style={{ background: '#3D3F4C' }} className="flex rounded-xl p-1 mb-6">
          {(['login', 'register'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={tab === t ? { background: '#E30513', color: '#fff' } : { color: '#9CA3AF' }}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all">
              {t === 'login' ? 'Connexion' : 'Créer un compte'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="Email" required
            style={{ background: '#3D3F4C', color: '#fff', borderColor: '#555' }}
            className="w-full px-4 py-3 rounded-xl border text-sm outline-none focus:border-red-500"
          />
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Mot de passe" required={tab === 'login'}
            style={{ background: '#3D3F4C', color: '#fff', borderColor: '#555' }}
            className="w-full px-4 py-3 rounded-xl border text-sm outline-none focus:border-red-500"
          />
          <button type="submit" disabled={loading}
            style={{ background: '#E30513' }}
            className="w-full py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-60">
            {loading ? '...' : (tab === 'login' ? 'Se connecter' : "S'inscrire")}
          </button>
        </form>

        {magic && <p className="text-green-400 text-sm text-center mt-3">Lien envoyé à {email}</p>}

        <div className="flex items-center gap-3 my-4">
          <div style={{ background: '#555' }} className="flex-1 h-px" />
          <span style={{ color: '#9CA3AF' }} className="text-xs">ou</span>
          <div style={{ background: '#555' }} className="flex-1 h-px" />
        </div>

        <div className="space-y-2">
          <button onClick={handleGoogle}
            style={{ background: '#fff', color: '#222' }}
            className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2">
            <span>G</span> Continuer avec Google
          </button>
          <button onClick={handleMagic}
            style={{ background: '#3D3F4C', color: '#9CA3AF', borderColor: '#555' }}
            className="w-full py-3 rounded-xl font-semibold text-sm border">
            Envoyer un lien magique
          </button>
        </div>

        {error && (
          <div style={{ background: '#7F1D1D', color: '#FCA5A5', borderColor: '#B91C1C' }}
            className="mt-4 px-4 py-3 rounded-xl text-sm border text-center">{error}</div>
        )}
      </div>
    </div>
  )
}
