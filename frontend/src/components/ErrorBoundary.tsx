import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.error('[ErrorBoundary]', error, info.componentStack);
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-900/60 dark:bg-rose-950/30">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300">
            <AlertTriangle size={22} />
          </div>
          <h2 className="text-base font-semibold text-rose-900 dark:text-rose-100">
            Algo salió mal en esta sección.
          </h2>
          <p className="mt-1 text-sm text-rose-700/90 dark:text-rose-200/80">
            {error.message || 'Error inesperado al renderizar la página.'}
          </p>
          <button
            type="button"
            onClick={this.reset}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-rose-500"
          >
            <RefreshCw size={14} />
            Reintentar
          </button>
        </div>
      </div>
    );
  }
}
