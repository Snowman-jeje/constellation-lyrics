import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/BoundaryStates';
import { SuiteProvider } from './store/useSuiteStore';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <SuiteProvider>
        <App />
      </SuiteProvider>
    </ErrorBoundary>
  </StrictMode>,
);
