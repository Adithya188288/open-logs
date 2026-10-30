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

/**
 * Copies text; resolves false only when every method fails. The async Clipboard API is refused in some browsers
 * and embedded panes ("Write permission denied"), so fall back to copying a selection.
 * @param {string} text
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyBySelection(text);
  }
}

/** @param {string} text */
function copyBySelection(text) {
  // Keep the field inside the dialog that has focus, so a dialog's focus handling can't pull focus away from it.
  const host = document.activeElement?.closest('[role="dialog"]') ?? document.body;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  host.append(field);
  field.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}
