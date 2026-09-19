import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import App from './App.tsx'
import { usePatchStore } from './store/patchStore'
import { CHAIN_ORDER_BLOCK_IDS } from './midi/sysex'

// TEMPORARY debug hook for the chain-order reverse-engineering session (see
// docs/MIDI_MAPPING_NOTES.md / memory nanocore-chain-order-broken) — lets us call
// usePatchStore.getState().setChainOrder([...]) directly from the browser console for precise,
// drag-free single-variable tests, and inspect the exact runtime mapping object. Remove once the
// chain-order encoding is solved (or before any production-focused cleanup).
if (import.meta.env.DEV) {
  // @ts-expect-error debug-only global, not part of the app's public API
  window.usePatchStore = usePatchStore;
  // @ts-expect-error debug-only global, not part of the app's public API
  window.CHAIN_ORDER_BLOCK_IDS = CHAIN_ORDER_BLOCK_IDS;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
