import { createStore } from './store.js';
import { STORAGE_KEY, allowedTypes, findBlock } from './model.js';
import { startReminders } from './reminders.js';
import { setupPalette } from './palette.js';
import { createDiagramManager } from './diagrams.js';
import { createRenderCache, reconcile, revealActions } from './render-cache.js';
import { setupShell, showMenu } from './shell.js';
import { icon, labelIcon } from './icons.js';

const $ = selector => document.querySelector(selector);
let store, palette, diagrams, renderer, shell, dragData, pickerTarget = 'page';
export const openPalette = () => {shell?.closeMobile();palette?.open();};
export const getView = () => shell.getView();
export const setView = patch => shell.setView(patch);
export const flushDiagrams = () => diagrams?.flushAll();
export function openCanvas(blockId,pageId) {
  const page=store.getPage(pageId);findBlock(page,blockId,'excalidraw');diagrams?.flushAll();
  shell?.closeMobile();
  if(page.id!==store.getActivePageId())store.dispatch('page_select',{pageId:page.id});
  for(const [name,input] of revealActions(page.blocks,blockId))store.dispatch(name,input);
  diagrams.openFocus(blockId);
}
export const closeCanvas = () => diagrams?.closeFocus();
const themeQuery = matchMedia('(prefers-color-scheme: dark)');
export function notify(message, kind = '', persistent = false) {
  const el = element('div', `notice ${kind}`); const text = element('span'); text.textContent = message;
  const close = button('×', 'Dismiss message', () => el.remove()); el.append(text, close); $('#notices').append(el);
  if (!persistent) setTimeout(() => el.remove(), kind === 'error' ? 12000 : 5000);
}
function element(tag, className = '') { const el = document.createElement(tag); el.className = className; return el; }
function button(label, aria, fn, className = 'icon-button') {
  const b = element('button', className); b.type = 'button'; if(labelIcon[label])b.append(icon(labelIcon[label]));else b.textContent=label; b.title = aria; b.setAttribute('aria-label', aria); b.addEventListener('click', fn); return b;
}
function action(name, input, { quiet = false, focus } = {}) {
  try { if(!quiet)diagrams?.flushAll(); const result = store.dispatch(name, input, { quiet }); if (focus) requestAnimationFrame(() => document.getElementById(focus)?.focus()); return result; }
  catch (error) { $('#save-status').textContent = 'Not saved'; notify(error.message, 'error', true); return null; }
}
function editable(value, aria, fn, { multiline = false, className = '', placeholder = '', id } = {}) {
  const input = element(multiline ? 'textarea' : 'input', className); if (!multiline) input.type = 'text';
  else input.rows = 1;
  input.value = value; input.placeholder = placeholder; input.setAttribute('aria-label', aria); if (id) input.id = id;
  let composing = false;
  function write() { fn(input.value); if (multiline) fit(input); }
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; write(); });
  input.addEventListener('input', () => { if (!composing) write(); });
  if (multiline) input.dataset.autofit = 'true'; return input;
}
function fit(el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }
function title(b, glyph) {
  const head = element('div', 'block-heading'); const glyphIcon=icon(b.type);glyphIcon.classList.add('type-glyph');
  head.append(glyphIcon, editable(b.title, `${b.type} title`, value => action('update_block', { blockId: b.id, patch: { title: value } }, { quiet: true }), { className: 'block-title', placeholder: 'Untitled' })); return head;
}
function rowsControls(onUp, onDown, onRemove, upDisabled, downDisabled, label) {
  const tools = element('div', 'row-controls');
  const up = button('↑', `Move ${label} up`, onUp); up.disabled = upDisabled;
  const down = button('↓', `Move ${label} down`, onDown); down.disabled = downDisabled;
  tools.append(up, down, button('×', `Delete ${label}`, onRemove, 'icon-button delete')); return tools;
}
export async function confirmAction(title, message, yes = 'Continue') {
  const dialog = $('#confirm-dialog'); if (dialog.open) return false;
  $('#confirm-title').textContent = title; $('#confirm-message').textContent = message; $('#confirm-ok').textContent = yes;
  return new Promise(resolve => {
    let approved = false;
    const accept = () => { approved = true; dialog.close(); }; const cancel = () => dialog.close();
    const finish = () => { $('#confirm-ok').removeEventListener('click', accept); $('#confirm-cancel').removeEventListener('click', cancel); resolve(approved); };
    $('#confirm-ok').addEventListener('click', accept); $('#confirm-cancel').addEventListener('click', cancel); dialog.addEventListener('close', finish, { once: true }); dialog.showModal();
  });
}
function draggable(handle, data) {
  handle.draggable = true; handle.addEventListener('dragstart', event => { event.stopPropagation(); dragData = data; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-omd', JSON.stringify(data)); handle.closest('.block,.kanban-card,.kanban-column')?.classList.add('dragging'); if (data.kind === 'block') document.body.classList.add('dragging-block'); });
  handle.addEventListener('dragend', () => { dragData = null; document.body.classList.remove('dragging-block'); for (const el of document.querySelectorAll('.dragging,.drop-active')) el.classList.remove('dragging', 'drop-active'); });
}
function dropTarget(el, canDrop, drop) {
  el.addEventListener('dragover', event => { if (dragData && canDrop(dragData)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; el.classList.add('drop-active'); } });
  el.addEventListener('dragleave', event => { if (!el.contains(event.relatedTarget)) el.classList.remove('drop-active'); });
  el.addEventListener('drop', event => { if (dragData && canDrop(dragData)) { event.preventDefault(); event.stopPropagation(); el.classList.remove('drop-active'); drop(dragData); } });
}

function makeBlockList(blocks, containerId, nodes) {
  const list = element('div', 'block-list'); list.dataset.container = containerId;
  function slot(index) {
    const el = element('div', 'drop-slot'); el.setAttribute('aria-hidden', 'true');
    dropTarget(el, data => data.kind === 'block', data => {
      const source = findBlock(store.getState(), data.blockId); let targetIndex = index;
      if (source.siblings.some(b => b.id === data.blockId) && data.containerId === containerId && source.siblings.findIndex(b => b.id === data.blockId) < index) targetIndex--;
      action('move_block', { blockId: data.blockId, containerId, index: targetIndex });
    }); return el;
  }
  const children=[];nodes.forEach((node, i) => { children.push(slot(i), node); }); children.push(slot(blocks.length));
  const add = button('Add a block', 'Add a block here', () => openPicker(containerId), 'add-block-button'); children.push(add);
  dropTarget(add, data => data.kind === 'block', data => action('move_block', { blockId: data.blockId, containerId })); return {node:list,children};
}
function renderBlock(b, containerId, index, count) {
  const shell = element('section', `block block-type-${b.type}`); shell.dataset.blockId = b.id;
  const controls = element('div', 'block-controls'); const handle = button('⠿', 'Drag block', () => {}, 'icon-button block-drag'); draggable(handle, { kind: 'block', blockId: b.id, containerId });
  const more=button('…','Block actions',()=>{
    const current=findBlock(store.getState(),b.id),position=current.siblings.findIndex(block=>block.id===b.id);
    showMenu('block-actions-dialog','Block actions',[
      {label:'Move block up',icon:'up',disabled:position===0,run:()=>action('move_block',{blockId:b.id,containerId,index:position-1},{focus:`${b.id}-menu`})},
      {label:'Move block down',icon:'down',disabled:position===current.siblings.length-1,run:()=>action('move_block',{blockId:b.id,containerId,index:position+1},{focus:`${b.id}-menu`})},
      {label:'Delete block',icon:'trash',danger:true,run:async()=>{if(await confirmAction('Remove this block?','This removes the block and everything inside it. You can undo this change.','Remove'))action('remove_block',{blockId:b.id});}},
    ],more);
  });more.id=`${b.id}-menu`;controls.append(handle,more);
  shell.append(controls);
  switch (b.type) {
    case 'text': case 'heading': shell.append(editable(b.text, `${b.type} content`, value => action('update_block', { blockId: b.id, patch: { text: value } }, { quiet: true }), { multiline: true, placeholder: b.type === 'text' ? 'Write something…' : 'A new section', id: `${b.id}-text` })); break;
    case 'divider': shell.append(element('hr')); break;
    case 'checklist': renderChecklist(shell, b); break;
    case 'tabs': renderTabs(shell, b); break;
    case 'toggle': renderToggle(shell, b); break;
    case 'accordion': renderAccordion(shell, b); break;
    case 'reminder': renderReminder(shell, b); break;
    case 'kanban': renderKanban(shell, b); break;
    case 'mermaid': {
      shell.append(title(b,'◇'),editable(b.source,'Mermaid Markdown source',value=>{if(action('update_block',{blockId:b.id,patch:{source:value}},{quiet:true}))diagrams.updateSource(b.id,value);},{multiline:true,className:'mermaid-source',id:`${b.id}-source`,placeholder:'flowchart LR\n  A --> B'}),diagrams.mount(b,renderPageId)); break;
    }
    case 'excalidraw': {
      const head=title(b,'✎');head.append(button('↗ Full page','Open canvas full page',()=>openCanvas(b.id), 'add-inline'));
      const placeholder=element('div','canvas-placeholder');placeholder.dataset.canvasPlaceholder=b.id;placeholder.append(diagrams.mount(b,renderPageId));shell.append(head,placeholder); break;
    }
  }
  return shell;
}
function renderChecklist(shell, b) {
  const head = title(b, '☑'); const progress = element('span', 'checklist-progress'); progress.textContent = `${b.items.filter(i => i.done).length} / ${b.items.length}`; head.append(progress); shell.append(head);
  b.items.forEach((item, index) => {
    const row = element('div', `check-row ${item.done ? 'done' : ''}`); const check = element('input'); check.type = 'checkbox'; check.checked = item.done; check.setAttribute('aria-label', `Complete ${item.text || 'item'}`);
    check.addEventListener('change', () => action('checklist_update', { blockId: b.id, itemId: item.id, patch: { done: check.checked } }));
    const text = editable(item.text, 'Checklist item', value => action('checklist_update', { blockId: b.id, itemId: item.id, patch: { text: value } }, { quiet: true }), { placeholder: 'A little thing to do', id: item.id });
    text.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); const result = action('checklist_add', { blockId: b.id, index: index + 1 }); if (result) requestAnimationFrame(() => document.getElementById(result.itemId)?.focus()); } });
    row.append(check, text, rowsControls(() => action('checklist_move', { blockId: b.id, itemId: item.id, index: index - 1 }), () => action('checklist_move', { blockId: b.id, itemId: item.id, index: index + 1 }), () => action('checklist_remove', { blockId: b.id, itemId: item.id }), index === 0, index === b.items.length - 1, 'checklist item')); shell.append(row);
  });
  shell.append(button('+ Add an item', 'Add checklist item', () => { const r = action('checklist_add', { blockId: b.id }); if (r) requestAnimationFrame(() => document.getElementById(r.itemId)?.focus()); }, 'add-inline'));
}
function renderTabs(shell, b) {
  shell.append(title(b, '▤')); const group = element('div', 'tab-group'); const layout = element('div', `tabs-layout ${b.orientation}`);
  const tablist = element('div', 'tablist'); tablist.setAttribute('role', 'tablist'); tablist.setAttribute('aria-label', b.title || 'Tabs'); tablist.setAttribute('aria-orientation', b.orientation);
  b.tabs.forEach((t, i) => {
    const tab = button(t.title || 'Untitled', `Open ${t.title || 'tab'}`, () => action('tab_select', { blockId: b.id, tabId: t.id }), 'tab-button'); tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(t.id === b.activeTabId)); tab.id = `${t.id}-button`; tab.setAttribute('aria-controls', `${t.id}-panel`); tab.tabIndex = t.id === b.activeTabId ? 0 : -1;
    tab.addEventListener('keydown', e => { const keys = b.orientation === 'horizontal' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']; let n;
      if (e.key === keys[0]) n = (i - 1 + b.tabs.length) % b.tabs.length; if (e.key === keys[1]) n = (i + 1) % b.tabs.length; if (e.key === 'Home') n = 0; if (e.key === 'End') n = b.tabs.length - 1;
      if (n !== undefined) { e.preventDefault(); action('tab_select', { blockId: b.id, tabId: b.tabs[n].id }, { focus: `${b.tabs[n].id}-button` }); }
    }); tablist.append(tab);
  });
  tablist.append(button('+', 'Add tab', () => action('tab_add', { blockId: b.id }), 'tab-button tab-plus'));
  const t = b.tabs.find(t => t.id === b.activeTabId); const panel = element('div', 'tab-panel'); panel.id = `${t.id}-panel`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `${t.id}-button`);
  const edit = element('div', 'tab-editbar'); const i = b.tabs.indexOf(t);
  edit.append(editable(t.title, 'Rename active tab', value => {
    action('tab_update', { blockId: b.id, tabId: t.id, title: value }, { quiet: true }); document.getElementById(`${t.id}-button`).textContent = value || 'Untitled';
  }, { className: 'tab-label-edit', placeholder: 'Tab name' }), rowsControls(() => action('tab_move', { blockId: b.id, tabId: t.id, index: i - 1 }), () => action('tab_move', { blockId: b.id, tabId: t.id, index: i + 1 }), async () => { if (b.tabs.length > 1 && await confirmAction('Remove this tab?', 'Everything inside this tab will be removed. You can undo it.', 'Remove tab')) action('tab_remove', { blockId: b.id, tabId: t.id }); }, i === 0, i === b.tabs.length - 1, 'tab'));
  edit.querySelector('.row-controls').style.opacity = '1'; if (b.tabs.length === 1) edit.querySelector('.delete').disabled = true;
  panel.append(edit, renderer.childList(t.id)); layout.append(tablist, panel); group.append(layout); shell.append(group);
}
function renderToggle(shell, b) {
  const head = element('div', 'toggle-head'); const arrow = button(b.open ? '▾' : '▸', `${b.open ? 'Collapse' : 'Expand'} ${b.title}`, () => action('update_block', { blockId: b.id, patch: { open: !b.open } }), 'toggle-arrow'); arrow.setAttribute('aria-expanded', String(b.open)); arrow.setAttribute('aria-controls', `${b.id}-content`);
  head.append(arrow, editable(b.title, 'Expandable block title', value => action('update_block', { blockId: b.id, patch: { title: value } }, { quiet: true }), { className: 'block-title' })); shell.append(head);
  if (b.open) { const content = element('div', 'toggle-content'); content.id = `${b.id}-content`; content.append(renderer.childList(b.id)); shell.append(content); }
}
function renderAccordion(shell, b) {
  shell.append(title(b, '≡')); const group = element('div', 'accordion');
  b.items.forEach((item, i) => {
    const part = element('div', 'accordion-item'); const head = element('div', 'accordion-head'); const arrow = button(item.open ? '▾' : '▸', `${item.open ? 'Collapse' : 'Expand'} ${item.title}`, () => action('accordion_update', { blockId: b.id, itemId: item.id, patch: { open: !item.open } }), 'toggle-arrow'); arrow.setAttribute('aria-expanded', String(item.open)); arrow.setAttribute('aria-controls', `${item.id}-content`);
    head.append(arrow, editable(item.title, 'Accordion item title', value => action('accordion_update', { blockId: b.id, itemId: item.id, patch: { title: value } }, { quiet: true }), { className: 'block-title' }), rowsControls(() => action('accordion_move', { blockId: b.id, itemId: item.id, index: i - 1 }), () => action('accordion_move', { blockId: b.id, itemId: item.id, index: i + 1 }), async () => { if (await confirmAction('Remove this section?', 'Its contents will be removed too. You can undo it.', 'Remove')) action('accordion_remove', { blockId: b.id, itemId: item.id }); }, i === 0, i === b.items.length - 1, 'accordion section'));
    part.append(head); if (item.open) { const content = element('div', 'accordion-content'); content.id = `${item.id}-content`; content.append(renderer.childList(item.id)); part.append(content); } group.append(part);
  }); shell.append(group, button('+ Add a section', 'Add accordion section', () => action('accordion_add', { blockId: b.id }), 'add-inline'));
}
function toLocalDateTime(iso) { if (!iso) return ''; const d = new Date(iso); const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16); }
function renderReminder(shell, b) {
  const box = element('div', 'reminder-box'); const reminderIcon=icon('reminder');reminderIcon.classList.add('reminder-icon');
  const body = element('div', 'reminder-body'); body.append(editable(b.title, 'Reminder text', value => action('update_block', { blockId: b.id, patch: { title: value } }, { quiet: true }), { className: 'block-title' }));
  const dateRow = element('div', 'reminder-date'); const input = element('input'); input.type = 'datetime-local'; input.value = toLocalDateTime(b.dueAt); input.setAttribute('aria-label', 'Reminder date and time');
  input.addEventListener('change', () => { const dueAt = input.value ? new Date(input.value).toISOString() : ''; action('update_block', { blockId: b.id, patch: { dueAt, enabled: !!dueAt } }); });
  const status = element('span', 'reminder-status'); status.textContent = b.firedAt ? 'Delivered' : !b.enabled ? 'Off' : Date.parse(b.dueAt) <= Date.now() ? 'Due' : 'Scheduled'; dateRow.append(input, status); body.append(dateRow);
  const label = element('label', 'reminder-enable'); const enabled = element('input'); enabled.type = 'checkbox'; enabled.checked = b.enabled; enabled.disabled = !b.dueAt; enabled.addEventListener('change', () => action('update_block', { blockId: b.id, patch: { enabled: enabled.checked } })); label.append(enabled, document.createTextNode('On')); box.append(reminderIcon, body, label); shell.append(box);
  const note = element('p', 'reminder-note'); note.textContent = 'While open, or when you return. Notification settings ↗'; note.append(button('Settings', 'Reminder settings', () => openSettings(), 'link-button')); shell.append(note);
}
function renderKanban(shell, b) {
  const head = title(b, '▥'); head.append(button('+ Column', 'Add board column', () => action('column_add', { blockId: b.id }), 'add-inline')); shell.append(head);
  const board = element('div', 'kanban-board');
  b.columns.forEach((col, ci) => {
    const column = element('section', 'kanban-column'); column.setAttribute('aria-label', col.title || 'Kanban column');
    const header = element('div', 'column-header'); const dot = element('span', 'column-dot'); dot.setAttribute('aria-hidden', 'true');
    const handle = button('⠿', 'Drag column', () => {}, 'icon-button block-drag'); handle.style.fontSize = '12px'; handle.style.minWidth = '17px'; draggable(handle, { kind: 'column', blockId: b.id, columnId: col.id });
    const count = element('span', 'card-count'); count.textContent = col.cards.length;
    header.append(dot, editable(col.title, 'Column title', value => action('column_update', { blockId: b.id, columnId: col.id, title: value }, { quiet: true }), { className: 'column-title' }), count, handle,
      rowsControls(() => action('column_move', { blockId: b.id, columnId: col.id, index: ci - 1 }), () => action('column_move', { blockId: b.id, columnId: col.id, index: ci + 1 }), async () => { if (await confirmAction('Remove this column?', `${col.cards.length} card(s) in this column will also be removed. You can undo it.`, 'Remove column')) action('column_remove', { blockId: b.id, columnId: col.id }); }, ci === 0, ci === b.columns.length - 1, 'column'));
    column.append(header); const cards = element('div', 'cards');
    col.cards.forEach((card, i) => {
      const el = element('div', 'kanban-card'); el.dataset.cardId = card.id;
      el.append(editable(card.title, 'Card title', value => action('card_update', { blockId: b.id, cardId: card.id, patch: { title: value } }, { quiet: true }), { multiline: true, className: 'card-title', placeholder: 'A small next step', id: card.id }), editable(card.description, 'Card description', value => action('card_update', { blockId: b.id, cardId: card.id, patch: { description: value } }, { quiet: true }), { multiline: true, className: 'card-description', placeholder: 'Add a note…' }));
      const tools = element('div', 'card-tools'); const handle = button('⠿', 'Drag card', () => {}, 'icon-button block-drag'); handle.style.fontSize = '12px'; draggable(handle, { kind: 'card', blockId: b.id, cardId: card.id, columnId: col.id });
      const select = element('select', 'card-move'); select.setAttribute('aria-label', 'Move card to column');
      b.columns.forEach(c => { const o = element('option'); o.value = c.id; o.textContent = `→ ${c.title || 'Untitled'}`; select.append(o); }); select.value = col.id;
      select.addEventListener('change', () => action('card_move', { blockId: b.id, cardId: card.id, columnId: select.value }));
      tools.append(handle, select, rowsControls(() => action('card_move', { blockId: b.id, cardId: card.id, columnId: col.id, index: i - 1 }), () => action('card_move', { blockId: b.id, cardId: card.id, columnId: col.id, index: i + 1 }), () => action('card_remove', { blockId: b.id, cardId: card.id }), i === 0, i === col.cards.length - 1, 'card'));
      el.append(tools); dropTarget(el, data => data.kind === 'card' && data.blockId === b.id && data.cardId !== card.id, data => { let index = i; if (data.columnId === col.id && col.cards.findIndex(c => c.id === data.cardId) < i) index--; action('card_move', { blockId: b.id, cardId: data.cardId, columnId: col.id, index }); }); cards.append(el);
    });
    const add = button('+ Add a card', 'Add card to column', () => { const r = action('card_add', { blockId: b.id, columnId: col.id }); if (r) requestAnimationFrame(() => document.getElementById(r.cardId)?.focus()); }, 'add-inline');
    dropTarget(cards, data => data.kind === 'card' && data.blockId === b.id, data => action('card_move', { blockId: b.id, cardId: data.cardId, columnId: col.id }));
    dropTarget(column, data => data.kind === 'column' && data.blockId === b.id && data.columnId !== col.id, data => action('column_move', { blockId: b.id, columnId: data.columnId, index: ci })); column.append(cards, add); board.append(column);
  }); shell.append(board);
}

const options = [
  ['text', null, 'T', 'Text', 'An idea, a note, anything'], ['heading', null, 'H', 'Heading', 'Give a thought its own space'],
  ['checklist', null, '☑', 'Checklist', 'Little things, checked off'], ['tabs', 'horizontal', '▤', 'Horizontal tabs', 'Chapters, side by side'],
  ['tabs', 'vertical', '▥', 'Vertical tabs', 'A tidy list of spaces'], ['toggle', null, '▸', 'Expandable block', 'Tuck a thought away'],
  ['accordion', null, '≡', 'Accordion', 'A few collapsible sections'], ['reminder', null, '◴', 'Reminder', 'A gentle nudge for later'],
  ['kanban', null, '▦', 'Kanban board', 'Keep things moving'], ['divider', null, '—', 'Divider', 'A little breathing room'],
  ['mermaid',null,'◇','Mermaid','Markdown to a diagram'],['excalidraw',null,'✎','Excalidraw','A canvas for your thoughts']
];
export function openPicker(containerId = 'page') {
  pickerTarget = containerId; const allowed = allowedTypes(store.getState(), containerId); const grid = $('#picker-options'); grid.replaceChildren();
  for (const [type, orientation, glyph, name, caption] of options) {
    if (!allowed.types.includes(type) || type === 'tabs' && allowed.tabOrientation && allowed.tabOrientation !== orientation) continue;
    const btn = button('', `Add ${name.toLowerCase()}`, () => {
      const input = { type, containerId: pickerTarget }; if (orientation) input.orientation = orientation;
      const r = action('add_block', input); if (r) { $('#picker').close(); requestAnimationFrame(() => document.querySelector(`[data-block-id="${CSS.escape(r.blockId)}"] input,[data-block-id="${CSS.escape(r.blockId)}"] textarea`)?.focus()); }
    }, 'picker-option'); const glyphIcon=icon(type==='tabs'&&orientation==='vertical'?'vertical':type);glyphIcon.classList.add('glyph');
    const body = element('span'); const strong = element('strong'); strong.textContent = name; const small = element('small'); small.textContent = caption; body.append(strong, small); btn.append(glyphIcon, body); grid.append(btn);
  }
  if (!$('#picker').open) $('#picker').showModal();
}
function applyTheme(theme) {
  const resolved = theme === 'system' ? themeQuery.matches ? 'dark' : 'light' : theme;
  const changed=document.documentElement.dataset.theme!==resolved;
  document.documentElement.dataset.theme = resolved; document.querySelector('meta[name=theme-color]').content = resolved === 'dark' ? '#191b1a' : '#ffffff';
  if(changed)diagrams?.themeChanged();
}
let renderPageId;
function render(state, { quiet = false, reminderBlockId, reminderPageId, changedBlockId, changedPageId } = {}) {
  applyTheme(state.theme); $('#theme').value = state.theme; $('#notification-mode').value = state.notificationMode;
  $('#save-status').replaceChildren(); const dot = element('span', 'status-dot'); $('#save-status').append(dot, document.createTextNode('Saved'));
  $('#undo-button').disabled = !store.canUndo(); $('#redo-button').disabled = !store.canRedo();
  diagrams?.syncHeader(); if (quiet) {
    if(changedBlockId && changedPageId===state.id)renderer.accept(changedBlockId,findBlock(state,changedBlockId).block);
    if(reminderBlockId && reminderPageId===state.id) { const badge=document.querySelector(`[data-block-id="${CSS.escape(reminderBlockId)}"] .reminder-status`);if(badge)badge.textContent='Delivered'; }
    return;
  }
  if($('#block-actions-dialog').open)$('#block-actions-dialog').close();
  if($('#page-actions-dialog').open)$('#page-actions-dialog').close();
  // Preserve cursor and scroll when a command updates the rest of the page.
  const focused = document.activeElement; const focusId = focused?.id; const selection = focused?.selectionStart == null ? null : [focused.selectionStart, focused.selectionEnd];
  const scroll = [scrollX, scrollY];
  for(const [selector,value] of [['#page-title',state.title],['#page-subtitle',state.subtitle]]){const el=$(selector);if(el.value!==value){el.value=value;fit(el);}}
  renderPageId=state.id;diagrams?.begin();renderer.begin(state.id);
  reconcile($('#notebook'),[renderer.list(state.blocks,'page')]);renderer.end();diagrams?.end();
  for(const el of document.querySelectorAll('[data-autofit],.auto-height'))if(!el.dataset.fitted){fit(el);el.dataset.fitted='true';}
  if (focusId) { const next = document.getElementById(focusId); if (next) { next.focus({ preventScroll: true }); if (selection && next.setSelectionRange) next.setSelectionRange(...selection); } }
  scrollTo(...scroll);
}
export function downloadJson(raw, filename = `omd-${new Date().toISOString().slice(0, 10)}.json`) {
  diagrams?.flushAll(); raw ??= store.export();
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' })); const a = element('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function openSettings() {
  shell?.closeMobile();$('#page-menu').open=false;
  $('#permission-state').textContent = !('Notification' in window) ? 'Notifications unavailable' : `Permission: ${Notification.permission}`;
  $('#enable-notifications').disabled = !('Notification' in window) || Notification.permission === 'granted';
  if (!$('#settings-dialog').open) $('#settings-dialog').showModal();
}
export async function deliverReminder(reminder, mode) {
  notify(`Reminder: ${reminder.title}`, 'reminder', true);
  if (mode === 'alert') { window.alert(`omd · ${reminder.title}`); return; }
  if (mode !== 'notification') return;
  if (!('Notification' in window) || Notification.permission !== 'granted') { notify('Enable browser notifications in Settings for system reminders.', '', true); return; }
  try {
    const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (registration) await registration.showNotification('omd · a gentle nudge', { body: reminder.title, icon: './icon.svg', tag: `omd-${reminder.id}`, data: { url: new URL('./', location.href).href } });
    else new Notification('omd · a gentle nudge', { body: reminder.title, icon: './icon.svg', tag: `omd-${reminder.id}` });
  } catch { notify('System notification unavailable. Your reminder is shown here.', '', true); }
}
function startupError(error) {
  document.body.replaceChildren(); const box = element('main', 'startup-error'); const h = element('h1'); h.textContent = 'Your notebook needs a moment.'; const p = element('p'); p.textContent = error.message;
  const backup = button('Download saved data', 'Download saved data', () => { try { downloadJson(localStorage.getItem(STORAGE_KEY) ?? '', 'omd-recovery.json'); } catch { location.reload(); } }, 'secondary-button');
  box.append(h, p, backup, button('Try again', 'Reload app', () => location.reload(), 'secondary-button')); document.body.append(box);
}
function boot() {
  try { store = createStore(localStorage); } catch (error) { startupError(error); return; }
  for (const close of document.querySelectorAll('[data-close]')) close.addEventListener('click', () => close.closest('dialog').close());
  for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', e => { if (e.target === dialog) { const rect = dialog.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) dialog.close(); } });
  diagrams=createDiagramManager(store,{notify});
  renderer=createRenderCache({makeBlock:renderBlock,makeList:makeBlockList});
  shell=setupShell(store,{beforeNavigate:()=>diagrams.beforeNavigate(),openPalette,confirm:confirmAction,onError:error=>notify(error.message,'error',true)});
  store.subscribe(render); render(store.getState());
  palette = setupPalette(store, { onError: error => notify(error.message, 'error', true), beforeOpen:()=>shell.closeMobile(), beforeNavigate:()=>diagrams.beforeNavigate() });
  let fitFrame;window.addEventListener('resize',()=>{cancelAnimationFrame(fitFrame);fitFrame=requestAnimationFrame(()=>{for(const el of document.querySelectorAll('[data-autofit],.auto-height'))fit(el);});});
  $('#canvas-stage-close').addEventListener('click',closeCanvas);$('#canvas-stage-pages').addEventListener('click',openPalette);
  window.addEventListener('pagehide',flushDiagrams);window.addEventListener('beforeunload',flushDiagrams);
  for (const [selector, key] of [['#page-title', 'title'], ['#page-subtitle', 'subtitle']]) {
    const el = $(selector); let composing = false;
    const write = () => { action('set_page', { [key]: el.value }, { quiet: true }); fit(el); };
    el.addEventListener('compositionstart', () => { composing = true; }); el.addEventListener('compositionend', () => { composing = false; write(); }); el.addEventListener('input', () => { if (!composing) write(); });
  }
  $('#theme').addEventListener('change', e => action('set_page', { theme: e.target.value })); themeQuery.addEventListener('change', () => applyTheme(store.getState().theme));
  $('#notification-mode').addEventListener('change', e => action('set_page', { notificationMode: e.target.value }));
  $('#undo-button').addEventListener('click', () => { try { diagrams.flushAll();store.undo(); } catch (e) { notify(e.message, 'error'); } });
  $('#redo-button').addEventListener('click', () => { try { diagrams.flushAll();store.redo(); } catch (e) { notify(e.message, 'error'); } });
  $('#export-button').addEventListener('click', () => { $('#page-menu').open=false;downloadJson(); notify('Notebook exported.'); });
  $('#import-button').addEventListener('click', () => {$('#page-menu').open=false;$('#import-file').click();});
  $('#import-file').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    try { const raw = await file.text(); const { parseBook } = await import('./notebook.js'); parseBook(raw);
      if (await confirmAction('Replace this notebook?', 'All current pages will be exported as a backup before importing. Import replaces the entire notebook, page order and settings.', 'Back up & import')) { diagrams.beforeNavigate();downloadJson(store.export(), `omd-before-import-${Date.now()}.json`); store.import(raw); notify('Notebook imported.'); }
    } catch (error) { notify(error.message, 'error', true); }
  });
  $('#settings-button').addEventListener('click', openSettings); $('#sidebar-settings').addEventListener('click', openSettings); $('#agent-status').addEventListener('click', openSettings);
  $('#enable-notifications').addEventListener('click', async () => { try { if ('Notification' in window) { await Notification.requestPermission(); openSettings(); } } catch (e) { notify(e.message, 'error'); } });
  $('#test-notification').addEventListener('click', () => deliverReminder({ id: 'test', title: 'A little nudge. Your reminders are ready.' }, store.getState().notificationMode));
  $('#persist-storage').addEventListener('click', async () => { try { const kept = await navigator.storage?.persist?.(); $('#storage-state').textContent = kept ? ' Persistent storage granted.' : ' Browser did not grant persistent storage. Keep exports.'; } catch { $('#storage-state').textContent = ' Not supported by this browser.'; } });
  window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) { try { store.reload(); } catch (e) { notify(e.message, 'error', true); } } });
  const reminders = startReminders(store, { deliver: deliverReminder, onError: e => notify(e.message, 'error', true) });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reminders.tick(); }); window.addEventListener('pageshow', () => reminders.tick()); setTimeout(() => reminders.tick(), 800);
  // Used by the PWA/WebMCP integration in the next stack layer.
  window.dispatchEvent(new CustomEvent('omd:ready', { detail: { store } }));
}
boot();
export const getStore = () => store;
