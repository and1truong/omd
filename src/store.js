import { STORAGE_KEY, demoNotebook, validateNotebook, parseImport, applyAction } from './model.js';

/** Write-through persistence: failed saves never mutate the live document. */
export function createStore(storage, { key = STORAGE_KEY, initial = demoNotebook } = {}) {
  let state;
  const listeners = new Set();
  const undoStack = [], redoStack = [];
  function read() {
    let raw;
    try { raw = storage.getItem(key); } catch { throw new Error('Browser storage is unavailable. Enable storage to use omd.'); }
    if (raw === null) return null;
    try { return parseImport(raw); } catch (error) { throw new Error(`Saved notebook could not be read. Its data has been preserved. ${error.message}`); }
  }
  state = read();
  if (!state) { state = initial(); validateNotebook(state); try { storage.setItem(key, JSON.stringify(state)); } catch { throw new Error('Could not save to browser storage. Free some space or allow storage, then reload.'); } }
  function persist(next) {
    const latest = read();
    if (latest && (latest.id !== state.id || latest.revision !== state.revision)) throw new Error('Another window changed this notebook. Reload before editing.');
    try { storage.setItem(key, JSON.stringify(next)); } catch { throw new Error('Could not save. Browser storage may be full; your last saved data is intact.'); }
  }
  function emit(options) { for (const fn of listeners) fn(state, options ?? {}); }
  function commit(next, { history = true, ...options } = {}) {
    validateNotebook(next); persist(next);
    if (history) { undoStack.push(structuredClone(state)); redoStack.length = 0; }
    state = next; emit(options);
  }
  return {
    getState: () => structuredClone(state),
    dispatch(action, input, options) {
      const { state: next, result } = applyAction(state, action, input);
      commit(next, { ...options, history: action !== 'reminder_fired' }); return { ...result, revision: state.revision };
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    export: () => JSON.stringify(state, null, 2),
    import(raw, options) { return this.dispatch('import_notebook', { notebook: parseImport(raw) }, options); },
    reload() { const next = read(); if (!next) throw new Error('Saved notebook is missing. Export the open page before reloading.'); if (next.id === state.id && next.revision === state.revision) return; state = next; undoStack.length = redoStack.length = 0; emit({}); },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undo() {
      if (!undoStack.length) return false;
      const next = { ...structuredClone(undoStack.at(-1)), revision: state.revision + 1, updatedAt: new Date().toISOString() };
      // Delivery records are not undoable: editing another block must not redeliver reminders.
      preserveDelivery(state, next);
      const previous = structuredClone(state); validateNotebook(next); persist(next); undoStack.pop(); redoStack.push(previous); state = next; emit({}); return true;
    },
    redo() {
      if (!redoStack.length) return false;
      const next = { ...structuredClone(redoStack.at(-1)), revision: state.revision + 1, updatedAt: new Date().toISOString() };
      preserveDelivery(state, next);
      const previous = structuredClone(state); validateNotebook(next); persist(next); redoStack.pop(); undoStack.push(previous); state = next; emit({}); return true;
    }
  };
}

import { walkBlocks } from './model.js';
function preserveDelivery(current, next) {
  const records = new Map(); walkBlocks(current, b => { if (b.type === 'reminder' && b.firedAt) records.set(`${b.id}:${b.dueAt}`, b.firedAt); });
  walkBlocks(next, b => { if (b.type === 'reminder' && records.has(`${b.id}:${b.dueAt}`)) b.firedAt = records.get(`${b.id}:${b.dueAt}`); });
}
