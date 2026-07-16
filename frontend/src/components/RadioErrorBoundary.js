import React from "react";

/**
 * RadioErrorBoundary
 * Catches React rendering/DOM errors (e.g. "insertBefore on Node" caused by
 * duplicate list keys during rapid segment updates) so the whole player
 * doesn't crash. Shows a small inline recovery card instead.
 */
export default class RadioErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[RadioErrorBoundary]", error, info?.componentStack);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="card-surface p-6 text-sm text-zinc-400"
          data-testid="radio-error-boundary"
        >
          <div className="font-display font-bold text-white mb-1">
            Timeline temporaneamente non disponibile
          </div>
          <div className="mb-3">
            Un aggiornamento della lista segmenti ha causato un errore di
            rendering. La radio continua a trasmettere normalmente.
          </div>
          <button
            onClick={this.reset}
            className="btn-outline text-xs focusable"
            data-testid="radio-error-retry"
          >
            Riprova
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
