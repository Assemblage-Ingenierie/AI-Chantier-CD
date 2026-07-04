import React from 'react';
import { DA, URGENCE, SUIVI } from '../../lib/constants.js';
import {
  X, RefreshCw, Plus, Check, ChevronDown, Trash2, Camera, Image, Building2,
  FileText, Archive, MoreVertical, MapPin, Map, Pencil, Table2, Eye, Download,
  Send, Undo2, PenLine, Lasso, Shapes, Palette, List, User, Phone, Mail,
  ClipboardCheck, LayoutGrid, Star, Mic, Loader2, GripVertical, Copy,
  SlidersHorizontal, Eraser, RotateCw, Type, Sticker,
} from 'lucide-react';

// Inject spin keyframes once (utilisé par le spinner de chargement)
if (typeof document !== 'undefined' && !document.getElementById('ic-spin')) {
  const st = document.createElement('style');
  st.id = 'ic-spin';
  st.textContent = '@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}';
  document.head.appendChild(st);
}

// Style Lucide épuré : outline, strokeWidth 2, cohérent sur toute l'app.
const ICONS = {
  x: X, rld: RefreshCw, plus: Plus, chk: Check, chv: ChevronDown, del: Trash2,
  cam: Camera, img: Image, bld: Building2, fil: FileText, arc: Archive,
  dts: MoreVertical, pin: MapPin, map: Map, edt: Pencil, tbl: Table2, eye: Eye,
  dl: Download, snd: Send, und: Undo2, pen: PenLine, sel: Lasso, shp: Shapes,
  pal: Palette, srt: List, usr: User, phn: Phone, ml: Mail, clk: ClipboardCheck,
  lib: LayoutGrid, spk: Star, mic: Mic, spn: Loader2, grp: GripVertical,
  cpy: Copy, sld: SlidersHorizontal, eras: Eraser, rotc: RotateCw, txt: Type,
  sym: Sticker,
};

export function Ic({ n, s = 18, color, style, className, strokeWidth = 2 }) {
  const IconCmp = ICONS[n];
  if (!IconCmp) return null;
  const spin = n === 'spn' ? { animation: 'spin 1s linear infinite' } : null;
  return (
    <IconCmp
      size={s}
      color={color}
      strokeWidth={strokeWidth}
      className={className}
      style={{ ...spin, ...style }}
    />
  );
}

export function Badge({ level }) {
  const u = URGENCE[level];
  if (!u) return null;
  return (
    <span style={{ display:'inline-flex',alignItems:'center',gap:4,padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:600,background:u.bg,color:u.text,border:`1px solid ${u.border}` }}>
      <span style={{ width:6,height:6,borderRadius:'50%',background:u.dot,display:'inline-block' }} />
      {u.label}
    </span>
  );
}

export function BadgeSuivi({ suivi, onClick, small = false }) {
  const s = SUIVI[suivi || 'rien'];
  return (
    <span onClick={onClick} style={{ display:'inline-flex',alignItems:'center',gap:3,padding:small?'1px 6px':'2px 8px',borderRadius:20,fontSize:small?9:10,fontWeight:700,background:s.bg,color:s.text,border:`1px solid ${s.border}`,cursor:onClick?'pointer':'default',whiteSpace:'nowrap',userSelect:'none' }}>
      <span style={{ width:5,height:5,borderRadius:'50%',background:s.dot,display:'inline-block',flexShrink:0 }} />
      {s.label}
    </span>
  );
}
