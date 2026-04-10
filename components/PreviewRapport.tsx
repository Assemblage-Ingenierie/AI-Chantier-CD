'use client'
import { useState } from 'react'
import type { Projet, Urgence, Suivi } from '@/lib/types'
import { IASug } from './IASug'

const URGENCE: Record<Urgence, { bg: string; text: string; dot: string; border: string; label: string; hex: string }> = {
  haute: { bg: '#FFF0F0', text: '#B91C1C', dot: '#E30513', border: '#FCA5A5', label: 'Urgent', hex: '#E30513' },
  moyenne: { bg: '#FFFBEB', text: '#92400E', dot: '#D97706', border: '#FCD34D', label: 'À planifier', hex: '#D97706' },
  basse: { bg: '#F0FDF4', text: '#15803D', dot: '#16A34A', border: '#86EFAC', label: 'Mineur', hex: '#16A34A' },
}

const SUIVI_MAP: Record<Suivi, { label: string; bg: string; text: string; dot: string; border: string }> = {
  rien: { label: '—', bg: '#F3F4F6', text: '#6B7280', dot: '#9CA3AF', border: '#E5E7EB' },
  a_faire: { label: 'À faire', bg: '#FFF7ED', text: '#C2410C', dot: '#F97316', border: '#FED7AA' },
  en_cours: { label: 'En cours', bg: '#EFF6FF', text: '#1D4ED8', dot: '#3B82F6', border: '#BFDBFE' },
  prochaine: { label: 'Prochaine visite', bg: '#FDF4FF', text: '#7E22CE', dot: '#A855F7', border: '#E9D5FF' },
  fait: { label: 'Fait', bg: '#F0FDF4', text: '#15803D', dot: '#22C55E', border: '#BBF7D0' },
}

interface EditTarget {
  lId: number
  sId?: number
  iId: number
  field: 'titre' | 'commentaire'
}

interface PreviewRapportProps {
  projet: Projet
  onUpdateItem: (lId: number, sId: number | undefined, iId: number, updates: Partial<{ titre: string; commentaire: string }>) => void
  onClose: () => void
}

async function exportPdf(projet: Projet) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jspdf = (window as any).jspdf
  if (!jspdf) {
    alert('jsPDF non disponible. Rechargez la page.')
    return
  }
  const { jsPDF } = jspdf
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210, H = 297
  const ML = 18, MR = 18, CW = W - ML - MR

  // Colors
  const BK: [number, number, number] = [34, 34, 34]
  const RD: [number, number, number] = [227, 5, 19]
  const LRD: [number, number, number] = [255, 240, 240]
  const GR: [number, number, number] = [105, 114, 125]
  const LG: [number, number, number] = [249, 249, 249]
  const WH: [number, number, number] = [255, 255, 255]
  const AM: [number, number, number] = [217, 119, 6]
  const GN: [number, number, number] = [22, 163, 74]

  const totalPages = () => (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages()

  function addFooter(pageNum: number) {
    doc.setFillColor(...LG)
    doc.rect(0, H - 10, W, 10, 'F')
    doc.setFontSize(7)
    doc.setTextColor(...GR)
    doc.text('aichantier.app', ML, H - 3.5)
    doc.text(`Page ${pageNum}`, W - MR, H - 3.5, { align: 'right' })
  }

  function urgenceColor(u: Urgence | undefined): [number, number, number] {
    if (u === 'haute') return RD
    if (u === 'moyenne') return AM
    return GN
  }

  // ─── Page 1: Couverture ───────────────────────────────────────
  doc.setFillColor(...BK)
  doc.rect(0, 0, W, H * 0.52, 'F')

  // Project photo background
  if (projet.photo) {
    const ext = projet.photo.startsWith('data:image/png') ? 'PNG' : 'JPEG'
    doc.addImage(projet.photo, ext, 0, 0, W, H * 0.52, undefined, 'FAST')
    // Overlay
    doc.setFillColor(0, 0, 0)
    doc.setGState(new (doc as unknown as { GState: new (o: object) => object }).GState({ opacity: 0.55 }))
    doc.rect(0, 0, W, H * 0.52, 'F')
    doc.setGState(new (doc as unknown as { GState: new (o: object) => object }).GState({ opacity: 1 }))
  }

  // Red accent bar
  doc.setFillColor(...RD)
  doc.rect(0, 0, 4, H * 0.52, 'F')

  // Logo box top-right
  doc.setFillColor(...WH)
  doc.roundedRect(W - 44, 10, 34, 14, 2, 2, 'F')
  doc.setFontSize(9)
  doc.setTextColor(...BK)
  doc.setFont('helvetica', 'bold')
  doc.text('Assembl', W - 44 + 4, 18.5)
  doc.setTextColor(...RD)
  doc.text('!', W - 44 + 4 + doc.getTextWidth('Assembl'), 18.5)
  doc.setTextColor(...BK)
  doc.text('age', W - 44 + 4 + doc.getTextWidth('Assembl!'), 18.5)

  // Project title
  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...WH)
  const nomLines = doc.splitTextToSize(projet.nom, CW - 8) as string[]
  doc.text(nomLines, ML, H * 0.52 - 28)

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(200, 200, 200)
  if (projet.maitreOuvrage) doc.text(`MO : ${projet.maitreOuvrage}`, ML, H * 0.52 - 18)
  if (projet.adresse) doc.text(projet.adresse, ML, H * 0.52 - 12)

  const dateStr = projet.dateVisite
    ? new Date(projet.dateVisite).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })
  doc.text(dateStr, ML, H * 0.52 - 6)

  // Stats box
  const locs = projet.localisations ?? []
  const allItems = locs.flatMap(l => [
    ...(l.items ?? []),
    ...(l.sections ?? []).flatMap(s => s.items ?? []),
  ])
  const urgentCount = allItems.filter(i => i.urgence === 'haute').length

  doc.setFillColor(...LG)
  doc.roundedRect(ML, H * 0.52 + 10, CW, 28, 4, 4, 'F')

  const stats = [
    { label: 'Observations', val: String(allItems.length) },
    { label: 'Urgentes', val: String(urgentCount) },
    { label: 'Zones', val: String(locs.length) },
  ]
  const statW = CW / 3
  stats.forEach((s, i) => {
    const x = ML + i * statW + statW / 2
    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...BK)
    doc.text(s.val, x, H * 0.52 + 22, { align: 'center' })
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...GR)
    doc.text(s.label, x, H * 0.52 + 30, { align: 'center' })
  })

  addFooter(1)

  // ─── Page 2: Participants ─────────────────────────────────────
  const participants = projet.participants ?? []
  if (participants.length > 0) {
    doc.addPage()
    let y = 20

    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...BK)
    doc.text('Participants', ML, y)
    y += 10

    doc.setFillColor(...RD)
    doc.rect(ML, y - 1, 4, 0.5, 'F')
    y += 6

    participants.forEach(p => {
      doc.setFillColor(...LG)
      doc.roundedRect(ML, y, CW, 14, 2, 2, 'F')

      // Presence circle
      const pres = p.presence !== 'absent'
      doc.setFillColor(pres ? 34 : 200, pres ? 197 : 50, pres ? 94 : 50)
      doc.circle(ML + 7, y + 7, 3, 'F')

      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...BK)
      doc.text(p.nom, ML + 14, y + 6)

      if (p.role) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(...GR)
        doc.text(p.role, ML + 14, y + 11)
      }

      doc.setFontSize(8)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(pres ? 22 : 180, pres ? 163 : 50, pres ? 74 : 50)
      doc.text(pres ? 'Présent' : 'Absent', W - MR, y + 7, { align: 'right' })

      y += 17
      if (y > H - 20) { doc.addPage(); y = 20 }
    })

    addFooter(doc.internal.getCurrentPageInfo().pageNumber)
  }

  // ─── Pages: Observations ─────────────────────────────────────
  let itemNum = 0
  for (const loc of locs) {
    doc.addPage()
    let y = 20

    // Loc header
    doc.setFillColor(...BK)
    doc.rect(0, y - 6, W, 14, 'F')
    doc.setFillColor(...RD)
    doc.rect(0, y - 6, 4, 14, 'F')
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...WH)
    doc.text(loc.nom.toUpperCase(), ML, y + 2)
    y += 16

    // Items directly on loc
    const directItems = loc.items ?? []
    // Items from sections
    const allLocItems = [
      ...directItems.map(i => ({ item: i, sectionNom: undefined as string | undefined })),
      ...(loc.sections ?? []).flatMap(s => (s.items ?? []).map(i => ({ item: i, sectionNom: s.nom }))),
    ]

    for (const { item, sectionNom } of allLocItems) {
      itemNum++
      if (y > H - 45) { doc.addPage(); y = 20; addFooter(doc.internal.getCurrentPageInfo().pageNumber) }

      // Item background
      doc.setFillColor(...LG)
      const photos = item.photos ?? (item.photo ? [item.photo] : [])
      const photoH = photos.length > 0 ? Math.min(photos.length, 3) * 35 + 10 : 0
      const itemH = 28 + (item.commentaire ? 8 : 0) + photoH

      doc.roundedRect(ML, y, CW, itemH, 3, 3, 'F')

      // Urgence circle
      const uc = urgenceColor(item.urgence ?? 'basse')
      doc.setFillColor(...uc)
      doc.circle(ML + 6, y + 6, 4, 'F')
      doc.setFontSize(7)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...WH)
      doc.text(String(itemNum), ML + 6, y + 6.5, { align: 'center' })

      // Section label
      if (sectionNom) {
        doc.setFontSize(7)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...GR)
        doc.text(sectionNom.toUpperCase(), ML + 14, y + 5)
      }

      // Title
      doc.setFontSize(8.5)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...BK)
      const titleLines = doc.splitTextToSize(item.titre, CW - 55) as string[]
      doc.text(titleLines, ML + 14, y + (sectionNom ? 11 : 7))

      // Urgence label right
      doc.setFontSize(7)
      doc.setTextColor(...uc)
      doc.text(URGENCE[item.urgence ?? 'basse'].label, W - MR, y + 7, { align: 'right' })

      // Suivi badge
      if (item.suivi && item.suivi !== 'rien') {
        const sv = SUIVI_MAP[item.suivi]
        doc.setFontSize(7)
        doc.setTextColor(parseInt(sv.dot.slice(1, 3), 16), parseInt(sv.dot.slice(3, 5), 16), parseInt(sv.dot.slice(5, 7), 16))
        doc.text(`• ${sv.label}`, W - MR, y + 13, { align: 'right' })
      }

      let iy = y + 18
      // Commentaire
      if (item.commentaire) {
        doc.setFontSize(8)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(30, 58, 138)
        const comLines = doc.splitTextToSize(item.commentaire, CW - 20) as string[]
        doc.text(comLines, ML + 6, iy)
        iy += comLines.length * 4.5
      }

      // Photos
      if (photos.length > 0) {
        const photosParLigne = projet.photosParLigne ?? 2
        const pw = (CW - (photosParLigne - 1) * 3) / photosParLigne
        const ph = pw * (2 / 3)
        let px = ML + 6, py2 = iy + 4
        photos.slice(0, 6).forEach((p, idx) => {
          if (idx > 0 && idx % photosParLigne === 0) { px = ML + 6; py2 += ph + 3 }
          try {
            const ext2 = p.startsWith('data:image/png') ? 'PNG' : 'JPEG'
            doc.addImage(p, ext2, px, py2, pw, ph, undefined, 'FAST')
          } catch { /* skip bad image */ }
          px += pw + 3
        })
      }

      y += itemH + 4
    }

    addFooter(doc.internal.getCurrentPageInfo().pageNumber)
  }

  // ─── Tableau récap ────────────────────────────────────────────
  const tableau = projet.tableauRecap ?? []
  if (tableau.length > 0) {
    doc.addPage()
    let y = 20

    doc.setFillColor(...BK)
    doc.rect(0, y - 6, W, 14, 'F')
    doc.setFillColor(...RD)
    doc.rect(0, y - 6, 4, 14, 'F')
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...WH)
    doc.text('TABLEAU RÉCAPITULATIF', ML, y + 2)
    y += 16

    // Table header
    const COL = { niv: 6, des: CW * 0.35, tra: CW * 0.35, sui: CW * 0.22 }
    doc.setFillColor(...BK)
    doc.rect(ML, y, CW, 8, 'F')
    doc.setFontSize(7)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...WH)
    let cx = ML + COL.niv + 2
    doc.text('DÉSORDRE', cx, y + 5)
    cx += COL.des + 2
    doc.text('TRAVAUX PRÉCONISÉS', cx, y + 5)
    cx += COL.tra + 2
    doc.text('SUIVI', cx, y + 5)
    y += 10

    tableau.forEach((row, idx) => {
      if (y > H - 20) { doc.addPage(); y = 20 }
      const rowH = 12
      const rowBg: [number, number, number] = idx % 2 === 0 ? [255, 255, 255] : LG
      doc.setFillColor(...rowBg)
      doc.rect(ML, y, CW, rowH, 'F')

      // Urgence color bar
      doc.setFillColor(...urgenceColor(row.urgence))
      doc.rect(ML, y, COL.niv, rowH, 'F')

      doc.setFontSize(7.5)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...BK)

      cx = ML + COL.niv + 2
      const desLines = doc.splitTextToSize(row.desordre, COL.des - 4) as string[]
      doc.text(desLines[0] ?? '', cx, y + 4.5)
      cx += COL.des + 2
      const traLines = doc.splitTextToSize(row.travaux, COL.tra - 4) as string[]
      doc.text(traLines[0] ?? '', cx, y + 4.5)
      cx += COL.tra + 2
      if (row.suivi && row.suivi !== 'rien') {
        const sv = SUIVI_MAP[row.suivi]
        doc.setTextColor(parseInt(sv.dot.slice(1, 3), 16), parseInt(sv.dot.slice(3, 5), 16), parseInt(sv.dot.slice(5, 7), 16))
        doc.text(sv.label, cx, y + 4.5)
      }

      y += rowH
    })

    addFooter(doc.internal.getCurrentPageInfo().pageNumber)
  }

  // ─── Update page numbers ──────────────────────────────────────
  const np = totalPages()
  for (let i = 1; i <= np; i++) {
    doc.setPage(i)
    // Re-draw footer with total
    doc.setFillColor(...LG)
    doc.rect(0, H - 10, W, 10, 'F')
    doc.setFontSize(7)
    doc.setTextColor(...GR)
    doc.text('aichantier.app', ML, H - 3.5)
    doc.text(`Page ${i} / ${np}`, W - MR, H - 3.5, { align: 'right' })
  }

  // ─── Download ─────────────────────────────────────────────────
  const blob = doc.output('blob')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `CR_${projet.nom.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

export function PreviewRapport({ projet, onUpdateItem, onClose }: PreviewRapportProps) {
  const [editIt, setEditIt] = useState<EditTarget | null>(null)
  const [editV, setEditV] = useState('')
  const [exporting, setExporting] = useState(false)

  const locs = projet.localisations ?? []
  const allItems = locs.flatMap(l => [
    ...(l.items ?? []),
    ...(l.sections ?? []).flatMap(s => s.items ?? []),
  ])
  const urgentCount = allItems.filter(i => i.urgence === 'haute').length

  function startEdit(lId: number, sId: number | undefined, iId: number, field: 'titre' | 'commentaire', val: string) {
    setEditIt({ lId, sId, iId, field })
    setEditV(val)
  }

  function commitEdit() {
    if (!editIt) return
    onUpdateItem(editIt.lId, editIt.sId, editIt.iId, { [editIt.field]: editV })
    setEditIt(null)
  }

  async function handleExport() {
    setExporting(true)
    try { await exportPdf(projet) } catch (e) { console.error(e) }
    setExporting(false)
  }

  let itemNum = 0

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'white', zIndex: 50, display: 'flex', flexDirection: 'column', fontFamily: "'Inter',system-ui,sans-serif" }}>
      {/* Header */}
      <div style={{ background: '#222222', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={onClose}
          style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.15)', color: 'white', cursor: 'pointer', fontSize: 14 }}
        >←</button>
        <span style={{ fontWeight: 700, fontSize: 15, color: 'white', flex: 1 }}>Rapport</span>
        <button
          onClick={handleExport}
          disabled={exporting}
          style={{
            padding: '7px 14px', borderRadius: 8, border: 'none',
            background: exporting ? '#555' : '#E30513', color: 'white',
            fontSize: 12, fontWeight: 700, cursor: exporting ? 'default' : 'pointer',
          }}
        >
          {exporting ? 'Export…' : '⬇ Exporter PDF'}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', background: '#F7F7F7', padding: '20px 0' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px' }}>

          {/* Cover card */}
          <div style={{
            borderRadius: 14, overflow: 'hidden', marginBottom: 20,
            background: 'linear-gradient(135deg,#1a1a1a,#333)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          }}>
            {projet.photo && (
              <div style={{ position: 'relative', height: 160 }}>
                <img src={projet.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.55 }} />
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)' }} />
                <div style={{ position: 'absolute', top: 10, right: 10, background: 'white', borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 800 }}>
                  Assembl<span style={{ color: '#E30513' }}>!</span>age
                </div>
              </div>
            )}
            <div style={{ padding: 16, borderTop: '3px solid #E30513' }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'white' }}>{projet.nom}</h2>
              {projet.maitreOuvrage && <p style={{ margin: '4px 0 0', fontSize: 12, color: '#9CA3AF' }}>MO : {projet.maitreOuvrage}</p>}
              {projet.adresse && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#9CA3AF' }}>{projet.adresse}</p>}
            </div>
            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              {[
                { val: allItems.length, label: 'Observations' },
                { val: urgentCount, label: 'Urgentes' },
                { val: locs.length, label: 'Zones' },
              ].map((s, i) => (
                <div key={i} style={{ padding: '12px 0', textAlign: 'center', borderRight: i < 2 ? '1px solid rgba(255,255,255,0.1)' : undefined }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: i === 1 && s.val > 0 ? '#E30513' : 'white' }}>{s.val}</div>
                  <div style={{ fontSize: 10, color: '#9CA3AF' }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Localisations */}
          {locs.map(loc => {
            const allLocItems = [
              ...(loc.items ?? []).map(i => ({ item: i, sId: undefined as number | undefined, sectionNom: undefined as string | undefined })),
              ...(loc.sections ?? []).flatMap(s => (s.items ?? []).map(i => ({ item: i, sId: s.id, sectionNom: s.nom }))),
            ]
            if (allLocItems.length === 0) return null

            return (
              <div key={loc.id} style={{ marginBottom: 20, background: 'white', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
                {/* Loc header */}
                <div style={{ padding: '10px 16px', background: '#222222', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 4, height: 18, borderRadius: 2, background: '#E30513' }} />
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'white' }}>{loc.nom}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9CA3AF' }}>{allLocItems.length} obs.</span>
                </div>

                {/* Items */}
                {allLocItems.map(({ item, sId, sectionNom }) => {
                  itemNum++
                  const photos = item.photos ?? (item.photo ? [item.photo] : [])
                  const isEditingTitle = editIt?.iId === item.id && editIt.field === 'titre'
                  const isEditingCom = editIt?.iId === item.id && editIt.field === 'commentaire'
                  const urg = URGENCE[item.urgence ?? 'basse']

                  return (
                    <div key={item.id} style={{ padding: '12px 16px', borderTop: '1px solid #F5F5F5' }}>
                      {sectionNom && (
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                          {sectionNom}
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        {/* Number circle */}
                        <div style={{ width: 24, height: 24, borderRadius: '50%', background: urg.dot, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                          {itemNum}
                        </div>
                        <div style={{ flex: 1 }}>
                          {/* Title */}
                          {isEditingTitle ? (
                            <input
                              autoFocus
                              value={editV}
                              onChange={e => setEditV(e.target.value)}
                              onBlur={commitEdit}
                              onKeyDown={e => e.key === 'Enter' && commitEdit()}
                              style={{ width: '100%', fontWeight: 700, fontSize: 13, border: 'none', borderBottom: '2px solid #E30513', outline: 'none', padding: '0 0 2px', background: 'transparent' }}
                            />
                          ) : (
                            <p
                              onClick={() => startEdit(loc.id, sId, item.id, 'titre', item.titre)}
                              style={{ margin: 0, fontWeight: 700, fontSize: 13, cursor: 'text', color: '#222222' }}
                            >{item.titre}</p>
                          )}

                          {/* Badges */}
                          <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: urg.bg, color: urg.text, border: `1px solid ${urg.border}` }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: urg.dot }} />
                              {urg.label}
                            </span>
                            {item.suivi && item.suivi !== 'rien' && (() => {
                              const sv = SUIVI_MAP[item.suivi]
                              return (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: sv.bg, color: sv.text, border: `1px solid ${sv.border}` }}>
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: sv.dot }} />
                                  {sv.label}
                                </span>
                              )
                            })()}
                          </div>

                          {/* Commentaire */}
                          {isEditingCom ? (
                            <textarea
                              autoFocus
                              value={editV}
                              onChange={e => setEditV(e.target.value)}
                              onBlur={commitEdit}
                              style={{ width: '100%', marginTop: 8, fontSize: 12, border: 'none', borderBottom: '2px solid #E30513', outline: 'none', resize: 'none', background: 'transparent', color: '#1E3A8A', lineHeight: 1.5, minHeight: 48 }}
                            />
                          ) : (
                            item.commentaire && (
                              <p
                                onClick={() => startEdit(loc.id, sId, item.id, 'commentaire', item.commentaire ?? '')}
                                style={{ margin: '8px 0 0', fontSize: 12, color: '#1E3A8A', lineHeight: 1.5, cursor: 'text' }}
                              >{item.commentaire}</p>
                            )
                          )}

                          {/* Add commentaire if missing */}
                          {!item.commentaire && !isEditingCom && (
                            <button
                              onClick={() => startEdit(loc.id, sId, item.id, 'commentaire', '')}
                              style={{ marginTop: 6, fontSize: 11, color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                            >+ Ajouter un commentaire</button>
                          )}

                          {/* Photos */}
                          {photos.length > 0 && (
                            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(photos.length, projet.photosParLigne ?? 2)}, 1fr)`, gap: 6, marginTop: 10 }}>
                              {photos.map((p, i) => (
                                <img key={i} src={p} alt="" style={{ width: '100%', aspectRatio: '3/2', objectFit: 'cover', borderRadius: 6 }} />
                              ))}
                            </div>
                          )}

                          {/* AI suggestion */}
                          <IASug
                            content={`${item.titre}${item.commentaire ? '\n' + item.commentaire : ''}`}
                            onApply={(text) => onUpdateItem(loc.id, sId, item.id, { commentaire: text })}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
