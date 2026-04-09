'use client'
import { useState } from 'react'
import type { Projet } from '@/lib/types'
import { ProjectCard } from './ProjectCard'

interface Props {
  projets: Projet[]
  onSelect: (p: Projet) => void
  onNew: () => void
  onUpdate: (p: Projet) => void
  onArchive: (id: number) => void
  onDelete: (id: number) => void
  synced: boolean
}

export function Dashboard({ projets, onSelect, onNew, onUpdate, onArchive, onDelete, synced }: Props) {
  const [showArchived, setShowArchived] = useState(false)
  const [menuOpen, setMenuOpen] = useState<number | null>(null)

  const actifs = projets.filter(p => p.statut !== 'archive')
  const archives = projets.filter(p => p.statut === 'archive')

  const countItems = (ps: Projet[]) => ps.reduce((s, p) =>
    s + (p.localisations ?? []).reduce((ss, l) =>
      ss + ((l.sections?.length ?? 0) > 0
        ? (l.sections ?? []).reduce((sss, sec) => sss + (sec.items?.length ?? 0), 0)
        : (l.items?.length ?? 0)), 0), 0)

  const countUrgent = (ps: Projet[]) => ps.reduce((s, p) =>
    s + (p.localisations ?? []).reduce((ss, l) => {
      const items = (l.sections?.length ?? 0) > 0
        ? (l.sections ?? []).flatMap(sec => sec.items ?? [])
        : (l.items ?? [])
      return ss + items.filter(i => i.urgence === 'haute').length
    }, 0), 0)

  const stats = [
    { l: 'Projets actifs', v: actifs.length },
    { l: 'Observations', v: countItems(projets) },
    { l: 'Archivés', v: archives.length },
    { l: 'Urgentes', v: countUrgent(projets), red: true },
  ]

  return (
    <div
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 18 }}
      onClick={() => menuOpen && setMenuOpen(null)}
    >
      {/* Title + Nouveau */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: '#222222', margin: 0, letterSpacing: -0.5 }}>
            <span style={{ color: '#E30513' }}>AI</span> chantier
          </h1>
          <p style={{ fontSize: 11, color: '#AAAAAA', margin: '2px 0 0' }}>
            {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <button
          onClick={onNew}
          style={{ background: '#E30513', color: 'white', border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          + Nouveau
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {stats.map(s => (
          <div key={s.l} style={{ background: '#F9F9F9', borderRadius: 12, padding: '12px 14px', border: '1px solid #E8E8E8' }}>
            <p style={{ fontSize: 22, fontWeight: 900, color: s.red ? '#E30513' : '#222222', margin: 0 }}>{s.v}</p>
            <p style={{ fontSize: 11, color: '#697280', margin: '2px 0 0' }}>{s.l}</p>
          </div>
        ))}
      </div>

      {/* Projets en cours */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 style={{ fontSize: 13, fontWeight: 800, color: '#222222', margin: 0 }}>Projets en cours</h2>
          <span style={{ fontSize: 11, background: '#FFF0F0', color: '#E30513', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
            {actifs.length}
          </span>
        </div>

        {actifs.length === 0 ? (
          <div style={{ borderRadius: 14, overflow: 'hidden', border: '1.5px solid #E8E8E8', background: '#FFFFFF' }}>
            <div style={{ background: 'linear-gradient(135deg,#1a1a1a,#333)', padding: '20px 18px 16px', borderBottom: '3px solid #E30513' }}>
              <p style={{ color: 'white', fontWeight: 800, fontSize: 15, margin: '0 0 4px' }}>
                Bienvenue sur <span style={{ color: '#E30513' }}>AI</span> chantier
              </p>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, margin: 0 }}>Votre outil de visite chantier</p>
            </div>
            <div style={{ padding: '14px 18px' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#AAAAAA', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: 0.5 }}>COMMENT DÉMARRER</p>
              {[
                ['1', 'Créez un projet', 'Appuyez sur "Nouveau" en haut à droite'],
                ['2', 'Ajoutez vos zones', 'RDC, R+1, Toiture, Façades...'],
                ['3', 'Saisissez vos observations', 'Avec photos, urgence et suivi'],
                ['4', 'Générez le rapport PDF', 'Onglet Rapport → Exporter'],
              ].map(([n, t, d]) => (
                <div key={n} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                  <span style={{ background: '#E30513', color: 'white', width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{n}</span>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: '#222222', margin: 0 }}>{t}</p>
                    <p style={{ fontSize: 11, color: '#697280', margin: '1px 0 0' }}>{d}</p>
                  </div>
                </div>
              ))}
              <button onClick={onNew}
                style={{ width: '100%', marginTop: 6, background: '#E30513', color: 'white', border: 'none', borderRadius: 10, padding: '11px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                + Créer mon premier projet
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {actifs.map(p => (
              <ProjectCard key={p.id} projet={p}
                onSelect={() => onSelect(p)}
                onArchive={() => onArchive(p.id)}
                onDelete={() => onDelete(p.id)}
                onEdit={nom => onUpdate({ ...p, nom })}
                menuOpen={menuOpen === p.id}
                onMenuToggle={open => setMenuOpen(open ? p.id : null)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Archivés */}
      {archives.length > 0 && (
        <div>
          <button
            onClick={() => setShowArchived(!showArchived)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#697280', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}
          >
            {showArchived ? '▼' : '▶'} Archivés ({archives.length})
          </button>
          {showArchived && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {archives.map(p => (
                <ProjectCard key={p.id} projet={p}
                  onSelect={() => onSelect(p)}
                  onArchive={() => onArchive(p.id)}
                  onDelete={() => onDelete(p.id)}
                  onEdit={nom => onUpdate({ ...p, nom })}
                  menuOpen={menuOpen === p.id}
                  onMenuToggle={open => setMenuOpen(open ? p.id : null)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Toast offline */}
      {!synced && (
        <div style={{ background: '#1a1a2e', color: '#94A3B8', border: '1px solid #334155', borderRadius: 12, padding: '10px 14px', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Synchronisation distante indisponible — données chargées depuis le cache local.</span>
          <span style={{ color: '#E30513', marginLeft: 8, fontWeight: 700, cursor: 'pointer' }}>✕</span>
        </div>
      )}
    </div>
  )
}
