import React from 'react';
import { logError } from '../lib/logger.js';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(e) { return { error: e }; }
  componentDidCatch(e, info) {
    console.error('ChantierAI crash:', e, info);
    this.setState({ info });
    logError('react.crash', { message: e?.message, stack: e?.stack?.slice(0, 1000), componentStack: info?.componentStack?.slice(0, 1000) });
  }

  render() {
    if (this.state.error) {
      // 1ʳᵉ ligne « utile » du component stack = le composant qui a planté (aide au diagnostic
      // précis quand un utilisateur envoie la capture de cet écran).
      const compLine = (this.state.info?.componentStack || '')
        .split('\n').map(s => s.trim()).find(s => s.startsWith('at ') || s.startsWith('in ')) || '';
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#30323E', padding: 32, textAlign: 'center' }}>
          <div style={{ color: '#E30513', fontWeight: 800, fontSize: 18, marginBottom: 12 }}>Erreur inattendue</div>
          <pre style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, whiteSpace: 'pre-wrap', maxWidth: 340, marginBottom: 8 }}>
            {this.state.error.message}
          </pre>
          {compLine && (
            <pre style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, whiteSpace: 'pre-wrap', maxWidth: 340, marginBottom: 24 }}>
              {compLine}
            </pre>
          )}
          <button onClick={() => window.location.reload()}
            style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: '#E30513', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            Recharger l'app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
