'use client'
import { URGENCE_CONFIG, SUIVI_CONFIG, type Urgence, type Suivi } from '@/lib/types'

const URGENCE_CYCLE: Urgence[] = ['haute', 'moyenne', 'basse']
const SUIVI_CYCLE: Suivi[] = ['rien', 'a_faire', 'en_cours', 'prochaine', 'fait']

export function UrgenceBadge({ value, onClick, small }: { value: Urgence; onClick?: () => void; small?: boolean }) {
  const cfg = URGENCE_CONFIG[value]
  return (
    <span
      onClick={onClick}
      style={{ background: cfg.bg, color: cfg.text, borderColor: cfg.border }}
      className={`inline-flex items-center gap-1 rounded-full border font-medium ${small ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'} ${onClick ? 'cursor-pointer select-none' : ''}`}
    >
      <span style={{ background: cfg.dot }} className="w-1.5 h-1.5 rounded-full" />
      {cfg.label}
    </span>
  )
}

export function SuiviBadge({ value, onClick, small }: { value: Suivi; onClick?: () => void; small?: boolean }) {
  const cfg = SUIVI_CONFIG[value]
  return (
    <span
      onClick={onClick}
      style={{ background: cfg.bg, color: cfg.text, borderColor: cfg.border }}
      className={`inline-flex items-center rounded-full border font-medium ${small ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'} ${onClick ? 'cursor-pointer select-none' : ''}`}
    >
      {cfg.label}
    </span>
  )
}

export function cycleUrgence(current: Urgence): Urgence {
  const idx = URGENCE_CYCLE.indexOf(current)
  return URGENCE_CYCLE[(idx + 1) % URGENCE_CYCLE.length]
}

export function cycleSuivi(current: Suivi): Suivi {
  const idx = SUIVI_CYCLE.indexOf(current)
  return SUIVI_CYCLE[(idx + 1) % SUIVI_CYCLE.length]
}
