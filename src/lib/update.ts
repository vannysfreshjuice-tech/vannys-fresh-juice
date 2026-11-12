// A new version of the app is fetched in the background. It is applied only when the person taps
// "Update", so a half-typed form is never reloaded away.
//
// Applying it does not rely on the browser's "controller changed" signal: iPhones do not send it
// reliably (11 Nov 2026: Update did nothing on Evelyn's iPhone). Instead the waiting version is
// told to take over, we wait until it is active (or 4 seconds at most), then reload ourselves.
type Apply = () => void;

let ready: Apply | null = null;
const listeners = new Set<(apply: Apply) => void>();

export function announceUpdate(apply: Apply) {
  ready = apply;
  listeners.forEach((fn) => fn(apply));
}

export function onUpdateReady(fn: (apply: Apply) => void): () => void {
  listeners.add(fn);
  if (ready) fn(ready);
  return () => {
    listeners.delete(fn);
  };
}

/** Makes the waiting version take over and reloads the app onto it. Always ends in a reload. */
export async function applyUpdate(): Promise<void> {
  let done = false;
  const reload = () => {
    if (done) return;
    done = true;
    window.location.reload();
  };
  setTimeout(reload, 4000); // whatever happens, the page reloads
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const waiting = reg?.waiting;
    if (!waiting) return reload(); // nothing waiting: a reload picks up whatever is newest
    navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
    waiting.addEventListener('statechange', () => {
      if (waiting.state === 'activated') reload();
    });
    waiting.postMessage({ type: 'SKIP_WAITING' });
  } catch {
    reload();
  }
}
