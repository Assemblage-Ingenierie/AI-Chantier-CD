'use client'

import type { Projet, Item } from './types'

const STORAGE_KEY = 'chantierai_v11'

// ---- Préfixes blob ----
// Plans bibliothèque
const PFX_PLB  = 'plb_'   // planLibrary[].bg
const PFX_PLD  = 'pld_'   // planLibrary[].data
// Plans localisations
const PFX_PB   = 'pb_'    // loc.planBg
const PFX_PD   = 'pd_'    // loc.planData
// Photos projet + items  (clé = identifiant unique de l'objet)
const PFX_PPH  = 'pph_'   // projet.photo         → pph_{pId}
const PFX_IPH  = 'iph_'   // item.photo (legacy)   → iph_{itemId}
const PFX_IPHS = 'iphs_'  // item.photos[i]        → iphs_{itemId}_{i}

// ---- LocalStorage helpers ----
function lsGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch (e) {
    console.warn('[storage] setItem failed:', key, e)
  }
}

// ---- Helpers item ----
function extractItemBlobs(item: Item, blobs: Record<string, string>): Item {
  const slim = { ...item }
  if (slim.photo && slim.photo.startsWith('data:')) {
    blobs[`${PFX_IPH}${item.id}`] = slim.photo
    slim.photo = '__img__'
  }
  if (slim.photos?.length) {
    slim.photos = slim.photos.map((p, i) => {
      if (p.startsWith('data:')) {
        blobs[`${PFX_IPHS}${item.id}_${i}`] = p
        return '__img__'
      }
      return p
    })
  }
  return slim
}

function rehydrateItem(item: Item, blobs: Record<string, string>): Item {
  const full = { ...item }
  if (full.photo === '__img__') full.photo = blobs[`${PFX_IPH}${item.id}`] ?? ''
  if (full.photos?.length) {
    full.photos = full.photos.map((p, i) =>
      p === '__img__' ? (blobs[`${PFX_IPHS}${item.id}_${i}`] ?? '') : p
    )
  }
  return full
}

// ---- Extraction complète ----
function extractBlobs(projets: Projet[]): { slim: Projet[]; blobs: Record<string, string> } {
  const blobs: Record<string, string> = {}
  const slim = projets.map(p => {
    const proj = { ...p }

    // Photo principale du projet
    if (proj.photo && proj.photo.startsWith('data:')) {
      blobs[`${PFX_PPH}${p.id}`] = proj.photo
      proj.photo = '__img__'
    }

    // Bibliothèque de plans
    if (proj.planLibrary) {
      proj.planLibrary = proj.planLibrary.map(pl => {
        if (pl.bg)   blobs[`${PFX_PLB}${p.id}_${pl.id}`] = pl.bg
        if (pl.data) blobs[`${PFX_PLD}${p.id}_${pl.id}`] = pl.data
        return { ...pl, bg: pl.bg ? '__img__' : '', data: pl.data ? '__pdf__' : '' }
      })
    }

    // Localisations : plan + items + sections
    if (proj.localisations) {
      proj.localisations = proj.localisations.map(loc => {
        const l = { ...loc }
        if (l.planBg)   { blobs[`${PFX_PB}${p.id}_${loc.id}`] = l.planBg;   l.planBg   = '__img__' }
        if (l.planData) { blobs[`${PFX_PD}${p.id}_${loc.id}`] = l.planData; l.planData = '__pdf__' }
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

// ---- Réhydratation complète ----
function rehydrateBlobs(slim: Projet[], blobs: Record<string, string>): Projet[] {
  return slim.map(p => {
    const proj = { ...p }

    if (proj.photo === '__img__') proj.photo = blobs[`${PFX_PPH}${p.id}`] ?? ''

    if (proj.planLibrary) {
      proj.planLibrary = proj.planLibrary.map(pl => ({
        ...pl,
        bg:   blobs[`${PFX_PLB}${p.id}_${pl.id}`] ?? '',
        data: blobs[`${PFX_PLD}${p.id}_${pl.id}`] ?? '',
      }))
    }

    if (proj.localisations) {
      proj.localisations = proj.localisations.map(loc => ({
        ...loc,
        planBg:   blobs[`${PFX_PB}${p.id}_${loc.id}`] ?? undefined,
        planData: blobs[`${PFX_PD}${p.id}_${loc.id}`] ?? undefined,
        items:    (loc.items ?? []).map(i => rehydrateItem(i, blobs)),
        sections: (loc.sections ?? []).map(s => ({
          ...s, items: (s.items ?? []).map(i => rehydrateItem(i, blobs))
        })),
      }))
    }

    return proj
  })
}

// ---- Save local ----
export function saveLocal(projets: Projet[]): void {
  const { slim, blobs } = extractBlobs(projets)
  lsSet(STORAGE_KEY, JSON.stringify(slim))
  for (const [k, v] of Object.entries(blobs)) lsSet(k, v)
}

// ---- Load local ----
export function loadLocal(): Projet[] | null {
  const raw = lsGet(STORAGE_KEY)
  if (!raw) return null
  try {
    const slim: Projet[] = JSON.parse(raw)
    const blobs: Record<string, string> = {}
    const prefixes = [PFX_PLB, PFX_PLD, PFX_PB, PFX_PD, PFX_PPH, PFX_IPH, PFX_IPHS]
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && prefixes.some(pfx => k.startsWith(pfx))) {
        blobs[k] = localStorage.getItem(k) ?? ''
      }
    }
    return rehydrateBlobs(slim, blobs)
  } catch { return null }
}
