// Tiny global stores for things any screen can open: dialogs and toasts.
import { useSyncExternalStore } from 'react';

/**
 * @template T
 * @param {T} initial
 */
export function createStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    /** @param {T | ((v: T) => T)} next */
    set(next) {
      value = typeof next === 'function' ? /** @type {(v: T) => T} */ (next)(value) : next;
      for (const l of listeners) l();
    },
    /** @param {() => void} l */
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

/**
 * @template T
 * @param {ReturnType<typeof createStore<T>>} store
 * @returns {T}
 */
export function useStore(store) {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** Copies text; resolves false when the browser refuses. @param {string} text */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
