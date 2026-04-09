// ============================================================
// Types ChantierAI — Assemblage Ingénierie
// ============================================================

export type Urgence = 'haute' | 'moyenne' | 'basse'
export type Suivi = 'rien' | 'a_faire' | 'en_cours' | 'prochaine' | 'fait'
export type StatutProjet = 'actif' | 'archive'

export interface Participant {
  id: number
  nom: string
  role?: string
  tel?: string
  email?: string
  presence?: 'present' | 'absent'
}

export interface Item {
  id: number
  titre: string
  commentaire?: string
  urgence?: Urgence
  suivi?: Suivi
  photo?: string
  photos?: string[]
  planBg?: string
  planAnnotations?: object
}

export interface Section {
  id: number
  nom: string
  items?: Item[]
}

export interface Localisation {
  id: number
  nom: string
  planBg?: string
  planData?: string
  planAnnotations?: object
  items?: Item[]
  sections?: Section[]
}

export interface PlanLib {
  id: number
  nom?: string
  bg: string
  data: string
}

export interface TableauRow {
  id: number
  urgence: Urgence
  locNom: string
  desordre: string
  travaux: string
  suivi?: Suivi
}

export interface Projet {
  id: number
  nom: string
  adresse?: string
  maitreOuvrage?: string
  dateVisite?: string
  photo?: string
  photosParLigne?: 1 | 2 | 3
  statut?: StatutProjet
  participants?: Participant[]
  localisations?: Localisation[]
  planLibrary?: PlanLib[]
  tableauRecap?: TableauRow[]
}

export interface UserProfile {
  id: string
  name?: string
  email?: string
  is_approved: boolean
}

// ============================================================
// Constantes charte graphique
// ============================================================

export const COLORS = {
  red: '#E30513',
  redDark: '#B8040F',
  redLight: '#FFF0F0',
  black: '#222222',
  gray: '#697280',
  grayL: '#AAAAAA',
  grayXL: '#F9F9F9',
  border: '#E8E8E8',
  white: '#FFFFFF',
} as const

export const URGENCE_CONFIG: Record<Urgence, { bg: string; text: string; dot: string; border: string; label: string }> = {
  haute: { bg: '#FFF0F0', text: '#B91C1C', dot: '#E30513', border: '#FCA5A5', label: 'Urgent' },
  moyenne: { bg: '#FFFBEB', text: '#92400E', dot: '#D97706', border: '#FCD34D', label: 'À planifier' },
  basse: { bg: '#F0FDF4', text: '#15803D', dot: '#16A34A', border: '#86EFAC', label: 'Mineur' },
}

export const SUIVI_CONFIG: Record<Suivi, { label: string; bg: string; text: string; border: string }> = {
  rien: { label: '—', bg: '#F3F4F6', text: '#6B7280', border: '#E5E7EB' },
  a_faire: { label: 'À faire', bg: '#FFF7ED', text: '#C2410C', border: '#FDBA74' },
  en_cours: { label: 'En cours', bg: '#EFF6FF', text: '#1D4ED8', border: '#93C5FD' },
  prochaine: { label: 'Prochaine visite', bg: '#FDF4FF', text: '#7E22CE', border: '#D8B4FE' },
  fait: { label: 'Fait', bg: '#F0FDF4', text: '#15803D', border: '#86EFAC' },
}

export const SYMBOLS = [
  { id: 'fissure_plafond', label: 'Fissure plafond', short: '↑PL' },
  { id: 'fissure_mur', label: 'Fissure mur', short: 'MUR' },
  { id: 'humidite', label: 'Humidité', short: '~H~' },
  { id: 'decollement', label: 'Décollement', short: 'DÉC' },
  { id: 'eclat_beton', label: 'Éclat béton', short: 'ÉCL' },
  { id: 'corrosion', label: 'Corrosion', short: 'COR' },
  { id: 'deformation', label: 'Déformation', short: 'DEF' },
  { id: 'autre', label: 'Autre', short: '···' },
]

export const ANNOT_COLORS = ['#E30513', '#E67E22', '#F1C40F', '#2980B9', '#27AE60', '#8E44AD', '#222222', '#FFFFFF']
