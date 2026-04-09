'use client'

import type { Projet } from './types'

const STORAGE_KEY = 'chantierai_v11'

// ---- Clés blobs ----
export const blobKey = {
  planLibBg: (pId: number, libId: number) => `plb_${pId}_${libId}`,
  planLibData: (pId: number, libId: number) => `pld_${pId}_${libId}`,
  locBg: (pId: number, locId: number) => `pb_${pId}_${locId}`,
  locData: (pId: number, locId: number) => `pd_${pId}_${locId}`,
}

// ---- LocalStorage helpers ----
function lsGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch {}
}

// ---- Sépare les blobs des données slim ----
function extractBlobs(projets: Projet[]): { slim: Projet[]; blobs: Record<string, string> } {
  const blobs: Record<string, string> = {}
  const slim = projets.map(p => {
    const proj = { ...p }
    if (proj.planLibrary) {
      proj.planLibrary = proj.planLibrary.map(pl => {
        if (pl.bg) { blobs[blobKey.planLibBg(p.id, pl.id)] = pl.bg }
        if (pl.data) { blobs[blobKey.planLibData(p.id, pl.id)] = pl.data }
        return { ...pl, bg: pl.bg ? '__img__' : '', data: pl.data ? '__pdf__' : '' }
      })
    }
    if (proj.localisations) {
      proj.localisations = proj.localisations.map(loc => {
        if (loc.planBg) { blobs[blobKey.locBg(p.id, loc.id)] = loc.planBg }
        if (loc.planData) { blobs[blobKey.locData(p.id, loc.id)] = loc.planData }
        return { ...loc, planBg: loc.planBg ? '__img__' : undefined, planData: loc.planData ? '__pdf__' : undefined }
      })
    }
    return proj
  })
  return { slim, blobs }
}

function rehydrateBlobs(slim: Projet[], blobs: Record<string, string>): Projet[] {
  return slim.map(p => {
    const proj = { ...p }
    if (proj.planLibrary) {
      proj.planLibrary = proj.planLibrary.map(pl => ({
        ...pl,
        bg: blobs[blobKey.planLibBg(p.id, pl.id)] ?? '',
        data: blobs[blobKey.planLibData(p.id, pl.id)] ?? '',
      }))
    }
    if (proj.localisations) {
      proj.localisations = proj.localisations.map(loc => ({
        ...loc,
        planBg: blobs[blobKey.locBg(p.id, loc.id)] ?? undefined,
        planData: blobs[blobKey.locData(p.id, loc.id)] ?? undefined,
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
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && (k.startsWith('plb_') || k.startsWith('pld_') || k.startsWith('pb_') || k.startsWith('pd_'))) {
        blobs[k] = localStorage.getItem(k) ?? ''
      }
    }
    return rehydrateBlobs(slim, blobs)
  } catch { return null }
}
