import { emptyScene, validateScene } from './scene.js';
/** Page document format. UI, imports, and agents share these invariants. */
export const FORMAT_VERSION = 1;
export const STORAGE_KEY = 'omd.notebook.v1';
export const BLOCK_TYPES = ['text', 'heading', 'checklist', 'tabs', 'toggle', 'accordion', 'reminder', 'kanban', 'divider', 'mermaid', 'excalidraw'];
const THEMES = ['system', 'light', 'dark'];
const MODES = ['notification', 'alert', 'toast'];
export const uid = () => globalThis.crypto.randomUUID();
const copy = value => structuredClone(value);
const assert = (test, message) => { if (!test) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function string(value, label) {
  assert(typeof value === 'string', `${label} must be text.`);
}
function integer(value, max) { assert(Number.isInteger(value) && value >= 0 && value <= max, 'Invalid position.'); }
function boolean(value, label) { assert(typeof value === 'boolean', `${label} must be true or false.`); }
function date(value, label) { assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)), `${label} must be an ISO date-time with a timezone.`); }
function fields(value, allowed) {
  assert(object(value), 'Expected an object.');
  for (const key of Object.keys(value)) assert(allowed.includes(key), `Unknown field: ${key}.`);
}

export function emptyNotebook() {
  return { format: 'omd', version: FORMAT_VERSION, id: uid(), revision: 0,
    title: 'My day, on a page', subtitle: 'A little room to think, plan, and make things happen.',
    theme: 'system', notificationMode: 'notification', updatedAt: new Date().toISOString(), blocks: [] };
}

export function makeBlock(type, options = {}) {
  assert(BLOCK_TYPES.includes(type), 'Unknown block type.');
  const base = { id: uid(), type };
  switch (type) {
    case 'text': return { ...base, text: options.text ?? '' };
    case 'heading': return { ...base, text: options.text ?? 'A new section' };
    case 'divider': return base;
    case 'mermaid': return { ...base, title: options.title ?? 'A diagram in words', source: options.source ?? 'flowchart LR\n  Idea --> Plan\n  Plan --> Do' };
    case 'excalidraw': return { ...base, title: options.title ?? 'A little drawing space', scene: options.scene ?? emptyScene() };
    case 'checklist': return { ...base, title: options.title ?? 'A few things to do', items: [] };
    case 'tabs': {
      const tabs = ['First tab', 'Second tab'].map(title => ({ id: uid(), title, blocks: [] }));
      return { ...base, title: options.title ?? 'A space for everything', orientation: options.orientation ?? 'horizontal', tabs, activeTabId: tabs[0].id };
    }
    case 'toggle': return { ...base, title: options.title ?? 'A thought for later', open: true, blocks: [] };
    case 'accordion': return { ...base, title: options.title ?? 'Things worth keeping', items: [{ id: uid(), title: 'An idea', open: true, blocks: [] }] };
    case 'reminder': return { ...base, title: options.title ?? 'A gentle nudge', dueAt: options.dueAt ?? '', enabled: !!options.dueAt, firedAt: null };
    case 'kanban': return { ...base, title: options.title ?? 'Little steps, big things', columns: ['To do', 'In progress', 'Done'].map(title => ({ id: uid(), title, cards: [] })) };
  }
}

/** Alternating axes, at most TWO tab groups along any ancestor path. */
export function validateNotebook(notebook) {
  fields(notebook, ['format', 'version', 'id', 'revision', 'title', 'subtitle', 'theme', 'notificationMode', 'updatedAt', 'blocks']);
  assert(notebook.format === 'omd' && notebook.version === FORMAT_VERSION, 'Unsupported omd document version.');
  string(notebook.id, 'Notebook ID', 128);
  integer(notebook.revision, Number.MAX_SAFE_INTEGER);
  string(notebook.title, 'Page title', 200); string(notebook.subtitle, 'Page subtitle', 1000);
  assert(THEMES.includes(notebook.theme), 'Invalid theme.');
  assert(MODES.includes(notebook.notificationMode), 'Invalid reminder mode.');
  date(notebook.updatedAt, 'Updated date');
  const ids = new Set([notebook.id]);
  const id = value => { string(value, 'ID', 128); assert(value.length > 0 && !ids.has(value), 'IDs must be unique and nonempty.'); ids.add(value); };
  function list(value) { assert(Array.isArray(value), 'Expected a list.'); }
  function visit(blocks, axes = [], depth = 0) {
    list(blocks);
    for (const b of blocks) {
      assert(object(b), 'Invalid block.'); id(b.id);
      assert(BLOCK_TYPES.includes(b.type), 'Unknown block type.');
      switch (b.type) {
        case 'text': case 'heading': fields(b, ['id', 'type', 'text']); string(b.text, 'Block text'); break;
        case 'divider': fields(b, ['id', 'type']); break;
        case 'mermaid': fields(b, ['id','type','title','source']); string(b.title,'Diagram title'); string(b.source,'Mermaid source'); break;
        case 'excalidraw': fields(b, ['id','type','title','scene']); string(b.title,'Canvas title'); validateScene(b.scene); break;
        case 'checklist':
          fields(b, ['id', 'type', 'title', 'items']); string(b.title, 'Checklist title', 200); list(b.items);
          for (const item of b.items) { fields(item, ['id', 'text', 'done']); id(item.id); string(item.text, 'Checklist item', 1000); boolean(item.done, 'Checked'); }
          break;
        case 'tabs': {
          fields(b, ['id', 'type', 'title', 'orientation', 'tabs', 'activeTabId']); string(b.title, 'Tabs title', 200);
          assert(['horizontal', 'vertical'].includes(b.orientation), 'Invalid tab orientation.');
          assert(axes.length < 2, 'Tabs are limited to two levels.');
          assert(axes.at(-1) !== b.orientation, 'Nested tabs must use the opposite orientation.');
          list(b.tabs); assert(b.tabs.length > 0, 'Keep at least one tab.');
          for (const tab of b.tabs) { fields(tab, ['id', 'title', 'blocks']); id(tab.id); string(tab.title, 'Tab title', 200); visit(tab.blocks, [...axes, b.orientation], depth + 1); }
          assert(b.tabs.some(t => t.id === b.activeTabId), 'Active tab does not exist.'); break;
        }
        case 'toggle': fields(b, ['id', 'type', 'title', 'open', 'blocks']); string(b.title, 'Toggle title', 200); boolean(b.open, 'Open'); visit(b.blocks, axes, depth + 1); break;
        case 'accordion':
          fields(b, ['id', 'type', 'title', 'items']); string(b.title, 'Accordion title', 200); list(b.items);
          for (const item of b.items) { fields(item, ['id', 'title', 'open', 'blocks']); id(item.id); string(item.title, 'Accordion item', 200); boolean(item.open, 'Open'); visit(item.blocks, axes, depth + 1); } break;
        case 'reminder':
          fields(b, ['id', 'type', 'title', 'dueAt', 'enabled', 'firedAt']); string(b.title, 'Reminder title', 200); boolean(b.enabled, 'Enabled');
          if (b.dueAt !== '') date(b.dueAt, 'Reminder date');
          assert(!b.enabled || b.dueAt !== '', 'An enabled reminder needs a date.');
          if (b.firedAt !== null) date(b.firedAt, 'Reminder delivery date'); break;
        case 'kanban':
          fields(b, ['id', 'type', 'title', 'columns']); string(b.title, 'Board title', 200); list(b.columns);
          for (const col of b.columns) {
            fields(col, ['id', 'title', 'cards']); id(col.id); string(col.title, 'Column title', 200); list(col.cards);
            for (const card of col.cards) { fields(card, ['id', 'title', 'description']); id(card.id); string(card.title, 'Card title', 500); string(card.description, 'Card description', 5000); }
          } break;
      }
    }
  }
  visit(notebook.blocks);
  return notebook;
}

export function walkBlocks(notebook, fn) {
  function walk(blocks, axes = []) {
    for (const block of blocks) {
      fn(block, blocks, axes);
      if (block.type === 'tabs') for (const tab of block.tabs) walk(tab.blocks, [...axes, block.orientation]);
      if (block.type === 'toggle') walk(block.blocks, axes);
      if (block.type === 'accordion') for (const item of block.items) walk(item.blocks, axes);
    }
  }
  walk(notebook.blocks);
}

export function findBlock(notebook, blockId, type) {
  let found;
  walkBlocks(notebook, (block, siblings, axes) => { if (block.id === blockId) found = { block, siblings, axes }; });
  assert(found, 'Block not found.'); assert(!type || found.block.type === type, `Expected a ${type} block.`);
  return found;
}

export function findContainer(notebook, containerId = 'page') {
  if (containerId === 'page') return { blocks: notebook.blocks, axes: [] };
  let found;
  walkBlocks(notebook, (block, siblings, axes) => {
    if (block.type === 'toggle' && block.id === containerId) found = { blocks: block.blocks, axes };
    if (block.type === 'tabs') for (const tab of block.tabs) if (tab.id === containerId) found = { blocks: tab.blocks, axes: [...axes, block.orientation] };
    if (block.type === 'accordion') for (const item of block.items) if (item.id === containerId) found = { blocks: item.blocks, axes };
  });
  assert(found, 'Container not found.'); return found;
}

export function allowedTypes(notebook, containerId = 'page') {
  const { axes } = findContainer(notebook, containerId);
  return { types: BLOCK_TYPES.filter(type => type !== 'tabs' || axes.length < 2),
    tabOrientation: axes.length === 0 ? null : axes.at(-1) === 'horizontal' ? 'vertical' : 'horizontal' };
}

function member(items, id) { const item = items.find(x => x.id === id); assert(item, 'Item not found.'); return item; }
function remove(items, id) { const i = items.findIndex(x => x.id === id); assert(i >= 0, 'Item not found.'); return items.splice(i, 1)[0]; }
function insert(items, item, index = items.length) { integer(index, items.length); items.splice(index, 0, item); }
function move(items, id, index) { integer(index, items.length - 1); const item = remove(items, id); insert(items, item, index); }

/** Applies one atomic action to a clone; invalid actions never change the input. */
export function applyAction(current, action, input = {}) {
  assert(object(input), 'Tool input must be an object.');
  const doc = copy(current);
  let result = {};
  const block = type => findBlock(doc, input.blockId, type).block;
  switch (action) {
    case 'set_page':
      fields(input, ['title', 'subtitle', 'theme', 'notificationMode']); Object.assign(doc, input); break;
    case 'add_block': {
      fields(input, ['type', 'containerId', 'index', 'text', 'title', 'orientation', 'dueAt','source','scene']);
      const container = findContainer(doc, input.containerId);
      const b = makeBlock(input.type, input); insert(container.blocks, b, input.index); result = { blockId: b.id, block: copy(b) }; break;
    }
    case 'update_block': {
      fields(input, ['blockId', 'patch']); const b = block();
      const allowed = { text: ['text'], heading: ['text'], checklist: ['title'], tabs: ['title', 'orientation'], toggle: ['title', 'open'], accordion: ['title'], reminder: ['title', 'dueAt', 'enabled'], kanban: ['title'], divider: [], mermaid:['title','source'], excalidraw:['title','scene'] };
      fields(input.patch, allowed[b.type]); Object.assign(b, input.patch);
      if (b.type === 'reminder' && ('dueAt' in input.patch || input.patch.enabled === true)) b.firedAt = null;
      result = { blockId: b.id }; break;
    }
    case 'remove_block': fields(input, ['blockId']); { const f = findBlock(doc, input.blockId); remove(f.siblings, input.blockId); } break;
    case 'move_block': {
      fields(input, ['blockId', 'containerId', 'index']);
      const target = findContainer(doc, input.containerId);
      const source = findBlock(doc, input.blockId);
      const b = remove(source.siblings, input.blockId); insert(target.blocks, b, input.index);
      // A target inside the moved subtree has disappeared; never silently drop the block.
      assert(findBlock(doc, b.id), 'Cannot move a block inside itself.'); break;
    }
    case 'checklist_add': fields(input, ['blockId', 'text', 'index']); { const item = { id: uid(), text: input.text ?? '', done: false }; insert(block('checklist').items, item, input.index); result = { itemId: item.id }; } break;
    case 'checklist_update': fields(input, ['blockId', 'itemId', 'patch']); fields(input.patch, ['text', 'done']); Object.assign(member(block('checklist').items, input.itemId), input.patch); break;
    case 'checklist_remove': fields(input, ['blockId', 'itemId']); remove(block('checklist').items, input.itemId); break;
    case 'checklist_move': fields(input, ['blockId', 'itemId', 'index']); move(block('checklist').items, input.itemId, input.index); break;
    case 'tab_add': fields(input, ['blockId', 'title', 'index']); { const b = block('tabs'); const tab = { id: uid(), title: input.title ?? 'New tab', blocks: [] }; insert(b.tabs, tab, input.index); b.activeTabId = tab.id; result = { tabId: tab.id }; } break;
    case 'tab_update': fields(input, ['blockId', 'tabId', 'title']); member(block('tabs').tabs, input.tabId).title = input.title; break;
    case 'tab_select': fields(input, ['blockId', 'tabId']); { const b = block('tabs'); member(b.tabs, input.tabId); b.activeTabId = input.tabId; } break;
    case 'tab_move': fields(input, ['blockId', 'tabId', 'index']); move(block('tabs').tabs, input.tabId, input.index); break;
    case 'tab_remove': fields(input, ['blockId', 'tabId']); { const b = block('tabs'); assert(b.tabs.length > 1, 'Keep at least one tab.'); remove(b.tabs, input.tabId); if (!b.tabs.some(t => t.id === b.activeTabId)) b.activeTabId = b.tabs[0].id; } break;
    case 'accordion_add': fields(input, ['blockId', 'title', 'index']); { const item = { id: uid(), title: input.title ?? 'New item', open: true, blocks: [] }; insert(block('accordion').items, item, input.index); result = { itemId: item.id }; } break;
    case 'accordion_update': fields(input, ['blockId', 'itemId', 'patch']); fields(input.patch, ['title', 'open']); Object.assign(member(block('accordion').items, input.itemId), input.patch); break;
    case 'accordion_remove': fields(input, ['blockId', 'itemId']); remove(block('accordion').items, input.itemId); break;
    case 'accordion_move': fields(input, ['blockId', 'itemId', 'index']); move(block('accordion').items, input.itemId, input.index); break;
    case 'column_add': fields(input, ['blockId', 'title', 'index']); { const col = { id: uid(), title: input.title ?? 'New column', cards: [] }; insert(block('kanban').columns, col, input.index); result = { columnId: col.id }; } break;
    case 'column_update': fields(input, ['blockId', 'columnId', 'title']); member(block('kanban').columns, input.columnId).title = input.title; break;
    case 'column_move': fields(input, ['blockId', 'columnId', 'index']); move(block('kanban').columns, input.columnId, input.index); break;
    case 'column_remove': fields(input, ['blockId', 'columnId']); remove(block('kanban').columns, input.columnId); break;
    case 'card_add': fields(input, ['blockId', 'columnId', 'title', 'description', 'index']); { const card = { id: uid(), title: input.title ?? '', description: input.description ?? '' }; insert(member(block('kanban').columns, input.columnId).cards, card, input.index); result = { cardId: card.id }; } break;
    case 'card_update': fields(input, ['blockId', 'cardId', 'patch']); fields(input.patch, ['title', 'description']); { const b = block('kanban'); const col = b.columns.find(c => c.cards.some(x => x.id === input.cardId)); assert(col, 'Card not found.'); Object.assign(member(col.cards, input.cardId), input.patch); } break;
    case 'card_remove': fields(input, ['blockId', 'cardId']); { const col = block('kanban').columns.find(c => c.cards.some(x => x.id === input.cardId)); assert(col, 'Card not found.'); remove(col.cards, input.cardId); } break;
    case 'card_move': {
      fields(input, ['blockId', 'cardId', 'columnId', 'index']); const b = block('kanban');
      const source = b.columns.find(c => c.cards.some(x => x.id === input.cardId)); assert(source, 'Card not found.');
      const target = member(b.columns, input.columnId); insert(target.cards, remove(source.cards, input.cardId), input.index); break;
    }
    case 'reminder_fired': fields(input, ['blockId', 'firedAt']); { const b = block('reminder'); assert(b.enabled && !b.firedAt, 'Reminder is not pending.'); date(input.firedAt, 'Delivery date'); assert(Date.parse(b.dueAt) <= Date.parse(input.firedAt), 'Reminder is not due.'); b.firedAt = input.firedAt; } break;
    case 'import_notebook': fields(input, ['notebook']); validateNotebook(input.notebook); return { state: { ...copy(input.notebook), revision: current.revision + 1, updatedAt: new Date().toISOString() }, result: { imported: true } };
    default: throw new Error(`Unknown action: ${action}.`);
  }
  doc.revision++; doc.updatedAt = new Date().toISOString(); validateNotebook(doc);
  return { state: doc, result };
}

export function parseImport(raw) {
  assert(typeof raw === 'string', 'Import must be JSON text.');
  let value; try { value = JSON.parse(raw); } catch { throw new Error('This file is not valid JSON.'); }
  return validateNotebook(value);
}

export function dueReminders(notebook, now = Date.now()) {
  const due = []; walkBlocks(notebook, b => { if (b.type === 'reminder' && b.enabled && !b.firedAt && Date.parse(b.dueAt) <= now) due.push(copy(b)); }); return due;
}

export function demoNotebook() {
  const doc = emptyNotebook();
  const intro = makeBlock('text', { text: 'Your thoughts, plans, and little victories. All on one page. Edit anything here, or add a block to make this space yours.' });
  const tasks = makeBlock('checklist', { title: 'Today, a little at a time' });
  tasks.items = ['Make a little space for the important thing', 'Write down the idea before it disappears', 'Step outside, take a breath'].map((text, i) => ({ id: uid(), text, done: i === 0 }));
  const tabs = makeBlock('tabs', { title: 'Life has a few chapters' });
  tabs.tabs[0].title = 'Personal'; tabs.tabs[1].title = 'Work';
  tabs.tabs.push({ id: uid(), title: 'Someday', blocks: [makeBlock('text', { text: 'A place for the things that can wait.' })] });
  tabs.tabs[0].blocks = [makeBlock('text', { text: 'What would make today feel like a good day?' })];
  const board = makeBlock('kanban', { title: 'Keep things moving' });
  board.columns[0].cards.push({ id: uid(), title: 'An idea worth trying', description: 'Start small. See where it takes you.' });
  board.columns[1].cards.push({ id: uid(), title: 'Make this page my own', description: '' });
  const toggle = makeBlock('toggle', { title: 'Notes for another day' }); toggle.open = false;
  toggle.blocks = [makeBlock('text', { text: 'Nothing gets lost here. Your notebook is saved in this browser as you go.' })];
  doc.blocks = [intro, tasks, tabs, toggle, board]; return validateNotebook(doc);
}
