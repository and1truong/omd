import { STORAGE_KEY, walkBlocks } from './model.js';
import { initialNotebook, wrapPage, validateBook, parseBook, getPage, applyBookAction } from './notebook.js';

/** Versioned multi-page notebook; getState preserves the existing active-page API. */
export function createStore(storage, { key = STORAGE_KEY, initial = initialNotebook } = {}) {
  let book;
  const listeners = new Set(), undoStack = [], redoStack = [];
  function read() {
    let raw; try { raw = storage.getItem(key); } catch { throw new Error('Browser storage is unavailable. Enable storage to use omd.'); }
    if (raw === null) return null;
    try { return parseBook(raw); } catch (error) { throw new Error(`Saved notebook could not be read. Its data has been preserved. ${error.message}`); }
  }
  let original; try { original = storage.getItem(key); } catch { throw new Error('Browser storage is unavailable. Enable storage to use omd.'); }
  book = read();
  if (!book) { const value = initial(); book = value.format === 'omd' ? wrapPage(value) : value; validateBook(book); }
  if (!original || JSON.parse(original).format === 'omd') {
    try {
      if (original && storage.getItem(`${key}.v1-backup`) === null) storage.setItem(`${key}.v1-backup`, original);
      storage.setItem(key, JSON.stringify(book));
    } catch { throw new Error('Could not save or migrate browser storage. Your original saved data is intact; free space, then reload.'); }
  }
  function persist(next) {
    const latest = read();
    if (latest && (latest.id !== book.id || latest.revision !== book.revision)) throw new Error('Another window changed this notebook. Reload before editing.');
    try { storage.setItem(key, JSON.stringify(next)); } catch { throw new Error('Could not save. Browser storage may be full; your last saved data is intact.'); }
  }
  function emit(options = {}) { for (const fn of listeners) fn(getPage(book), options); }
  function commit(next, { history = true, ...options } = {}) {
    validateBook(next); persist(next);
    if (history) { undoStack.push(structuredClone(book)); redoStack.length = 0; }
    book = next; emit(options);
  }
  function restore(snapshot) {
    const next = { ...structuredClone(snapshot), revision: book.revision + 1, updatedAt: new Date().toISOString() };
    if (next.pages.some(p => p.id === book.activePageId)) next.activePageId = book.activePageId;
    preserveDelivery(book, next); validateBook(next); persist(next); return next;
  }
  return {
    getActivePageId: () => book.activePageId,
    getState: () => structuredClone(getPage(book)),
    getPage: pageId => structuredClone(getPage(book, pageId)),
    getNotebook: () => structuredClone(book),
    listPages: () => book.pages.map((page, index) => ({ pageId: page.id, title: page.title, subtitle: page.subtitle, index, active: page.id === book.activePageId })),
    dispatch(action, input = {}, options = {}) {
      const { state: next, result } = applyBookAction(book, action, input);
      commit(next, { changedBlockId: input.blockId, changedPageId: input.pageId ?? next.activePageId, ...options, history: options.history ?? !['reminder_fired','page_select'].includes(action) });
      return { ...result, revision: book.revision };
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    export: () => JSON.stringify(book, null, 2),
    import(raw, options) { return this.dispatch('import_notebook', { notebook: parseBook(raw) }, options); },
    reload() { const next = read(); if (!next) throw new Error('Saved notebook is missing. Export the open notebook before reloading.'); if (next.id === book.id && next.revision === book.revision) return; book = next; undoStack.length = redoStack.length = 0; emit(); },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undo() { if (!undoStack.length) return false; const next = restore(undoStack.at(-1)); redoStack.push(structuredClone(book)); undoStack.pop(); book = next; emit(); return true; },
    redo() { if (!redoStack.length) return false; const next = restore(redoStack.at(-1)); undoStack.push(structuredClone(book)); redoStack.pop(); book = next; emit(); return true; }
  };
}
function preserveDelivery(current, next) {
  const records = new Map();
  for (const page of current.pages) walkBlocks(page, b => { if (b.type === 'reminder' && b.firedAt) records.set(`${page.id}:${b.id}:${b.dueAt}`, b.firedAt); });
  for (const page of next.pages) walkBlocks(page, b => { const key = `${page.id}:${b.id}:${b.dueAt}`; if (b.type === 'reminder' && records.has(key)) b.firedAt = records.get(key); });
}
