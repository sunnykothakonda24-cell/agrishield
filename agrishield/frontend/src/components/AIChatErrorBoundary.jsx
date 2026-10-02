import React, { Component } from 'react';

export default class AIChatErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    if (import.meta.env.DEV) {
      console.error('[AgriShield AI] Chat view failed to render:', error, errorInfo);
    }
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <section className="ai-chat-load-error" role="alert">
        <h2>AgriShield AI failed to load.</h2>
        <p>The chat view encountered an unexpected error. Retry to load it again.</p>
        {import.meta.env.DEV && (
          <details>
            <summary>Technical details</summary>
            <pre>{this.state.error.stack || this.state.error.message}</pre>
          </details>
        )}
        <button type="button" onClick={this.handleRetry}>Retry</button>
      </section>
    );
  }
}
