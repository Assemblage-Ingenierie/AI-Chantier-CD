import React, { useState } from 'react';
import { DA } from '../../lib/constants.js';
import { Ic } from '../ui/Icons.jsx';
import { callAIProxy } from '../../lib/aiProxy.js';

export default function IASug({ content, onApply }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const ask = async () => {
    setLoading(true);
    setOpen(true);
    try {
      const d = await callAIProxy({
        feature: 'observation-suggestion',
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        system: 'Expert MOE/BET batiment. Compte-rendu de visite chantier. Francais, concis, professionnel.',
        messages: [{ role: 'user', content: `Observation:\n\n${content}\n\n1. 💬 Reformulation professionnelle (1-2 phrases)\n2. 🔧 Conseil technique si pertinent\nCommencer chaque partie par le symbole.` }],
      });
      setResult(d.content?.[0]?.text || 'Erreur');
    } catch (e) {
      setResult(`ERROR: ${e.message || 'Erreur de connexion'}`);
    }
    setLoading(false);
  };

  return (
    <div style={{ marginTop:8 }}>
      <button onClick={open ? () => setOpen(false) : ask}
        style={{ fontSize:11,border:`1px solid ${open?'#8B5CF6':DA.border}`,borderRadius:20,padding:'3px 10px',background:open?'#F5F3FF':'white',color:open?'#7C3AED':DA.gray,cursor:'pointer',display:'flex',alignItems:'center',gap:4 }}>
        <Ic n="spk" s={10}/> {open ? 'Fermer' : 'Suggestion IA'}
      </button>
      {open && (
        <div style={{ marginTop:8,background:'#F5F3FF',border:'1px solid #DDD6FE',borderRadius:10,padding:12 }}>
          {loading
            ? <div style={{ display:'flex',alignItems:'center',gap:6,fontSize:12,color:'#7C3AED' }}><Ic n="spn" s={12}/> Analyse en cours…</div>
            : <div>
                <p style={{ fontSize:12,lineHeight:1.6,color:'#4C1D95',whiteSpace:'pre-line',margin:0 }}>{result}</p>
                {result && !result.startsWith('ERROR:') && (
                  <button onClick={() => {
                    const m = result.match(/💬[^:]*:\s*([^]+?)(?=\n🔧|\n\n|$)/);
                    const text = m ? m[1].trim() : result.split('\n').find(l => l.trim() && !l.startsWith('🔧'))?.trim();
                    if (text) { onApply(text); setOpen(false); }
                    else alert("Impossible d'extraire la reformulation. Copiez-la manuellement.");
                  }} style={{ marginTop:8,background:'#7C3AED',color:'white',border:'none',borderRadius:8,padding:'4px 12px',fontSize:11,fontWeight:600,cursor:'pointer' }}>
                    Appliquer la reformulation
                  </button>
                )}
              </div>
          }
        </div>
      )}
    </div>
  );
}
