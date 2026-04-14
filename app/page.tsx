'use client'
import { useState, useEffect, useCallback } from 'react'
import type { Projet, Item, UserProfile } from '@/lib/types'
import { saveLocal, loadLocal } from '@/lib/storage'
import { loadRemoteState, saveRemoteState } from '@/lib/supabase'
import { LoginScreen } from '@/components/LoginScreen'
import { Dashboard } from '@/components/Dashboard'
import { VueProjet } from '@/components/VueProjet'
import { NewProjet } from '@/components/NewProjet'

type AuthState = 'loading' | 'loggedout' | 'waiting' | 'approved'
type SyncStatus = 'idle' | 'saving' | 'saved' | 'error'

let _saveTimeout: ReturnType<typeof setTimeout> | null = null
let _setSyncStatus: ((s: SyncStatus) => void) | null = null

function scheduleSave(projets: Projet[]) {
  if (_saveTimeout) clearTimeout(_saveTimeout)
  _setSyncStatus?.('saving')
  _saveTimeout = setTimeout(async () => {
    saveLocal(projets)
    try {
      const { slim, blobs } = extractForRemote(projets)
      await saveRemoteState({ payload: slim, blobs })
      _setSyncStatus?.('saved')
    } catch {
      _setSyncStatus?.('error')
    }
  }, 2000)
}

// extractForRemote : même logique que storage.ts — toutes les images en blobs séparés
function extractItemBlobs(item: Item, blobs: Record<string, string>): Item {
  const slim = { ...item }
  if (slim.photo && slim.photo.startsWith('data:')) {
    blobs[`iph_${item.id}`] = slim.photo
    slim.photo = '__img__'
  }
  if (slim.photos?.length) {
    slim.photos = slim.photos.map((p, i) => {
      if (p.startsWith('data:')) { blobs[`iphs_${item.id}_${i}`] = p; return '__img__' }
      return p
    })
  }
  return slim
}

function extractForRemote(projets: Projet[]) {
  const blobs: Record<string, string> = {}
  const slim = projets.map(p => {
    const proj = { ...p }

    if (proj.photo && proj.photo.startsWith('data:')) {
      blobs[`pph_${p.id}`] = proj.photo
      proj.photo = '__img__'
    }
    if (proj.planLibrary) {
      proj.planLibrary = proj.planLibrary.map(pl => {
        if (pl.bg && pl.bg !== '__img__')   blobs[`plb_${p.id}_${pl.id}`] = pl.bg
        if (pl.data && pl.data !== '__pdf__') blobs[`pld_${p.id}_${pl.id}`] = pl.data
        return { ...pl, bg: pl.bg ? '__img__' : '', data: pl.data ? '__pdf__' : '' }
      })
    }
    if (proj.localisations) {
      proj.localisations = proj.localisations.map(loc => {
        const l = { ...loc }
        if (l.planBg)   { blobs[`pb_${p.id}_${loc.id}`] = l.planBg;   l.planBg   = '__img__' }
        if (l.planData) { blobs[`pd_${p.id}_${loc.id}`] = l.planData; l.planData = '__pdf__' }
        if (l.items)    l.items    = l.items.map(i => extractItemBlobs(i, blobs))
        if (l.sections) l.sections = l.sections.map(s => ({
          ...s, items: (s.items ?? []).map(i => extractItemBlobs(i, blobs))
        }))
        return l
      })
    }
    return proj
  })
  return { slim, blobs }
}

// ---- Top bar (header noir commun à toutes les vues) ----
const SYNC_CONFIG: Record<SyncStatus, { dot: string; label: string }> = {
  idle:   { dot: '#AAAAAA', label: 'Local' },
  saving: { dot: '#D97706', label: 'Sauvegarde…' },
  saved:  { dot: '#16A34A', label: 'Sauvegardé' },
  error:  { dot: '#E30513', label: 'Erreur sync' },
}

function TopBar({ onLogout, syncStatus }: { onLogout: () => void; syncStatus: SyncStatus }) {
  const sc = SYNC_CONFIG[syncStatus]
  return (
    <div style={{ background: '#222222', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
      {/* Logo Assemblage */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 3, height: 20, background: '#E30513', borderRadius: 2 }} />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
          <span style={{ color: '#E30513', fontWeight: 900, fontSize: 12, fontStyle: 'italic', letterSpacing: -0.5 }}>
            Assembl<span style={{ color: 'white' }}>!</span>age
          </span>
          <span style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 700, fontSize: 9, fontStyle: 'italic', letterSpacing: -0.3 }}>
            ingénierie
          </span>
        </div>
      </div>
      {/* Right */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={onLogout}
          style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.5)', fontSize: 10, padding: '3px 7px', borderRadius: 5, cursor: 'pointer' }}>
          Sortir
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: sc.dot, transition: 'background 0.3s' }} />
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>{sc.label}</span>
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  const [authState, setAuthState] = useState<AuthState>('loading')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [projets, setProjets] = useState<Projet[]>([])
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')
  const [selected, setSelected] = useState<Projet | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [sbClient, setSbClient] = useState<unknown>(null)

  // Wire the module-level setter so scheduleSave can update UI
  useEffect(() => { _setSyncStatus = setSyncStatus; return () => { _setSyncStatus = null } }, [])

  // Init auth
  useEffect(() => {
    // Dev bypass on localhost
    if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      setProfile({ id: 'dev', name: 'Thomas (dev)', email: 'thomas@assemblage.net', is_approved: true })
      setAuthState('approved')
      return
    }
    async function init() {
      try {
        const cfgRes = await fetch('/api/config')
        if (!cfgRes.ok) { setAuthState('loggedout'); return }
        const cfg = await cfgRes.json()
        const { createClient } = await import('@supabase/supabase-js')
        const sb = createClient(cfg.url, cfg.key)
        setSbClient(sb)
        const { data } = await sb.auth.getSession()
        if (data?.session) {
          setProfile({ id: data.session.user.id, email: data.session.user.email, is_approved: true })
          setAuthState('approved')
        } else {
          setAuthState('loggedout')
        }
        sb.auth.onAuthStateChange((event: string, session: unknown) => {
          if (event === 'SIGNED_OUT') { setAuthState('loggedout'); setProfile(null) }
          if (session) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const s = session as any
            setProfile({ id: s.user.id, email: s.user.email, is_approved: true })
            setAuthState('approved')
          }
        })
      } catch { setAuthState('loggedout') }
    }
    init()
  }, [])

  // Load data when approved
  useEffect(() => {
    if (authState !== 'approved') return
    async function load() {
      const remote = await loadRemoteState()
      if (remote?.payload?.length) {
        const blobs = remote.blobs ?? {}
        const rehydrateItem = (item: Item): Item => ({
          ...item,
          photo:  item.photo  === '__img__' ? (blobs[`iph_${item.id}`]  ?? '') : item.photo,
          photos: item.photos?.map((p2, i) => p2 === '__img__' ? (blobs[`iphs_${item.id}_${i}`] ?? '') : p2),
        })
        const rehydrated = (remote.payload as Projet[]).map(p => ({
          ...p,
          photo: p.photo === '__img__' ? (blobs[`pph_${p.id}`] ?? '') : p.photo,
          planLibrary: (p.planLibrary ?? []).map(pl => ({
            ...pl,
            bg:   blobs[`plb_${p.id}_${pl.id}`] ?? '',
            data: blobs[`pld_${p.id}_${pl.id}`] ?? '',
          })),
          localisations: (p.localisations ?? []).map(loc => ({
            ...loc,
            planBg:   blobs[`pb_${p.id}_${loc.id}`] ?? undefined,
            planData: blobs[`pd_${p.id}_${loc.id}`] ?? undefined,
            items:    (loc.items ?? []).map(rehydrateItem),
            sections: (loc.sections ?? []).map(s => ({ ...s, items: (s.items ?? []).map(rehydrateItem) })),
          })),
        }))
        setProjets(rehydrated)
        setSyncStatus('saved')
      } else {
        const local = loadLocal()
        if (local) setProjets(local)
        setSyncStatus('idle')
      }
    }
    load()
  }, [authState])

  const updateProjets = useCallback((next: Projet[]) => {
    setProjets(next)
    scheduleSave(next)
  }, [])

  function logout() {
    if (sbClient) (sbClient as any).auth.signOut() // eslint-disable-line @typescript-eslint/no-explicit-any
    setAuthState('loggedout'); setProfile(null)
  }

  function handleNew(f: { nom: string; adresse: string; maitreOuvrage: string; photo: string | null }) {
    const p: Projet = {
      id: Date.now(), nom: f.nom, adresse: f.adresse || undefined,
      maitreOuvrage: f.maitreOuvrage || undefined, photo: f.photo || undefined,
      statut: 'actif', localisations: [], participants: [], planLibrary: [], tableauRecap: [],
    }
    updateProjets([...projets, p])
    setSelected(p)
  }

  function handleArchive(id: number) {
    updateProjets(projets.map(p => p.id === id ? { ...p, statut: p.statut === 'archive' ? 'actif' : 'archive' } : p))
  }

  function handleDelete(id: number) {
    updateProjets(projets.filter(p => p.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  function handleUpdate(p: Projet) {
    const next = projets.map(x => x.id === p.id ? p : x)
    updateProjets(next)
    if (selected?.id === p.id) setSelected(p)
  }

  // ---- Auth states ----
  if (authState === 'loading') {
    return (
      <div style={{ background: '#30323E', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid #E30513', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
      </div>
    )
  }

  if (authState === 'loggedout') {
    return <LoginScreen onLogin={() => { setProfile({ id: 'user', is_approved: true }); setAuthState('approved') }} />
  }

  if (authState === 'waiting') {
    return (
      <div style={{ background: '#30323E', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div style={{ background: '#3D3F4C', borderRadius: 16, padding: 32, textAlign: 'center', maxWidth: 360, width: '100%' }}>
          <p style={{ color: 'white', fontWeight: 700, fontSize: 18, margin: '0 0 8px' }}>Compte en attente</p>
          <p style={{ color: '#9CA3AF', fontSize: 14, margin: '0 0 24px' }}>{profile?.email}</p>
          <button onClick={logout} style={{ color: '#E30513', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>Se déconnecter</button>
        </div>
      </div>
    )
  }

  // ---- App shell (390px, header noir) ----
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', maxWidth: 390, margin: '0 auto', overflow: 'hidden', fontFamily: "'Inter',system-ui,sans-serif", background: '#F9F9F9' }}>
      <TopBar onLogout={logout} syncStatus={syncStatus} />

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {selected ? (
          <VueProjet
            projet={selected}
            onBack={() => setSelected(null)}
            onUpdate={p => { handleUpdate(p); setSelected(p) }}
          />
        ) : (
          <div style={{ height: '100%', overflowY: 'auto' }}>
            <Dashboard
              projets={projets}
              onSelect={setSelected}
              onNew={() => setShowNew(true)}
              onUpdate={handleUpdate}
              onArchive={handleArchive}
              onDelete={handleDelete}
              synced={syncStatus === 'saved'}
            />
          </div>
        )}
      </div>

      {showNew && (
        <NewProjet
          onClose={() => setShowNew(false)}
          onSave={handleNew}
        />
      )}
    </div>
  )
}
