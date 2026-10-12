import { emptyNotebook, demoNotebook, uid, validateNotebook, parseImport, applyAction } from './model.js';
export const NOTEBOOK_VERSION = 2;
const clone = value => structuredClone(value);
const assert = (ok, message) => { if (!ok) throw new Error(message); };
function fields(value, allowed) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Expected an object.');
  for (const key of Object.keys(value)) assert(allowed.includes(key), `Unknown field: ${key}.`);
}
export function wrapPage(page) {
  validateNotebook(page);
  return { format: 'omd-notebook', version: NOTEBOOK_VERSION, id: uid(), revision: page.revision, activePageId: page.id, updatedAt: page.updatedAt, pages: [clone(page)] };
}
export const initialNotebook = () => wrapPage(demoNotebook());
export function validateBook(book) {
  fields(book, ['format','version','id','revision','activePageId','updatedAt','pages']);
  assert(book.format === 'omd-notebook' && book.version === NOTEBOOK_VERSION, 'Unsupported omd notebook version.');
  assert(typeof book.id === 'string' && book.id.length > 0, 'Notebook ID must be nonempty text.');
  assert(Number.isSafeInteger(book.revision) && book.revision >= 0, 'Invalid notebook revision.');
  assert(typeof book.updatedAt === 'string' && Number.isFinite(Date.parse(book.updatedAt)), 'Invalid updated date.');
  assert(Array.isArray(book.pages) && book.pages.length > 0, 'Keep at least one notebook page.');
  const ids = new Set([book.id]);
  for (const page of book.pages) { validateNotebook(page); assert(!ids.has(page.id), 'Page IDs must be unique.'); ids.add(page.id); }
  assert(book.pages.some(page => page.id === book.activePageId), 'Active page not found.');
  return book;
}
export function parseBook(raw) {
  assert(typeof raw === 'string', 'Import must be JSON text.');
  let value; try { value = JSON.parse(raw); } catch { throw new Error('This file is not valid JSON.'); }
  if (value?.format === 'omd' && value.version === 1) return wrapPage(parseImport(raw));
  return validateBook(value);
}
export function getPage(book, pageId = book.activePageId) {
  const page = book.pages.find(page => page.id === pageId); assert(page, 'Page not found.'); return page;
}
export function applyBookAction(current, action, input = {}) {
  fields(input, Object.keys(input)); const book = clone(current); let result = {};
  const position = (index, max) => assert(Number.isInteger(index) && index >= 0 && index <= max, 'Invalid page position.');
  switch (action) {
    case 'page_add': {
      fields(input, ['title','index']); const page = emptyNotebook(); page.title = input.title ?? 'Untitled page'; page.subtitle = '';
      const active = getPage(book); page.theme = active.theme; page.notificationMode = active.notificationMode;
      const index = input.index ?? book.pages.length; position(index, book.pages.length); book.pages.splice(index, 0, page); book.activePageId = page.id; result = { pageId: page.id }; break;
    }
    case 'page_select': fields(input, ['pageId']); getPage(book, input.pageId); book.activePageId = input.pageId; break;
    case 'page_update': {
      fields(input, ['pageId','title','subtitle']); const page = getPage(book, input.pageId);
      const patch = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'pageId'));
      const out = applyAction(page, 'set_page', patch); book.pages[book.pages.indexOf(page)] = out.state; break;
    }
    case 'page_move': {
      fields(input, ['pageId','index']); position(input.index, book.pages.length - 1);
      const page = getPage(book, input.pageId); book.pages.splice(book.pages.indexOf(page), 1); book.pages.splice(input.index, 0, page); break;
    }
    case 'page_remove': {
      fields(input, ['pageId']); assert(book.pages.length > 1, 'Keep at least one notebook page.');
      const page = getPage(book, input.pageId), i = book.pages.indexOf(page); book.pages.splice(i, 1);
      if (book.activePageId === page.id) book.activePageId = book.pages[Math.min(i, book.pages.length - 1)].id; break;
    }
    case 'import_notebook':
      fields(input, ['notebook']); Object.assign(book, input.notebook.format === 'omd' ? wrapPage(input.notebook) : clone(validateBook(input.notebook))); result = { imported: true }; break;
    default: {
      const { pageId, ...args } = input; const page = getPage(book, pageId);
      const out = applyAction(page, action, args); book.pages[book.pages.indexOf(page)] = out.state; result = out.result;
    }
  }
  book.revision = current.revision + 1; book.updatedAt = new Date().toISOString(); validateBook(book);
  return { state: book, result };
}
