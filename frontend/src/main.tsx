import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { installGlobalErrorReporting } from './lib/report-error';
import { installChunkReloadHandler } from './lib/lazy-with-reload';
import { applyGpuAttr } from './lib/gpu-capability';

// Capture uncaught errors + unhandled promise rejections into the dev API Logs.
installGlobalErrorReporting();
// Recover from stale lazy chunks after a deploy by reloading once (any page).
installChunkReloadHandler();
// Classify GPU once and set <html data-gpu> so CSS + shaders can gate heavy FX.
applyGpuAttr();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
