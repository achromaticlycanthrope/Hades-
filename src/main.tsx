import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Unregister all service workers to clear any bad state
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister();
      console.log("Service worker unregistered");
    }
  });
}

console.log("main.tsx loading...");
(window as any).__APP_LOADED__ = true;
const fallback = document.getElementById('loading-fallback');
if (fallback) fallback.style.display = 'none';

const rootElement = document.getElementById('root');
if (rootElement) {
  console.log("Root element found, creating root...");
  try {
    const root = createRoot(rootElement);
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    console.log("App render call completed");
  } catch (err) {
    console.error("Error during root.render:", err);
    rootElement.innerHTML = `<div style="padding: 20px; color: red; font-family: sans-serif;">
      <h1>Application Error</h1>
      <pre>${err instanceof Error ? err.message : String(err)}</pre>
      <button onclick="window.location.reload()">Reload Page</button>
    </div>`;
  }
} else {
  console.error("Root element NOT found!");
}
