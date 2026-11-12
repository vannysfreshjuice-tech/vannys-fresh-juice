import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';
import { announceUpdate, applyUpdate } from './lib/update';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// A soft orange glow wherever a finger or the mouse presses. Skipped when the phone asks for less motion.
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  window.addEventListener(
    'pointerdown',
    (e) => {
      const glow = document.createElement('span');
      glow.className = 'tap-glow';
      glow.style.left = `${e.clientX}px`;
      glow.style.top = `${e.clientY}px`;
      document.body.appendChild(glow);
      glow.addEventListener('animationend', () => glow.remove(), { once: true });
      setTimeout(() => glow.remove(), 1000);
    },
    { passive: true, capture: true },
  );
}

// The service worker keeps a copy of the app on the device, so it opens with no signal.
if (import.meta.env.PROD) {
  registerSW({
    onNeedRefresh() {
      announceUpdate(() => void applyUpdate());
    },
  });
  // Look for a new version when the app comes back to the front (an installed phone app can stay open for days).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
  });
}
