import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import './styles.css';
import './animations.css';
import App from './App';

if (typeof window !== 'undefined') {
  const root = document.getElementById('root')!;
  if (import.meta.env.DEV) {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  } else {
    hydrateRoot(
      root,
      <StrictMode>
        <App />
      </StrictMode>,
    );
  }
}

// Ejecutada en Node por vite-prerender-plugin durante el build:
// el HTML resultante se inyecta en #root del index.html emitido.
export async function prerender() {
  const { renderToString } = await import('react-dom/server');
  const html = renderToString(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  return { html };
}
