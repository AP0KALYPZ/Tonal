import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/panels.css';
import './styles/dialogs.css';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';

const root = document.getElementById('root');
if (!root) throw new Error('TONAL could not find its application root.');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
