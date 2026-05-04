import React from 'react';
import { DA, URGENCE, SUIVI } from '../../lib/constants.js';

// Inject spin keyframes once
if (typeof document !== 'undefined' && !document.getElementById('ic-spin')) {
  const st = document.createElement('style');
  st.id = 'ic-spin';
  st.textContent = '@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}';
  document.head.appendChild(st);
}

const p = (s) => ({
  width: s, height: s, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: '1.8',
  strokeLinecap: 'round', strokeLinejoin: 'round',
});

const ICONS = {
  x: (s) => <svg {...p(s)}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  plus: (s) => <svg {...p(s)}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  chk: (s) => <svg {...p(s)}><polyline points="20 6 9 17 4 12"/></svg>,
  chv: (s) => <svg {...p(s)}><polyline points="6 9 12 15 18 9"/></svg>,
  del: (s) => <svg {...p(s)}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>,
  cam: (s) => <svg {...p(s)}><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>,
  img: (s) => <svg {...p(s)}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
  bld: (s) => <svg {...p(s)}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>,
  fil: (s) => <svg {...p(s)}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  arc: (s) => <svg {...p(s)}><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>,
  dts: (s) => <svg {...p(s)}><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>,
  pin: (s) => <svg {...p(s)}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  map: (s) => <svg {...p(s)}><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>,
  edt: (s) => <svg {...p(s)}><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  tbl: (s) => <svg {...p(s)}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>,
  eye: (s) => <svg {...p(s)}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  dl: (s) => <svg {...p(s)}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  snd: (s) => <svg {...p(s)}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  und: (s) => <svg {...p(s)}><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>,
  pen: (s) => <svg {...p(s)}><path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>,
  srt: (s) => <svg {...p(s)}><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="9" y2="18"/></svg>,
  usr: (s) => <svg {...p(s)}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  phn: (s) => <svg {...p(s)}><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.5 9.74 19.79 19.79 0 01.46 1.11 2 2 0 012.46.07h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.5a16 16 0 006.59 6.59l.8-.8a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>,
  ml: (s) => <svg {...p(s)}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
  clk: (s) => <svg {...p(s)}><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>,
  lib: (s) => <svg {...p(s)}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  spk: (s) => <svg {...p(s)}><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>,
  mic: (s) => <svg {...p(s)}><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>,
  spn: (s) => <svg {...p(s)} style={{animation:'spin 1s linear infinite'}}><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>,
  grp: (s) => <svg {...p(s)}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  sld: (s) => <svg {...p(s)}><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>,
  eras: (s) => <svg {...p(s)}><path d="M20 20H7L3 16l10-10 7 7-4.5 4.5"/><path d="M6.5 17.5l4-4"/></svg>,
  txt: (s) => <svg {...p(s)}><line x1="17" y1="10" x2="3" y2="10"/><path d="M21 6H3"/><path d="M21 14H3"/><line x1="11" y1="18" x2="3" y2="18"/></svg>,
  sym: (s) => <svg {...p(s)}><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="8" y="3" width="8" height="4" rx="1"/></svg>,
};

export function Ic({ n, s = 18 }) {
  const icon = ICONS[n];
  return icon ? icon(s) : null;
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
