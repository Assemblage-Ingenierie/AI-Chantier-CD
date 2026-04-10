import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(e) { return { error: e }; }
  componentDidCatch(e, info) { console.error('ChantierAI crash:', e, info); }

  render() {
    if (this.state.error) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#30323E', padding: 32, textAlign: 'center' }}>
          <div style={{ color: '#E30513', fontWeight: 800, fontSize: 18, marginBottom: 12 }}>Erreur inattendue</div>
          <pre style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, whiteSpace: 'pre-wrap', maxWidth: 340, marginBottom: 24 }}>
            {this.state.error.message}
          </pre>
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
