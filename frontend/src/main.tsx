import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { installGlobalErrorReporting } from './lib/report-error';

// Capture uncaught errors + unhandled promise rejections into the dev API Logs.
installGlobalErrorReporting();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
