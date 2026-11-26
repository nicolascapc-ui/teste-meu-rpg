import React from 'react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || 'Erro inesperado na aplicação.' };
  }

  componentDidCatch(error: Error) {
    console.error('Folio ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      let friendly = this.state.message;
      if (friendly.includes('Missing or insufficient permissions')) {
        friendly = 'Sem permissão para acessar este recurso da mesa. Verifique se você entrou com a conta correta.';
      } else if (friendly.includes('Quota exceeded')) {
        friendly = 'A cota diária do banco de dados foi atingida e será reiniciada amanhã.';
      }

      return (
        <div className="min-h-screen vtt-canvas flex items-center justify-center p-6">
          <div className="max-w-lg w-full vtt-surface border p-8 space-y-5">
            <p className="text-xs vtt-muted">Folio · Recuperação</p>
            <h1 className="text-2xl font-bold font-typewriter">Ocorreu um erro na mesa</h1>
            <p className="text-sm vtt-muted leading-relaxed break-words">{friendly}</p>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2.5 text-sm font-semibold vtt-accent-btn whitespace-nowrap shrink-0"
              >
                Recarregar mesa
              </button>
              <button
                type="button"
                onClick={() => {
                  window.history.pushState({}, '', '/');
                  window.location.reload();
                }}
                className="px-4 py-2.5 text-sm border vtt-border hover:opacity-80 whitespace-nowrap shrink-0"
              >
                Voltar às campanhas
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
