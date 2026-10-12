import {errorOf} from './dom.js';
import type {NotebookStore,Block,BlockType,BlockOf,CommandName,CommandInput,MutationResult,Page,ChangeEvent,PartialView,Notify,NotificationMode,ReminderBlock,BlockOptions,ChecklistItem} from './types.js';
import {byId as domId} from './dom.js';
import { createCompositionGuard } from './composition.js';
import { createStore } from './store.js';
import { STORAGE_KEY, allowedTypes, findBlock, findContainer, MAX_CHECKLIST_LEVELS, checklistHeight } from './model.js';
import { startReminders } from './reminders.js';
import { setupPalette } from './palette.js';
import { createDiagramManager } from './diagrams.js';
import { createRenderCache, reconcile, revealActions } from './render-cache.js';
import { setupShell, showMenu } from './shell.js';
import { icon, labelIcon } from './icons.js';
import {createTextEditors} from './text-editors.js';

function $<T extends HTMLElement=HTMLElement>(selector:string):T {if(selector.startsWith('#'))return domId<T>(selector.slice(1));const node=document.querySelector<T>(selector);if(!node)throw new Error(`Missing element: ${selector}`);return node;}
let store:NotebookStore,palette:ReturnType<typeof setupPalette>|undefined,diagrams:ReturnType<typeof createDiagramManager>|undefined,renderer:ReturnType<typeof createRenderCache>,shell:ReturnType<typeof setupShell>|undefined,dragData:DragData|null|undefined;
let textEditors:ReturnType<typeof createTextEditors>|undefined;
interface InsertionAnchor {blockId:string;side:'before'|'after'}
interface DragData {containerId?:string;kind:'block'|'card'|'column';blockId:string;cardId?:string;columnId?:string}
export const openPalette = () => {shell?.closeMobile();palette?.open();};
export const getView = () => shell!.getView();
export const setView = async (patch:PartialView) => {if(patch.sidebarOpen)await beforeNavigate();return shell!.setView(patch);};
export async function flushPending(){await textEditors?.flushAll();await diagrams?.flushAll();}
export const flushDiagrams=flushPending;
async function beforeNavigate(){await textEditors?.flushAll();await diagrams?.beforeNavigate();}
export async function openCanvas(blockId:string,pageId?:string) {
  const page=await store.getPage(pageId);findBlock(page,blockId,'excalidraw');await flushPending();
  shell?.closeMobile();
  if(page.id!==store.getActivePageId())await store.dispatch('page_select',{pageId:page.id});
  for(const [name,input] of revealActions(page.blocks,blockId)! )await store.dispatch(name,input);
  diagrams!.openFocus(blockId);
}
export const closeCanvas = async () => {await flushPending();diagrams?.closeFocus();};
let deferredRender=false;
const composition=createCompositionGuard({onSettled:()=>{if(deferredRender){deferredRender=false;render(store.getRenderState(),{reset:true});}}});
const themeQuery = matchMedia('(prefers-color-scheme: dark)');
export function notify(message:string,kind = '', persistent = false) {
  const el = element('div', `notice ${kind}`); const text = element('span'); text.textContent = message;
  const close = button('×', 'Dismiss message', () => el.remove()); el.append(text, close); domId('notices').append(el);
  if (!persistent) setTimeout(() => el.remove(), kind === 'error' ? 12000 : 5000);
}
function element<T extends keyof HTMLElementTagNameMap>(tag:T,className = '') { const el = document.createElement(tag); el.className = className; return el; }
function button(label:string,aria:string,fn:(event:MouseEvent)=>unknown,className = 'icon-button') {
  const b = element('button', className); b.type = 'button'; if(labelIcon[label])b.append(icon(labelIcon[label]));else b.textContent=label; b.title = aria; b.setAttribute('aria-label', aria); b.addEventListener('click', fn); return b;
}
async function action<K extends CommandName>(name:K,input:CommandInput<K>,{quiet=false,focus}: {quiet?:boolean;focus?:string}={}):Promise<MutationResult<K>|null> {
  try { input={...input,pageId:input.pageId??store.getActivePageId()}; domId('save-status').textContent='Saving…'; if(!quiet)await flushPending(); const result = await store.dispatch(name, input, { quiet }); if (focus) requestAnimationFrame(()=>document.getElementById(focus)?.focus()); return result; }
  catch (error) { domId('save-status').textContent = 'Not saved'; notify(errorOf(error).message, 'error', true); return null; }
}
function editable(value:string,aria:string,fn:(value:string,pageId:string)=>unknown,{multiline=false,className='',placeholder='',id}: {multiline?:boolean;className?:string;placeholder?:string;id?:string}={}) {
  const input=multiline?element('textarea',className):element('input',className);if(input instanceof HTMLInputElement)input.type='text';else input.rows=1;
  input.value = value; input.placeholder = placeholder; input.setAttribute('aria-label', aria); if (id) input.id = id;
  const pageId=store.getActivePageId();
  function write() { const result=fn(input.value,pageId); if(multiline)fit(input);return result; }
  composition.track(input,write,()=>pageId);
  input.addEventListener('input',()=>{if(!composition.isComposing(input))write();});
  if (multiline) input.dataset.autofit = 'true'; return input;
}
function fit(el:HTMLElement) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }
async function createTextAfter(blockId:string,pageId:string) {
  await flushPending();
  const page=store.getRenderState();if(page.id!==pageId)return;
  const source=findBlock(page,blockId),containerId=renderer.containerFor(blockId);
  if(!containerId)throw new Error('The editing block is no longer visible.');
  const result=await store.dispatch('add_block',{pageId,type:'text',containerId,index:source.siblings.findIndex(block=>block.id===blockId)+1});
  if(store.getActivePageId()===pageId)textEditors!.focus(result.blockId);
}
function title(b:Extract<Block,{title:string}>,glyph:string) {
  const head = element('div', 'block-heading'); const glyphIcon=icon(b.type);glyphIcon.classList.add('type-glyph');
  head.append(glyphIcon, editable(b.title, `${b.type} title`, (value,pageId) => action('update_block', { pageId, blockId: b.id, patch: { title: value } }, { quiet: true }), { className: 'block-title', placeholder: 'Untitled' })); return head;
}
function rowsControls(onUp:()=>unknown,onDown:()=>unknown,onRemove:()=>unknown,upDisabled:boolean,downDisabled:boolean,label:string) {
  const tools = element('div', 'row-controls');
  const up = button('↑', `Move ${label} up`, onUp); up.disabled = upDisabled;
  const down = button('↓', `Move ${label} down`, onDown); down.disabled = downDisabled;
  tools.append(up, down, button('×', `Delete ${label}`, onRemove, 'icon-button delete')); return tools;
}
export async function confirmAction(title:string,message:string,yes = 'Continue') {
  const dialog = domId('confirm-dialog'); if (dialog.open) return false;
  domId('confirm-title').textContent = title; domId('confirm-message').textContent = message; domId('confirm-ok').textContent = yes;
  return new Promise<boolean>(resolve => {
    let approved = false;
    const accept = () => { approved = true; dialog.close(); }; const cancel = () => dialog.close();
    const finish = () => { domId('confirm-ok').removeEventListener('click', accept); domId('confirm-cancel').removeEventListener('click', cancel); resolve(approved); };
    domId('confirm-ok').addEventListener('click', accept); domId('confirm-cancel').addEventListener('click', cancel); dialog.addEventListener('close', finish, { once: true }); dialog.showModal();
  });
}
function draggable(handle:HTMLElement,data:DragData) {
  handle.draggable = true; handle.addEventListener('dragstart', event => { event.stopPropagation(); dragData = data; event.dataTransfer!.effectAllowed = 'move'; event.dataTransfer!.setData('application/x-omd', JSON.stringify(data)); handle.closest('.block,.kanban-card,.kanban-column')?.classList.add('dragging'); if (data.kind === 'block') document.body.classList.add('dragging-block'); });
  handle.addEventListener('dragend', () => { dragData = null; document.body.classList.remove('dragging-block'); for (const el of document.querySelectorAll('.dragging,.drop-active')) el.classList.remove('dragging', 'drop-active'); });
}
function dropTarget(el:HTMLElement,canDrop:(data:DragData)=>boolean,drop:(data:DragData)=>unknown) {
  el.addEventListener('dragover', event => { if (dragData && canDrop(dragData)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer!.dropEffect = 'move'; el.classList.add('drop-active'); } });
  el.addEventListener('dragleave', event => { if (!el.contains(event.relatedTarget as Node|null)) el.classList.remove('drop-active'); });
  el.addEventListener('drop', event => { if (dragData && canDrop(dragData)) { event.preventDefault(); event.stopPropagation(); el.classList.remove('drop-active'); drop(dragData); } });
}

function makeBlockList(blocks:Block[],containerId:string,nodes:HTMLElement[]) {
  const list = element('div', 'block-list'); list.dataset.container = containerId;
  function slot(index:number) {
    const el = element('div', 'drop-slot');
    if (index < blocks.length) {
      const blockId=blocks[index].id;
      el.classList.add('insert-slot');
      const insert=button('Add block','Insert block here',()=>openPicker(containerId,{blockId,side:'before'}),'block-insert-button');
      insert.prepend(icon('plus'));insert.dataset.beforeBlock=blockId;el.append(insert);
    } else el.setAttribute('aria-hidden', 'true');
    dropTarget(el, data => data.kind === 'block', data => {
      const source = findBlock(store.getRenderState(), data.blockId); let targetIndex = index;
      if (source.siblings.some(b => b.id === data.blockId) && data.containerId === containerId && source.siblings.findIndex(b => b.id === data.blockId) < index) targetIndex--;
      action('move_block', { blockId: data.blockId, containerId, index: targetIndex });
    }); return el;
  }
  const children=[];nodes.forEach((node, i) => { children.push(slot(i), node); }); children.push(slot(blocks.length));
  const add = button('Add a block', 'Add a block here', () => openPicker(containerId), 'add-block-button'); children.push(add);
  dropTarget(add, data => data.kind === 'block', data => action('move_block', { blockId: data.blockId, containerId })); return {node:list,children};
}
function renderBlock(b:Block,containerId:string,index:number,count:number) {
  const shell = element('section', `block block-type-${b.type}`); shell.dataset.blockId = b.id;
  const controls = element('div', 'block-controls'); const handle = button('⠿', 'Drag block', () => {}, 'icon-button block-drag'); draggable(handle, { kind: 'block', blockId: b.id, containerId });
  const more=button('…','Block actions',()=>{
    const current=findBlock(store.getRenderState(),b.id),position=current.siblings.findIndex(block=>block.id===b.id);
    showMenu('block-actions-dialog','Block actions',[
      {label:'Insert block before',icon:'plus',run:()=>openPicker(containerId,{blockId:b.id,side:'before'})},
      {label:'Insert block after',icon:'plus',run:()=>openPicker(containerId,{blockId:b.id,side:'after'})},
      {label:'Move block up',icon:'up',disabled:position===0,run:()=>action('move_block',{blockId:b.id,containerId,index:position-1},{focus:`${b.id}-menu`})},
      {label:'Move block down',icon:'down',disabled:position===current.siblings.length-1,run:()=>action('move_block',{blockId:b.id,containerId,index:position+1},{focus:`${b.id}-menu`})},
      {label:'Delete block',icon:'trash',danger:true,run:async()=>{if(await confirmAction('Remove this block?','This removes the block and everything inside it. You can undo this change.','Remove'))action('remove_block',{blockId:b.id});}},
    ],more);
  });more.id=`${b.id}-menu`;controls.append(handle,more);
  shell.append(controls);
  switch (b.type) {
    case 'text': shell.append(textEditors!.mount(b,renderPageId));break;
    case 'heading': {
      const pageId=renderPageId,text=editable(b.text,'heading content',(value,pageId)=>action('update_block',{pageId,blockId:b.id,patch:{text:value}},{quiet:true}),{multiline:true,placeholder:'A new section',id:`${b.id}-text`});
      text.addEventListener('keydown',event=>{const key=event as KeyboardEvent;if(key.key==='Enter'&&key.shiftKey&&!key.ctrlKey&&!key.metaKey&&!key.altKey&&!key.isComposing&&!composition.isComposing(text)){key.preventDefault();if(!key.repeat)void createTextAfter(b.id,pageId).catch(error=>notify(errorOf(error).message,'error',true));}});shell.append(text);break;
    }
    case 'divider': shell.append(element('hr')); break;
    case 'checklist': renderChecklist(shell, b); break;
    case 'tabs': renderTabs(shell, b); break;
    case 'toggle': renderToggle(shell, b); break;
    case 'accordion': renderAccordion(shell, b); break;
    case 'reminder': renderReminder(shell, b); break;
    case 'kanban': renderKanban(shell, b); break;
    case 'mermaid': {
      shell.append(title(b,'◇'),editable(b.source,'Mermaid Markdown source',async (value,pageId)=>{if(await action('update_block',{pageId,blockId:b.id,patch:{source:value}},{quiet:true}))diagrams!.updateSource(b.id,value);},{multiline:true,className:'mermaid-source',id:`${b.id}-source`,placeholder:'flowchart LR\n  A --> B'}),diagrams!.mount(b,renderPageId)); break;
    }
    case 'excalidraw': {
      const head=title(b,'✎');head.append(button('↗ Full page','Open canvas full page',()=>openCanvas(b.id), 'add-inline'));
      const placeholder=element('div','canvas-placeholder');placeholder.dataset.canvasPlaceholder=b.id;placeholder.append(diagrams!.mount(b,renderPageId));shell.append(head,placeholder); break;
    }
  }
  return shell;
}
function renderChecklist(shell:HTMLElement,b:BlockOf<'checklist'>) {
  let total=0,done=0;
  async function addItem(parentId?:string,index?:number) {const result=await action('checklist_add',{blockId:b.id,parentId,index});if(result)requestAnimationFrame(()=>domId(result.itemId)?.focus());}
  function renderItems(items:ChecklistItem[],ancestors:ChecklistItem[]=[]):HTMLElement {
    const list=element('div','checklist-items');list.setAttribute('role','list');
    items.forEach((item,index)=>{
      total++;if(item.done)done++;
      const parent=ancestors.at(-1),level=ancestors.length+1;
      const entry=element('div','checklist-item');entry.setAttribute('role','listitem');entry.dataset.itemId=item.id;entry.dataset.level=String(level);
      const row=element('div',`check-row ${item.done?'done':''}`),check=element('input');check.type='checkbox';check.checked=item.done;check.setAttribute('aria-label',`Complete ${item.text||'item'}`);
      check.addEventListener('change',()=>action('checklist_update',{blockId:b.id,itemId:item.id,patch:{done:check.checked}}));
      const text=editable(item.text,'Checklist item',(value,pageId)=>action('checklist_update',{pageId,blockId:b.id,itemId:item.id,patch:{text:value}},{quiet:true}),{placeholder:'A little thing to do',id:item.id});
      text.setAttribute('aria-keyshortcuts','Enter Tab Shift+Tab');
      const canIndent=index>0&&level+checklistHeight(item)<=MAX_CHECKLIST_LEVELS;
      const indent=()=>action('checklist_move',{blockId:b.id,itemId:item.id,parentId:items[index-1].id,index:items[index-1].children?.length??0},{focus:item.id});
      const outdent=()=>{
        const grandparent=ancestors.at(-2),siblings=grandparent?.children??b.items;
        return action('checklist_move',{blockId:b.id,itemId:item.id,parentId:grandparent?.id??'',index:siblings.findIndex(sibling=>sibling.id===parent!.id)+1},{focus:item.id});
      };
      text.addEventListener('keydown',event=>{
        const key=event as KeyboardEvent;if(key.isComposing||composition.isComposing(text)||key.ctrlKey||key.metaKey||key.altKey)return;
        if(key.key==='Enter'){key.preventDefault();void addItem(parent?.id,index+1);}
        if(key.key==='Tab'&&((key.shiftKey&&parent)||(!key.shiftKey&&canIndent))){key.preventDefault();void (key.shiftKey?outdent():indent());}
      });
      const controls=rowsControls(()=>action('checklist_move',{blockId:b.id,itemId:item.id,index:index-1},{focus:item.id}),()=>action('checklist_move',{blockId:b.id,itemId:item.id,index:index+1},{focus:item.id}),()=>action('checklist_remove',{blockId:b.id,itemId:item.id}),index===0,index===items.length-1,'checklist item');
      const more=button('…','Checklist item actions',()=>showMenu('block-actions-dialog','Checklist item actions',[
        {label:'Add child checklist item',icon:'plus',disabled:level>=MAX_CHECKLIST_LEVELS,run:()=>addItem(item.id)},
        {label:'Indent checklist item',icon:'right',disabled:!canIndent,run:indent},
        {label:'Outdent checklist item',icon:'left',disabled:!parent,run:outdent}
      ],more));more.id=`${item.id}-menu`;controls.prepend(more);
      row.append(check,text,controls);entry.append(row);if(item.children?.length)entry.append(renderItems(item.children,[...ancestors,item]));list.append(entry);
    });return list;
  }
  const head=title(b,'☑'),progress=element('span','checklist-progress'),items=renderItems(b.items);progress.textContent=`${done} / ${total}`;head.append(progress);shell.append(head,items);
  shell.append(button('+ Add an item', 'Add checklist item', async () => { const r = await action('checklist_add', { blockId: b.id }); if (r) requestAnimationFrame(() => domId(r.itemId)?.focus()); }, 'add-inline'));
}
function renderTabs(shell:HTMLElement,b:BlockOf<'tabs'>) {
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
  const t = b.tabs.find(t => t.id === b.activeTabId)!; const panel = element('div', 'tab-panel'); panel.id = `${t.id}-panel`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `${t.id}-button`);
  const edit = element('div', 'tab-editbar'); const i = b.tabs.indexOf(t);
  edit.append(editable(t.title, 'Rename active tab', (value,pageId) => {
    const saved=action('tab_update', { pageId,blockId: b.id, tabId: t.id, title: value }, { quiet: true }); domId(`${t.id}-button`).textContent = value || 'Untitled';return saved;
  }, { className: 'tab-label-edit', placeholder: 'Tab name' }), rowsControls(() => action('tab_move', { blockId: b.id, tabId: t.id, index: i - 1 }), () => action('tab_move', { blockId: b.id, tabId: t.id, index: i + 1 }), async () => { if (b.tabs.length > 1 && await confirmAction('Remove this tab?', 'Everything inside this tab will be removed. You can undo it.', 'Remove tab')) action('tab_remove', { blockId: b.id, tabId: t.id }); }, i === 0, i === b.tabs.length - 1, 'tab'));
  edit.querySelector<HTMLElement>('.row-controls')!.style.opacity = '1'; if (b.tabs.length === 1) edit.querySelector<HTMLButtonElement>('.delete')!.disabled = true;
  panel.append(edit, renderer.childList(t.id)); layout.append(tablist, panel); group.append(layout); shell.append(group);
}
function renderToggle(shell:HTMLElement,b:BlockOf<'toggle'>) {
  const head = element('div', 'toggle-head'); const arrow = button(b.open ? '▾' : '▸', `${b.open ? 'Collapse' : 'Expand'} ${b.title}`, () => action('update_block', { blockId: b.id, patch: { open: !b.open } }), 'toggle-arrow'); arrow.setAttribute('aria-expanded', String(b.open)); arrow.setAttribute('aria-controls', `${b.id}-content`);
  head.append(arrow, editable(b.title, 'Expandable block title', (value,pageId) => action('update_block', { pageId, blockId: b.id, patch: { title: value } }, { quiet: true }), { className: 'block-title' })); shell.append(head);
  if (b.open) { const content = element('div', 'toggle-content'); content.id = `${b.id}-content`; content.append(renderer.childList(b.id)); shell.append(content); }
}
function renderAccordion(shell:HTMLElement,b:BlockOf<'accordion'>) {
  shell.append(title(b, '≡')); const group = element('div', 'accordion');
  b.items.forEach((item, i) => {
    const part = element('div', 'accordion-item'); const head = element('div', 'accordion-head'); const arrow = button(item.open ? '▾' : '▸', `${item.open ? 'Collapse' : 'Expand'} ${item.title}`, () => action('accordion_update', { blockId: b.id, itemId: item.id, patch: { open: !item.open } }), 'toggle-arrow'); arrow.setAttribute('aria-expanded', String(item.open)); arrow.setAttribute('aria-controls', `${item.id}-content`);
    head.append(arrow, editable(item.title, 'Accordion item title', (value,pageId) => action('accordion_update', { pageId, blockId: b.id, itemId: item.id, patch: { title: value } }, { quiet: true }), { className: 'block-title' }), rowsControls(() => action('accordion_move', { blockId: b.id, itemId: item.id, index: i - 1 }), () => action('accordion_move', { blockId: b.id, itemId: item.id, index: i + 1 }), async () => { if (await confirmAction('Remove this section?', 'Its contents will be removed too. You can undo it.', 'Remove')) action('accordion_remove', { blockId: b.id, itemId: item.id }); }, i === 0, i === b.items.length - 1, 'accordion section'));
    part.append(head); if (item.open) { const content = element('div', 'accordion-content'); content.id = `${item.id}-content`; content.append(renderer.childList(item.id)); part.append(content); } group.append(part);
  }); shell.append(group, button('+ Add a section', 'Add accordion section', () => action('accordion_add', { blockId: b.id }), 'add-inline'));
}
function toLocalDateTime(iso:string) { if (!iso) return ''; const d = new Date(iso); const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16); }
function renderReminder(shell:HTMLElement,b:BlockOf<'reminder'>) {
  const box = element('div', 'reminder-box'); const reminderIcon=icon('reminder');reminderIcon.classList.add('reminder-icon');
  const body = element('div', 'reminder-body'); body.append(editable(b.title, 'Reminder text', (value,pageId) => action('update_block', { pageId, blockId: b.id, patch: { title: value } }, { quiet: true }), { className: 'block-title' }));
  const dateRow = element('div', 'reminder-date'); const input = element('input'); input.type = 'datetime-local'; input.value = toLocalDateTime(b.dueAt); input.setAttribute('aria-label', 'Reminder date and time');
  input.addEventListener('change', () => { const dueAt = input.value ? new Date(input.value).toISOString() : ''; action('update_block', { blockId: b.id, patch: { dueAt, enabled: !!dueAt } }); });
  const status = element('span', 'reminder-status'); status.textContent = b.firedAt ? 'Delivered' : !b.enabled ? 'Off' : Date.parse(b.dueAt) <= Date.now() ? 'Due' : 'Scheduled'; dateRow.append(input, status); body.append(dateRow);
  const label = element('label', 'reminder-enable'); const enabled = element('input'); enabled.type = 'checkbox'; enabled.checked = b.enabled; enabled.disabled = !b.dueAt; enabled.addEventListener('change', () => action('update_block', { blockId: b.id, patch: { enabled: enabled.checked } })); label.append(enabled, document.createTextNode('On')); box.append(reminderIcon, body, label); shell.append(box);
  const note = element('p', 'reminder-note'); note.textContent = 'While open, or when you return. Notification settings ↗'; note.append(button('Settings', 'Reminder settings', () => openSettings(), 'link-button')); shell.append(note);
}
function renderKanban(shell:HTMLElement,b:BlockOf<'kanban'>) {
  const head = title(b, '▥'); head.append(button('+ Column', 'Add board column', () => action('column_add', { blockId: b.id }), 'add-inline')); shell.append(head);
  const board = element('div', 'kanban-board');
  b.columns.forEach((col, ci) => {
    const column = element('section', 'kanban-column'); column.setAttribute('aria-label', col.title || 'Kanban column');
    const header = element('div', 'column-header'); const dot = element('span', 'column-dot'); dot.setAttribute('aria-hidden', 'true');
    const handle = button('⠿', 'Drag column', () => {}, 'icon-button block-drag'); handle.style.fontSize = '12px'; handle.style.minWidth = '17px'; draggable(handle, { kind: 'column', blockId: b.id, columnId: col.id });
    const count = element('span', 'card-count'); count.textContent=String(col.cards.length);
    header.append(dot, editable(col.title, 'Column title', (value,pageId) => action('column_update', { pageId, blockId: b.id, columnId: col.id, title: value }, { quiet: true }), { className: 'column-title' }), count, handle,
      rowsControls(() => action('column_move', { blockId: b.id, columnId: col.id, index: ci - 1 }), () => action('column_move', { blockId: b.id, columnId: col.id, index: ci + 1 }), async () => { if (await confirmAction('Remove this column?', `${col.cards.length} card(s) in this column will also be removed. You can undo it.`, 'Remove column')) action('column_remove', { blockId: b.id, columnId: col.id }); }, ci === 0, ci === b.columns.length - 1, 'column'));
    column.append(header); const cards = element('div', 'cards');
    col.cards.forEach((card, i) => {
      const el = element('div', 'kanban-card'); el.dataset.cardId = card.id;
      el.append(editable(card.title, 'Card title', (value,pageId) => action('card_update', { pageId, blockId: b.id, cardId: card.id, patch: { title: value } }, { quiet: true }), { multiline: true, className: 'card-title', placeholder: 'A small next step', id: card.id }), editable(card.description, 'Card description', (value,pageId) => action('card_update', { pageId, blockId: b.id, cardId: card.id, patch: { description: value } }, { quiet: true }), { multiline: true, className: 'card-description', placeholder: 'Add a note…' }));
      const tools = element('div', 'card-tools'); const handle = button('⠿', 'Drag card', () => {}, 'icon-button block-drag'); handle.style.fontSize = '12px'; draggable(handle, { kind: 'card', blockId: b.id, cardId: card.id, columnId: col.id });
      const select = element('select', 'card-move'); select.setAttribute('aria-label', 'Move card to column');
      b.columns.forEach(c => { const o = element('option'); o.value = c.id; o.textContent = `→ ${c.title || 'Untitled'}`; select.append(o); }); select.value = col.id;
      select.addEventListener('change', () => action('card_move', { blockId: b.id, cardId: card.id, columnId: select.value }));
      tools.append(handle, select, rowsControls(() => action('card_move', { blockId: b.id, cardId: card.id, columnId: col.id, index: i - 1 }), () => action('card_move', { blockId: b.id, cardId: card.id, columnId: col.id, index: i + 1 }), () => action('card_remove', { blockId: b.id, cardId: card.id }), i === 0, i === col.cards.length - 1, 'card'));
      el.append(tools); dropTarget(el, data => data.kind === 'card' && data.blockId === b.id && data.cardId !== card.id, data => { let index = i; if (data.columnId === col.id && col.cards.findIndex(c => c.id === data.cardId) < i) index--; action('card_move', { blockId: b.id, cardId: data.cardId!, columnId: col.id, index }); }); cards.append(el);
    });
    const add = button('+ Add a card', 'Add card to column', async () => { const r = await action('card_add', { blockId: b.id, columnId: col.id }); if (r) requestAnimationFrame(() => domId(r.cardId)?.focus()); }, 'add-inline');
    dropTarget(cards, data => data.kind === 'card' && data.blockId === b.id, data => action('card_move', { blockId: b.id, cardId: data.cardId!, columnId: col.id }));
    dropTarget(column, data => data.kind === 'column' && data.blockId === b.id && data.columnId !== col.id, data => action('column_move', { blockId: b.id, columnId: data.columnId!, index: ci })); column.append(cards, add); board.append(column);
  }); shell.append(board);
}

const options: [BlockType,'horizontal'|'vertical'|null,string,string,string][] = [
  ['text', null, 'T', 'Text', 'An idea, a note, anything'], ['heading', null, 'H', 'Heading', 'Give a thought its own space'],
  ['checklist', null, '☑', 'Checklist', 'Little things, checked off'], ['tabs', 'horizontal', '▤', 'Horizontal tabs', 'Chapters, side by side'],
  ['tabs', 'vertical', '▥', 'Vertical tabs', 'A tidy list of spaces'], ['toggle', null, '▸', 'Expandable block', 'Tuck a thought away'],
  ['accordion', null, '≡', 'Accordion', 'A few collapsible sections'], ['reminder', null, '◴', 'Reminder', 'A gentle nudge for later'],
  ['kanban', null, '▦', 'Kanban board', 'Keep things moving'], ['divider', null, '—', 'Divider', 'A little breathing room'],
  ['mermaid',null,'◇','Mermaid','Markdown to a diagram'],['excalidraw',null,'✎','Excalidraw','A canvas for your thoughts']
];
export function openPicker(containerId = 'page',anchor?:InsertionAnchor) {
  const pageId=store.getActivePageId(),allowed = allowedTypes(store.getRenderState(), containerId);
  const grid = domId('picker-options'); grid.replaceChildren();let adding=false;
  for (const [type, orientation, glyph, name, caption] of options) {
    if (!allowed.types.includes(type) || type === 'tabs' && allowed.tabOrientation && allowed.tabOrientation !== orientation) continue;
    const btn = button('', `Add ${name.toLowerCase()}`, async () => {
      if(adding)return;adding=true;for(const option of grid.querySelectorAll<HTMLButtonElement>('button'))option.disabled=true;
      try {
        const input:CommandInput<'add_block'> = {type,containerId,pageId}; if (orientation) input.orientation = orientation;
        if(anchor){
          const page=store.getRenderState();
          if(page.id!==pageId)throw new Error('The page changed. Close the picker and choose a new position.');
          const blocks=findContainer(page,containerId).blocks;
          const index=blocks.findIndex(block=>block.id===anchor.blockId);
          if(index<0)throw new Error('The block moved or was removed. Close the picker and choose a new position.');
          input.index=index+(anchor.side==='after'?1:0);
        }
        const r = await action('add_block', input);
        if (r) { domId('picker').close(); requestAnimationFrame(() => {
          const block=document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(r.blockId)}"]`);
          (block?.querySelector<HTMLElement>('input,textarea,[contenteditable="true"]')??block?.querySelector<HTMLElement>('.block-controls button:not(.block-drag)'))?.focus();
        }); }
      } catch(error) {notify(errorOf(error).message,'error',true);}
      finally{adding=false;for(const option of grid.querySelectorAll<HTMLButtonElement>('button'))option.disabled=false;}
    }, 'picker-option'); const glyphIcon=icon(type==='tabs'&&orientation==='vertical'?'vertical':type);glyphIcon.classList.add('glyph');
    const body = element('span'); const strong = element('strong'); strong.textContent = name; const small = element('small'); small.textContent = caption; body.append(strong, small); btn.append(glyphIcon, body); grid.append(btn);
  }
  if (!domId('picker').open) domId('picker').showModal();
}
function applyTheme(theme:Page['theme']) {
  const resolved = theme === 'system' ? themeQuery.matches ? 'dark' : 'light' : theme;
  const changed=document.documentElement.dataset.theme!==resolved;
  document.documentElement.dataset.theme = resolved; document.querySelector<HTMLMetaElement>('meta[name=theme-color]')!.content = resolved === 'dark' ? '#191b1a' : '#ffffff';
  if(changed)diagrams?.themeChanged();
  domId('theme').value=theme;
}
let renderPageId:string;
function render(state:Page, { quiet = false, reminderBlockId, reminderPageId, changedBlockId, changedPageId, reset=false }:ChangeEvent={}) {
  if(composition.hasActive()){deferredRender=true;return;}
  applyTheme(shell!.getView().theme); domId('notification-mode').value = state.notificationMode;
  if(renderPageId!==state.id&&domId('picker').open)domId('picker').close();

  domId('undo-button').disabled = !store.canUndo(); domId('redo-button').disabled = !store.canRedo();
  diagrams?.syncHeader(); if (quiet) {
    if(changedBlockId && changedPageId===state.id)renderer.accept(changedBlockId,findBlock(state,changedBlockId).block);
    if(reminderBlockId && reminderPageId===state.id) { const badge=document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(reminderBlockId)}"] .reminder-status`);if(badge)badge.textContent='Delivered'; }
    return;
  }
  if(domId('block-actions-dialog').open)domId('block-actions-dialog').close();
  if(domId('page-actions-dialog').open)domId('page-actions-dialog').close();
  // Preserve cursor and scroll when a command updates the rest of the page.
  const focused=document.activeElement as HTMLInputElement|HTMLTextAreaElement|null; const focusId = focused?.id; const selection = focused?.selectionStart == null ? null : [focused.selectionStart, focused.selectionEnd!] as const;
  const editorFocus=textEditors?.captureFocus()??null;
  const scroll=[scrollX,scrollY] as const;
  for(const [selector,value] of [['#page-title',state.title],['#page-subtitle',state.subtitle]]){const el=$<HTMLInputElement|HTMLTextAreaElement>(selector);if(el.value!==value){el.value=value;fit(el);}}
  if(renderPageId===state.id&&!reset)return;
  renderPageId=state.id;diagrams?.begin();renderer.begin(state.id);
  reconcile(domId('notebook'),[renderer.list(state.blocks,'page')]);renderer.end();diagrams?.end();textEditors?.end();
  for(const el of document.querySelectorAll<HTMLElement>('[data-autofit],.auto-height'))if(!el.dataset.fitted){fit(el);el.dataset.fitted='true';}
  if (focusId) { const next=document.getElementById(focusId) as HTMLInputElement|HTMLTextAreaElement|null; if (next) { next.focus({ preventScroll: true }); if (selection && next.setSelectionRange) next.setSelectionRange(...selection); } }
  textEditors?.restoreFocus(editorFocus);
  scrollTo(...scroll);
}
export async function downloadJson(raw?:string, filename = `omd-${new Date().toISOString().slice(0, 10)}.json`) {
  await flushPending(); raw ??= await store.export();
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' })); const a = element('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function openSettings() {
  shell?.closeMobile();domId('page-menu').open=false;
  domId('permission-state').textContent = !('Notification' in window) ? 'Notifications unavailable' : `Permission: ${Notification.permission}`;
  domId('enable-notifications').disabled = !('Notification' in window) || Notification.permission === 'granted';
  if (!domId('settings-dialog').open) domId('settings-dialog').showModal();
}
export async function deliverReminder(reminder:Pick<ReminderBlock,'id'|'title'>,mode:NotificationMode) {
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
function startupError(error:Error) {
  document.body.replaceChildren(); const box = element('main', 'startup-error'); const h = element('h1'); h.textContent = 'Your notebook needs a moment.'; const p = element('p'); p.textContent = error.message;
  const backup = button('Download saved data', 'Download saved data', () => { try { downloadJson(localStorage.getItem(STORAGE_KEY) ?? '', 'omd-recovery.json'); } catch { location.reload(); } }, 'secondary-button');
  box.append(h, p, backup, button('Try again', 'Reload app', () => location.reload(), 'secondary-button')); document.body.append(box);
}
async function boot() {
  try { store = await createStore(localStorage); } catch (error) { startupError(errorOf(error)); return; }
  for (const close of document.querySelectorAll('[data-close]')) close.addEventListener('click', () => close.closest('dialog')!.close());
  for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', e => { if (e.target === dialog) { const rect = dialog.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) dialog.close(); } });
  diagrams=createDiagramManager(store,{notify});
  textEditors=createTextEditors(store,{composition,notify,createNext:createTextAfter});
  const dirtyContainers=new Set<string>();
  renderer=createRenderCache({makeBlock:renderBlock,makeList:makeBlockList,
    observeBlock:(id,fn)=>store.subscribeBlock(id,fn),observeList:(id,fn)=>store.subscribeContainer(id,fn),
    onChange:({blockId,containerId})=>{
      const state=store.getRenderState(),options=store.getLastEvent();if(composition.hasActive()){deferredRender=true;return;}if(options.quiet||options.reset||state.id!==renderPageId)return;
      const id=containerId??(blockId?renderer.containerFor(blockId):undefined);if(id)dirtyContainers.add(id);
    }
  });
  store.afterChange(()=>{
    if(!dirtyContainers.size)return;const state=store.getRenderState(),options=store.getLastEvent(),ids=[...dirtyContainers];dirtyContainers.clear();if(options.reset)return;
    const focused=document.activeElement as HTMLInputElement|HTMLTextAreaElement|null,focusId=focused?.id,selection=focused?.selectionStart==null?null:[focused.selectionStart,focused.selectionEnd!] as const,scroll=[scrollX,scrollY] as const;
    const editorFocus=textEditors!.captureFocus();
    diagrams!.begin();for(const id of ids)try{renderer.refresh(findContainer(state,id).blocks,id);}catch(error){if(!/not found/.test(errorOf(error).message))notify(errorOf(error).message,'error',true);}diagrams!.end();textEditors!.end();
    for(const el of document.querySelectorAll<HTMLElement>('[data-autofit],.auto-height'))if(!el.dataset.fitted){fit(el);el.dataset.fitted='true';}
    if(focusId){const next=document.getElementById(focusId) as HTMLInputElement|HTMLTextAreaElement|null;if(next){next.focus({preventScroll:true});if(selection&&next.setSelectionRange)next.setSelectionRange(...selection);}}scrollTo(...scroll);
    textEditors!.restoreFocus(editorFocus);
  });
  shell=setupShell(store,{beforeNavigate,openPalette,confirm:confirmAction,onError:error=>notify(errorOf(error).message,'error',true),onThemeChange:applyTheme});
  store.subscribe(render); render(store.getRenderState());
  store.subscribeStatus(({pending,navigating,error})=>{domId('page-title').disabled=navigating&&!composition.isComposing(domId('page-title'));domId('page-subtitle').disabled=navigating&&!composition.isComposing(domId('page-subtitle'));domId('notebook').inert=navigating&&!composition.hasActive();const status=domId('save-status');status.replaceChildren();const dot=element('span','status-dot');status.append(dot,document.createTextNode(pending?'Saving…':error?'Not saved':'Saved'));});
  palette = setupPalette(store, { onError: error => notify(errorOf(error).message, 'error', true), beforeOpen:()=>shell!.closeMobile(), beforeNavigate });
  let fitFrame=0;window.addEventListener('resize',()=>{cancelAnimationFrame(fitFrame);fitFrame=requestAnimationFrame(()=>{for(const el of document.querySelectorAll<HTMLElement>('[data-autofit],.auto-height'))fit(el);});});
  domId('canvas-stage-close').addEventListener('click',closeCanvas);domId('canvas-stage-pages').addEventListener('click',openPalette);
  window.addEventListener('pagehide',event=>{flushPending().then(()=>{if(!event.persisted){textEditors!.destroy();return store.close();}}).catch(error=>notify(errorOf(error).message,'error',true));});window.addEventListener('beforeunload',flushPending);
  for (const [selector, key] of [['#page-title', 'title'], ['#page-subtitle', 'subtitle']]) {
    const el=$<HTMLInputElement|HTMLTextAreaElement>(selector);
    const write = (pageId:string) => {const saved=action('set_page', {pageId,[key]:el.value}, {quiet:true});fit(el);return saved;};
    composition.track(el,write,()=>store.getActivePageId());el.addEventListener('input',()=>{if(!composition.isComposing(el))write(store.getActivePageId());});
    if(key==='title') {
      let finishing=false;
      el.addEventListener('keydown',async event=>{
        const key=event as KeyboardEvent;
        if(key.key!=='Enter'||key.isComposing||key.keyCode===229||composition.isComposing(el))return;
        key.preventDefault();if(key.repeat||finishing)return;
        finishing=true;const pageId=store.getActivePageId(),title=el.value;
        try {
          await store.idle();
          if(store.getPageMetadata(pageId)?.title!==title&&!await action('set_page',{pageId,title},{quiet:true}))return;
          if(store.getActivePageId()===pageId&&el.value===title&&!composition.isComposing(el))el.blur();
        } finally {finishing=false;}
      });
    }
  }
  domId('theme').addEventListener('change', e => {try{shell!.setView({theme:(e.target as HTMLSelectElement).value as Page['theme']});}catch(error){applyTheme(shell!.getView().theme);notify(errorOf(error).message,'error',true);}}); themeQuery.addEventListener('change', () => applyTheme(shell!.getView().theme));
  domId('notification-mode').addEventListener('change', e => action('set_page', { notificationMode: (e.target as HTMLSelectElement).value as NotificationMode }));
  domId('undo-button').addEventListener('click', async () => { try { await flushPending();await store.undo(); } catch (e) { notify(errorOf(e).message, 'error'); } });
  domId('redo-button').addEventListener('click', async () => { try { await flushPending();await store.redo(); } catch (e) { notify(errorOf(e).message, 'error'); } });
  domId('export-button').addEventListener('click', async () => { domId('page-menu').open=false;await downloadJson(); notify('Notebook exported.'); });
  domId('import-button').addEventListener('click', () => {domId('page-menu').open=false;domId('import-file').click();});
  domId('import-file').addEventListener('change', async event => {
    const file=(event.target as HTMLInputElement).files?.[0];(event.target as HTMLInputElement).value = ''; if (!file) return;
    try { const raw = await file.text(); const { parseBook } = await import('./notebook.js'); parseBook(raw);
      if (await confirmAction('Replace this notebook?', 'All current pages will be exported as a backup before importing. Import replaces the entire notebook, page order and settings.', 'Back up & import')) { await beforeNavigate();await downloadJson(await store.export(), `omd-before-import-${Date.now()}.json`); await store.import(raw); notify('Notebook imported.'); }
    } catch (error) { notify(errorOf(error).message, 'error', true); }
  });
  domId('settings-button').addEventListener('click', openSettings); domId('sidebar-settings').addEventListener('click', openSettings); domId('agent-status').addEventListener('click', openSettings);
  domId('enable-notifications').addEventListener('click', async () => { try { if ('Notification' in window) { await Notification.requestPermission(); openSettings(); } } catch (e) { notify(errorOf(e).message, 'error'); } });
  domId('test-notification').addEventListener('click', () => deliverReminder({ id: 'test', title: 'A little nudge. Your reminders are ready.' }, store.getRenderState().notificationMode));
  domId('persist-storage').addEventListener('click', async () => { try { const kept = await navigator.storage?.persist?.(); domId('storage-state').textContent = kept ? ' Persistent storage granted.' : ' Browser did not grant persistent storage. Keep exports.'; } catch { domId('storage-state').textContent = ' Not supported by this browser.'; } });
  window.addEventListener('storage', async event => { if (event.key === STORAGE_KEY) { try { await store.reload(); } catch (e) { notify(errorOf(e).message, 'error', true); } } });
  const reminders = startReminders(store, { deliver: deliverReminder, onError: e => notify(errorOf(e).message, 'error', true) });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reminders.tick(); }); window.addEventListener('pageshow', () => reminders.tick()); setTimeout(() => reminders.tick(), 800);
  // Used by the PWA/WebMCP integration in the next stack layer.
  window.dispatchEvent(new CustomEvent('omd:ready', { detail: { store } }));
}
export const ready = boot();
export const getStore = ():NotebookStore|undefined => store;
