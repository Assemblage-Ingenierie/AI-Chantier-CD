'use client'
import { useState } from 'react'
import type { Projet } from '@/lib/types'

interface Props {
  projet: Projet
  onSelect: () => void
  onArchive: () => void
  onDelete: () => void
  onEdit: (nom: string) => void
  menuOpen: boolean
  onMenuToggle: (open: boolean) => void
}

export function ProjectCard({ projet, onSelect, onArchive, onDelete, onEdit, menuOpen, onMenuToggle }: Props) {
  const [editing, setEditing] = useState(false)
  const [nom, setNom] = useState(projet.nom)

  const totalObs = (projet.localisations ?? []).reduce((acc, loc) => {
    const n = (loc.sections?.length ?? 0) > 0
      ? (loc.sections ?? []).reduce((s, sec) => s + (sec.items?.length ?? 0), 0)
      : (loc.items?.length ?? 0)
    return acc + n
  }, 0)

  const urgentes = (projet.localisations ?? []).reduce((acc, loc) => {
    const items = (loc.sections?.length ?? 0) > 0
      ? (loc.sections ?? []).flatMap(s => s.items ?? [])
      : (loc.items ?? [])
    return acc + items.filter(i => i.urgence === 'haute').length
  }, 0)

  return (
    <div
      style={{ background: '#FFFFFF', borderRadius: 14, border: '1.5px solid #E8E8E8', padding: '12px 14px', cursor: 'pointer', position: 'relative' }}
      onClick={() => !menuOpen && !editing && onSelect()}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <input
              autoFocus value={nom}
              onChange={e => setNom(e.target.value)}
              onBlur={() => { onEdit(nom); setEditing(false) }}
              onKeyDown={e => e.key === 'Enter' && (onEdit(nom), setEditing(false))}
              onClick={e => e.stopPropagation()}
              style={{ fontWeight: 800, fontSize: 14, color: '#222222', width: '100%', outline: 'none', borderBottom: '2px solid #E30513', background: 'transparent' }}
            />
          ) : (
            <p style={{ fontWeight: 800, fontSize: 14, color: '#222222', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {projet.nom}
            </p>
          )}
          {projet.adresse && (
            <p style={{ fontSize: 11, color: '#697280', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{projet.adresse}</p>
          )}
        </div>

        {/* Menu button */}
        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onMenuToggle(!menuOpen)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#AAAAAA', fontSize: 18, padding: '0 4px', lineHeight: 1 }}
          >⋮</button>
          {menuOpen && (
            <div style={{ position: 'absolute', right: 0, top: 24, background: '#FFFFFF', border: '1px solid #E8E8E8', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', zIndex: 20, minWidth: 160, padding: '4px 0' }}>
              {[
                { label: '✏️ Renommer', action: () => { setEditing(true); onMenuToggle(false) } },
                { label: projet.statut === 'archive' ? '📂 Réactiver' : '📦 Archiver', action: () => { onArchive(); onMenuToggle(false) } },
                { label: '🗑 Supprimer', action: () => { if (confirm('Supprimer ce projet ?')) { onDelete(); onMenuToggle(false) } }, danger: true },
              ].map(item => (
                <button key={item.label} onClick={item.action}
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '8px 14px', fontSize: 13, color: item.danger ? '#E30513' : '#222222', cursor: 'pointer' }}>
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span style={{ fontSize: 11, color: '#AAAAAA' }}>{projet.dateVisite ?? '—'}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <span style={{ fontSize: 11, background: '#F9F9F9', color: '#697280', padding: '2px 8px', borderRadius: 8 }}>{totalObs} obs.</span>
          {urgentes > 0 && (
            <span style={{ fontSize: 11, background: '#FFF0F0', color: '#E30513', padding: '2px 8px', borderRadius: 8, fontWeight: 700 }}>{urgentes} urgentes</span>
          )}
        </div>
      </div>

      {projet.statut === 'archive' && (
        <span style={{ fontSize: 10, background: '#F9F9F9', color: '#AAAAAA', padding: '2px 8px', borderRadius: 8, marginTop: 6, display: 'inline-block' }}>Archivé</span>
      )}
    </div>
  )
}
