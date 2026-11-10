import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '../components/Button';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Local diagnostic only: never include image data or file contents.
    console.error('TONAL recovered from a UI error', error.message, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty-state">
        <div className="empty-inner">
          <div className="empty-eyebrow">Something went wrong</div>
          <h1 className="empty-title">The studio hit an unexpected problem.</h1>
          <p className="empty-subtitle">
            Your photo was not modified. Reload the workspace to continue; unsaved settings may be lost.
          </p>
          <div className="empty-actions">
            <Button variant="primary" onClick={() => window.location.reload()} icon={<AlertTriangle size={15} />}>
              Reload TONAL
            </Button>
          </div>
          <div className="confirm-detail" style={{ marginTop: 18, maxWidth: 460 }}>
            {this.state.error.message}
          </div>
        </div>
      </div>
    );
  }
}
