'use client'
import { useRef, useState, useEffect, useCallback } from 'react'
import { ANNOT_COLORS, SYMBOLS } from '@/lib/types'

type Tool = 'pen' | 'eraser' | 'text' | 'symbol'

interface Stroke {
  type: 'stroke'
  points: { x: number; y: number }[]
  color: string
  size: number
  eraser: boolean
}
interface TextMark {
  type: 'text'
  x: number
  y: number
  value: string
  color: string
  size: number
}
interface SymbolMark {
  type: 'symbol'
  x: number
  y: number
  symId: string
  color: string
  size: number
}
type PathItem = Stroke | TextMark | SymbolMark

interface AnnotationEditorProps {
  bgImage: string
  savedPaths?: PathItem[]
  onSave: (paths: PathItem[], exported: string) => void
  onClose: () => void
}

const SIZES = [3, 6, 10]

function drawSymbol(ctx: CanvasRenderingContext2D, symId: string, x: number, y: number, size: number, color: string) {
  ctx.save()
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.font = `bold ${size + 8}px monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const sym = SYMBOLS.find(s => s.id === symId)
  const label = sym?.short ?? '?'
  // white outline
  ctx.strokeStyle = 'white'
  ctx.lineWidth = 3
  ctx.strokeText(label, x, y)
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.fillText(label, x, y)
  ctx.restore()
}

function redraw(ctx: CanvasRenderingContext2D, paths: PathItem[], bgImg: HTMLImageElement | null, w: number, h: number) {
  ctx.clearRect(0, 0, w, h)
  if (bgImg) ctx.drawImage(bgImg, 0, 0, w, h)
  for (const p of paths) {
    if (p.type === 'stroke') {
      if (p.points.length < 2) continue
      ctx.save()
      if (p.eraser) {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.strokeStyle = 'rgba(0,0,0,1)'
        ctx.lineWidth = p.size * 6
      } else {
        ctx.globalCompositeOperation = 'source-over'
        ctx.strokeStyle = p.color
        ctx.lineWidth = p.size
      }
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(p.points[0].x, p.points[0].y)
      for (let i = 1; i < p.points.length; i++) ctx.lineTo(p.points[i].x, p.points[i].y)
      ctx.stroke()
      ctx.restore()
    } else if (p.type === 'text') {
      ctx.save()
      ctx.font = `bold ${p.size + 10}px Inter, system-ui, sans-serif`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.strokeStyle = 'white'
      ctx.lineWidth = 3
      ctx.strokeText(p.value, p.x, p.y)
      ctx.fillStyle = p.color
      ctx.fillText(p.value, p.x, p.y)
      ctx.restore()
    } else if (p.type === 'symbol') {
      drawSymbol(ctx, p.symId, p.x, p.y, p.size, p.color)
    }
  }
}

export function AnnotationEditor({ bgImage, savedPaths = [], onSave, onClose }: AnnotationEditorProps) {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState(ANNOT_COLORS[0])
  const [size, setSize] = useState(SIZES[0])
  const [symId, setSymId] = useState(SYMBOLS[0].id)
  const [showSyms, setShowSyms] = useState(false)
  const [paths, setPaths] = useState<PathItem[]>(savedPaths)
  const [drawing, setDrawing] = useState(false)
  const [cur, setCur] = useState<{ x: number; y: number }[]>([])
  const [textPt, setTextPt] = useState<{ x: number; y: number } | null>(null)
  const [textV, setTextV] = useState('')
  const bgImgRef = useRef<HTMLImageElement | null>(null)

  // Load background image
  useEffect(() => {
    if (!bgImage) return
    const img = new Image()
    img.onload = () => {
      bgImgRef.current = img
      const cv = cvRef.current
      if (!cv) return
      cv.width = img.naturalWidth
      cv.height = img.naturalHeight
      const ctx = cv.getContext('2d')!
      redraw(ctx, paths, img, cv.width, cv.height)
    }
    img.src = bgImage
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgImage])

  // Redraw on paths change
  useEffect(() => {
    const cv = cvRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    redraw(ctx, paths, bgImgRef.current, cv.width, cv.height)
  }, [paths])

  function getPos(e: React.MouseEvent | React.TouchEvent): { x: number; y: number } {
    const cv = cvRef.current!
    const rect = cv.getBoundingClientRect()
    const scaleX = cv.width / rect.width
    const scaleY = cv.height / rect.height
    if ('touches' in e) {
      const t = e.touches[0]
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY }
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  const onStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const pt = getPos(e)
    if (tool === 'text') {
      setTextPt(pt)
      setTextV('')
      return
    }
    if (tool === 'symbol') {
      const newMark: SymbolMark = { type: 'symbol', x: pt.x, y: pt.y, symId, color, size }
      setPaths(prev => [...prev, newMark])
      return
    }
    setDrawing(true)
    setCur([pt])
  }, [tool, symId, color, size])

  const onMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    if (!drawing) return
    const pt = getPos(e)
    const updated = [...cur, pt]
    setCur(updated)
    // Live preview
    const cv = cvRef.current!
    const ctx = cv.getContext('2d')!
    redraw(ctx, paths, bgImgRef.current, cv.width, cv.height)
    // Draw current stroke
    if (updated.length > 1) {
      ctx.save()
      if (tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.strokeStyle = 'rgba(0,0,0,1)'
        ctx.lineWidth = size * 6
      } else {
        ctx.strokeStyle = color
        ctx.lineWidth = size
      }
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(updated[0].x, updated[0].y)
      for (let i = 1; i < updated.length; i++) ctx.lineTo(updated[i].x, updated[i].y)
      ctx.stroke()
      ctx.restore()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing, cur, paths, tool, color, size])

  const onEnd = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    if (!drawing) return
    setDrawing(false)
    if (cur.length > 1) {
      const stroke: Stroke = { type: 'stroke', points: cur, color, size, eraser: tool === 'eraser' }
      setPaths(prev => [...prev, stroke])
    }
    setCur([])
  }, [drawing, cur, color, size, tool])

  function commitText() {
    if (!textPt || !textV.trim()) { setTextPt(null); return }
    const mark: TextMark = { type: 'text', x: textPt.x, y: textPt.y, value: textV, color, size }
    setPaths(prev => [...prev, mark])
    setTextPt(null)
    setTextV('')
  }

  function handleSave() {
    const cv = cvRef.current!
    const exported = cv.toDataURL('image/png')
    onSave(paths, exported)
  }

  const toolBtn = (t: Tool, label: string) => (
    <button
      key={t}
      onClick={() => setTool(t)}
      style={{
        padding: '6px 10px', fontSize: 12, borderRadius: 6, border: 'none', cursor: 'pointer',
        background: tool === t ? '#E30513' : 'rgba(255,255,255,0.15)',
        color: 'white', fontWeight: tool === t ? 700 : 400,
      }}
    >{label}</button>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#111', zIndex: 50, display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{ background: '#222222', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {toolBtn('pen', '✏️ Crayon')}
          {toolBtn('eraser', '◻ Gomme')}
          {toolBtn('text', 'T Texte')}
          <button
            onClick={() => { setTool('symbol'); setShowSyms(!showSyms) }}
            style={{
              padding: '6px 10px', fontSize: 12, borderRadius: 6, border: 'none', cursor: 'pointer',
              background: tool === 'symbol' ? '#E30513' : 'rgba(255,255,255,0.15)',
              color: 'white', fontWeight: tool === 'symbol' ? 700 : 400,
            }}
          >☆ Symbole</button>

          <div style={{ flex: 1 }} />

          {/* Undo */}
          <button
            onClick={() => setPaths(prev => prev.slice(0, -1))}
            style={{ padding: '6px 10px', fontSize: 12, borderRadius: 6, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.15)', color: 'white' }}
          >↩ Annuler</button>

          {/* Save */}
          <button
            onClick={handleSave}
            style={{ padding: '6px 14px', fontSize: 12, borderRadius: 6, border: 'none', cursor: 'pointer', background: '#E30513', color: 'white', fontWeight: 700 }}
          >Enregistrer</button>

          {/* Close */}
          <button
            onClick={onClose}
            style={{ padding: '6px 10px', fontSize: 12, borderRadius: 6, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.15)', color: 'white' }}
          >✕</button>
        </div>

        {/* Colors */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {ANNOT_COLORS.map(c => (
            <button
              key={c}
              onClick={() => setColor(c)}
              style={{
                width: 22, height: 22, borderRadius: '50%', border: color === c ? '3px solid white' : '2px solid rgba(255,255,255,0.3)',
                background: c, cursor: 'pointer', padding: 0,
              }}
            />
          ))}
          <span style={{ color: 'rgba(255,255,255,0.4)', margin: '0 4px' }}>|</span>
          {SIZES.map(s => (
            <button
              key={s}
              onClick={() => setSize(s)}
              style={{
                width: 22, height: 22, borderRadius: '50%', border: size === s ? '2px solid white' : '2px solid rgba(255,255,255,0.3)',
                background: 'rgba(255,255,255,0.1)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <span style={{ width: s * 1.5, height: s * 1.5, borderRadius: '50%', background: color, display: 'block' }} />
            </button>
          ))}
        </div>

        {/* Symbol picker */}
        {showSyms && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SYMBOLS.map(sym => (
              <button
                key={sym.id}
                onClick={() => { setSymId(sym.id); setShowSyms(false) }}
                style={{
                  padding: '4px 8px', fontSize: 11, borderRadius: 6, border: symId === sym.id ? '2px solid white' : '1px solid rgba(255,255,255,0.2)',
                  background: symId === sym.id ? 'rgba(227,5,19,0.4)' : 'rgba(255,255,255,0.1)', color: 'white', cursor: 'pointer',
                }}
              >{sym.short} {sym.label}</button>
            ))}
          </div>
        )}
      </div>

      {/* Canvas area */}
      <div style={{ flex: 1, overflow: 'auto', background: '#1a1a1a', padding: 8, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <canvas
            ref={cvRef}
            style={{ touchAction: 'none', cursor: tool === 'text' ? 'text' : 'crosshair', maxWidth: '100%', display: 'block' }}
            onMouseDown={onStart}
            onMouseMove={onMove}
            onMouseUp={onEnd}
            onMouseLeave={onEnd}
            onTouchStart={onStart}
            onTouchMove={onMove}
            onTouchEnd={onEnd}
          />
          {/* Text input popup */}
          {textPt && (
            <div style={{
              position: 'absolute',
              left: textPt.x / (cvRef.current ? cvRef.current.width / (cvRef.current.getBoundingClientRect().width || 1) : 1),
              top: textPt.y / (cvRef.current ? cvRef.current.height / (cvRef.current.getBoundingClientRect().height || 1) : 1),
              zIndex: 10,
            }}>
              <input
                autoFocus
                value={textV}
                onChange={e => setTextV(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') setTextPt(null) }}
                onBlur={commitText}
                style={{
                  background: 'rgba(0,0,0,0.7)', color: 'white', border: `2px solid ${color}`,
                  borderRadius: 4, padding: '2px 6px', fontSize: size + 10, outline: 'none', minWidth: 80,
                }}
                placeholder="Texte…"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
