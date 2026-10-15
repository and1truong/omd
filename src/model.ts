import type {Page,Block,BlockType,BlockOf,BlockOptions,Orientation,CommandName,InternalInput,ActionResult,ChecklistItem} from './types.js';
import { emptyScene, validateScene } from './scene.js';
/** Page document format. UI, imports, and agents share these invariants. */
export const FORMAT_VERSION = 1;
export const STORAGE_KEY = 'omd.notebook.v1';
export const MAX_CHECKLIST_LEVELS = 4;
export const MAX_LAYOUT_COLUMNS = 12;
export const BLOCK_TYPES = ['text', 'heading', 'callout', 'checklist', 'table', 'tabs', 'toggle', 'accordion', 'reminder', 'kanban', 'divider', 'mermaid', 'excalidraw'];
export const CALLOUT_TONES = ['neutral','info','success','warning','danger'] as const;
export const MAX_TABLE_ROWS = 100;
export const MAX_TABLE_COLUMNS = 20;
export const MAX_TABLE_CELL_LENGTH = 10000;
const THEMES = ['system', 'light', 'dark'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const MODES = ['notification', 'alert', 'toast'];
export const uid = () => globalThis.crypto.randomUUID();
const copy = <T>(value:T):T => structuredClone(value);
function assert(test:unknown,message:string):asserts test {if(!test)throw new Error(message);}
const object = (value:unknown):value is Record<string,unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function string(value:unknown,label:string):asserts value is string {
  assert(typeof value === 'string', `${label} must be text.`);
}
function integer(value:unknown,max:number) { assert(typeof value==='number'&&Number.isInteger(value) && value >= 0 && value <= max, 'Invalid position.'); }
function boolean(value:unknown,label:string) { assert(typeof value === 'boolean', `${label} must be true or false.`); }
function tableSize(value:unknown,max:number) { integer(value,max);assert(typeof value==='number'&&value>0,`Tables need 1–${max} rows/columns.`); }
function date(value:unknown,label:string) { assert(typeof value === 'string' && ISO_DATE.test(value) && Number.isFinite(Date.parse(value)), `${label} must be an ISO date-time with a timezone.`); }
function fields(value:unknown,allowed:readonly string[]) {
  assert(object(value), 'Expected an object.');
  for (const key of Object.keys(value)) assert(allowed.includes(key), `Unknown field: ${key}.`);
}

export function emptyNotebook():Page {
  return { format: 'omd', version: FORMAT_VERSION, id: uid(), revision: 0,
    title: 'My day, on a page', subtitle: 'A little room to think, plan, and make things happen.',
    theme: 'system', notificationMode: 'notification', updatedAt: new Date().toISOString(), blocks: [] };
}

export function makeBlock<T extends BlockType>(type:T,options?:BlockOptions):BlockOf<T>;
export function makeBlock(type:BlockType, options:BlockOptions = {}):Block {
  assert(BLOCK_TYPES.includes(type), 'Unknown block type.');
  const base={id:uid()};
  switch (type) {
    case 'text': return { ...base,type:'text', text: options.text ?? '' };
    case 'callout': return {...base,type:'callout',text:options.text??'',icon:options.icon??'💡',tone:options.tone??'neutral'};
    case 'heading': return { ...base,type:'heading', text: options.text ?? 'A new section' };
    case 'divider': return {...base,type:'divider'};
    case 'table': {
      const rows=options.rowCount??3,columns=options.columnCount??3;
      tableSize(rows,MAX_TABLE_ROWS);tableSize(columns,MAX_TABLE_COLUMNS);
      const headerRow=options.headerRow??true,pinnedHeader=options.pinnedHeader??true,pinnedColumns=options.pinnedColumns??0;boolean(headerRow,'Header row');boolean(pinnedHeader,'Pinned header');integer(pinnedColumns,columns);
      return {...base,type:'table',title:options.title??'A little table',headerRow,pinnedHeader,pinnedColumns,columns:Array.from({length:columns},()=>({id:uid()})),rows:Array.from({length:rows},()=>({id:uid(),cells:Array.from({length:columns},()=> '')}))};
    }
    case 'mermaid': return { ...base,type:'mermaid', title: options.title ?? 'A diagram in words', source: options.source ?? 'flowchart LR\n  Idea --> Plan\n  Plan --> Do' };
    case 'excalidraw': return { ...base,type:'excalidraw', title: options.title ?? 'A little drawing space', scene: options.scene ?? emptyScene() };
    case 'checklist': return { ...base,type:'checklist', title: options.title ?? 'A few things to do', items: [] };
    case 'tabs': {
      const tabs = ['First tab', 'Second tab'].map(title => ({ id: uid(), title, blocks: [] }));
      return { ...base,type:'tabs', title: options.title ?? 'A space for everything', orientation: options.orientation ?? 'horizontal', tabs, activeTabId: tabs[0].id };
    }
    case 'toggle': return { ...base,type:'toggle', title: options.title ?? 'A thought for later', open: true, blocks: [] };
    case 'accordion': return { ...base,type:'accordion', title: options.title ?? 'Things worth keeping', items: [{ id: uid(), title: 'An idea', open: true, blocks: [] }] };
    case 'reminder': return { ...base,type:'reminder', title: options.title ?? 'A gentle nudge', dueAt: options.dueAt ?? '', enabled: !!options.dueAt, firedAt: null };
    case 'kanban': return { ...base,type:'kanban', title: options.title ?? 'Little steps, big things', columns: ['To do', 'In progress', 'Done'].map(title => ({ id: uid(), title, cards: [] })) };
    case 'columns': throw new Error('Column layouts are created by moving blocks to an edge.');
  }
}

/** Alternating axes, at most TWO tab groups along any ancestor path. */
export function validateNotebook(raw:unknown):Page {
  const notebook=raw as Page;
  fields(notebook, ['format', 'version', 'id', 'revision', 'title', 'subtitle', 'theme', 'notificationMode', 'updatedAt', 'blocks']);
  assert(notebook.format === 'omd' && notebook.version === FORMAT_VERSION, 'Unsupported omd document version.');
  string(notebook.id, 'Notebook ID');
  assert(notebook.id.length > 0, 'Notebook ID must be nonempty text.');
  integer(notebook.revision, Number.MAX_SAFE_INTEGER);
  string(notebook.title, 'Page title'); string(notebook.subtitle, 'Page subtitle');
  assert(THEMES.includes(notebook.theme), 'Invalid theme.');
  assert(MODES.includes(notebook.notificationMode), 'Invalid reminder mode.');
  date(notebook.updatedAt, 'Updated date');
  const ids = new Set([notebook.id]);
  const id = (value:string) => { string(value, 'ID'); assert(value.length > 0 && !ids.has(value), 'IDs must be unique and nonempty.'); ids.add(value); };
  function list(value:unknown) { assert(Array.isArray(value), 'Expected a list.'); }
  function checklist(items:ChecklistItem[],level=1) {
    list(items);
    for(const item of items) {
      assert(level<=MAX_CHECKLIST_LEVELS,`Checklist items are limited to ${MAX_CHECKLIST_LEVELS} levels, including root items.`);
      fields(item,['id','text','done','completedAt','children']);id(item.id);string(item.text,'Checklist item');boolean(item.done,'Checked');
      if(item.completedAt!==undefined&&item.completedAt!==null&&item.completedAt!=='')date(item.completedAt,'Completion date');
      if(Object.hasOwn(item,'children'))checklist(item.children!,level+1);
    }
  }
  function visit(blocks:Block[],axes:Orientation[] = [],depth=0) {
    list(blocks);
    for (const b of blocks) {
      assert(object(b), 'Invalid block.'); id(b.id);
      assert(b.type==='columns'||BLOCK_TYPES.includes(b.type), 'Unknown block type.');
      switch (b.type) {
        case 'text': case 'heading': fields(b, ['id', 'type', 'text']); string(b.text, 'Block text'); break;
        case 'callout':
          fields(b,['id','type','text','icon','tone']);string(b.text,'Callout text');string(b.icon,'Callout icon');assert(b.icon.length<=32&&!/[\r\n]/.test(b.icon),'Callout icon must be at most 32 characters on one line.');assert(CALLOUT_TONES.includes(b.tone),'Invalid callout tone.');break;
        case 'divider': fields(b, ['id', 'type']); break;
        case 'columns':
          fields(b,['id','type','columns']);list(b.columns);
          assert(b.columns.length>=2&&b.columns.length<=MAX_LAYOUT_COLUMNS,`A row needs 2–${MAX_LAYOUT_COLUMNS} columns.`);
          for(const column of b.columns){fields(column,['id','blocks']);assert(column.id!=='page','The page container ID is reserved.');id(column.id);list(column.blocks);assert(column.blocks.length>0,'Column layouts cannot contain empty columns.');visit(column.blocks,axes,depth+1);}break;
        case 'table':
          fields(b,['id','type','title','headerRow','pinnedHeader','pinnedColumns','columns','rows']);string(b.title,'Table title');boolean(b.headerRow,'Header row');boolean(b.pinnedHeader,'Pinned header');
          list(b.rows);list(b.columns);tableSize(b.rows.length,MAX_TABLE_ROWS);tableSize(b.columns.length,MAX_TABLE_COLUMNS);
          integer(b.pinnedColumns,b.columns.length);
          for(const column of b.columns){fields(column,['id']);id(column.id);}
          for(const row of b.rows){fields(row,['id','cells']);id(row.id);list(row.cells);assert(row.cells.length===b.columns.length,'Table rows must be rectangular.');for(const cell of row.cells){string(cell,'Table cell');assert(cell.length<=MAX_TABLE_CELL_LENGTH,'Table cell is too long.');}}
          break;
        case 'mermaid': fields(b, ['id','type','title','source']); string(b.title,'Diagram title'); string(b.source,'Mermaid source'); break;
        case 'excalidraw': fields(b, ['id','type','title','scene']); string(b.title,'Canvas title'); validateScene(b.scene); break;
        case 'checklist':
          fields(b, ['id', 'type', 'title', 'items']); string(b.title, 'Checklist title'); list(b.items);
          checklist(b.items);
          break;
        case 'tabs': {
          fields(b, ['id', 'type', 'title', 'orientation', 'tabs', 'activeTabId']); string(b.title, 'Tabs title');
          assert(['horizontal', 'vertical'].includes(b.orientation), 'Invalid tab orientation.');
          assert(axes.length < 2, 'Tabs are limited to two levels.');
          assert(axes.at(-1) !== b.orientation, 'Nested tabs must use the opposite orientation.');
          list(b.tabs); assert(b.tabs.length > 0, 'Keep at least one tab.');
          for (const tab of b.tabs) { assert(tab.id!=='page','The page container ID is reserved.'); fields(tab, ['id', 'title', 'blocks']); id(tab.id); string(tab.title, 'Tab title'); visit(tab.blocks, [...axes, b.orientation], depth + 1); }
          assert(b.tabs.some(t => t.id === b.activeTabId), 'Active tab does not exist.'); break;
        }
        case 'toggle': assert(b.id!=='page','The page container ID is reserved.'); fields(b, ['id', 'type', 'title', 'open', 'blocks']); string(b.title, 'Toggle title'); boolean(b.open, 'Open'); visit(b.blocks, axes, depth + 1); break;
        case 'accordion':
          fields(b, ['id', 'type', 'title', 'items']); string(b.title, 'Accordion title'); list(b.items);
          for (const item of b.items) { assert(item.id!=='page','The page container ID is reserved.'); fields(item, ['id', 'title', 'open', 'blocks']); id(item.id); string(item.title, 'Accordion item'); boolean(item.open, 'Open'); visit(item.blocks, axes, depth + 1); } break;
        case 'reminder':
          fields(b, ['id', 'type', 'title', 'dueAt', 'enabled', 'firedAt']); string(b.title, 'Reminder title'); boolean(b.enabled, 'Enabled');
          if (b.dueAt !== '') date(b.dueAt, 'Reminder date');
          assert(!b.enabled || b.dueAt !== '', 'An enabled reminder needs a date.');
          if (b.firedAt !== null) date(b.firedAt, 'Reminder delivery date'); break;
        case 'kanban':
          fields(b, ['id', 'type', 'title', 'columns']); string(b.title, 'Board title'); list(b.columns);
          for (const col of b.columns) {
            fields(col, ['id', 'title', 'cards']); id(col.id); string(col.title, 'Column title'); list(col.cards);
            for (const card of col.cards) { fields(card, ['id', 'title', 'description']); id(card.id); string(card.title, 'Card title'); string(card.description, 'Card description'); }
          } break;
      }
    }
  }
  visit(notebook.blocks);
  return notebook;
}

export function walkBlocks(notebook:Page,fn:(block:Block,siblings:Block[],axes:Orientation[])=>void) {
  function walk(blocks:Block[],axes:Orientation[] = []) {
    for (const block of blocks) {
      fn(block, blocks, axes);
      if (block.type === 'tabs') for (const tab of block.tabs) walk(tab.blocks, [...axes, block.orientation]);
      if (block.type === 'toggle') walk(block.blocks, axes);
      if (block.type === 'accordion') for (const item of block.items) walk(item.blocks, axes);
      if (block.type === 'columns') for (const column of block.columns) walk(column.blocks, axes);
    }
  }
  walk(notebook.blocks);
}

export function findBlock<T extends BlockType=BlockType>(notebook:Page,blockId:string|undefined,type?:T):{block:BlockOf<T>;siblings:Block[];axes:Orientation[]} {
  let found:{block:Block;siblings:Block[];axes:Orientation[]}|undefined;
  walkBlocks(notebook, (block, siblings, axes) => { if (block.id === blockId) found = { block, siblings, axes }; });
  assert(found, 'Block not found.'); assert(!type || found.block.type === type, `Expected a ${type} block.`);
  return found as {block:BlockOf<T>;siblings:Block[];axes:Orientation[]};
}

export function findContainer(notebook:Page,containerId:string = 'page') {
  if (containerId === 'page') return { blocks: notebook.blocks, axes: [] };
  let found:{blocks:Block[];axes:Orientation[]}|undefined;
  walkBlocks(notebook, (block, siblings, axes) => {
    if (block.type === 'toggle' && block.id === containerId) found = { blocks: block.blocks, axes };
    if (block.type === 'tabs') for (const tab of block.tabs) if (tab.id === containerId) found = { blocks: tab.blocks, axes: [...axes, block.orientation] };
    if (block.type === 'accordion') for (const item of block.items) if (item.id === containerId) found = { blocks: item.blocks, axes };
    if (block.type === 'columns') for (const column of block.columns) if (column.id === containerId) found = { blocks: column.blocks, axes };
  });
  assert(found, 'Container not found.'); return found;
}

export function allowedTypes(notebook:Page,containerId:string = 'page') {
  const { axes } = findContainer(notebook, containerId);
  return { types: BLOCK_TYPES.filter(type => type !== 'tabs' || axes.length < 2),
    tabOrientation: axes.length === 0 ? null : axes.at(-1) === 'horizontal' ? 'vertical' : 'horizontal' };
}

function member<T extends {id:string}>(items:T[],id:string|undefined):T { const item = items.find(x => x.id === id); assert(item, 'Item not found.'); return item; }
export function findChecklistItem(items:ChecklistItem[],itemId:string|undefined) {
  function visit(siblings:ChecklistItem[],ancestors:ChecklistItem[]):{item:ChecklistItem;siblings:ChecklistItem[];ancestors:ChecklistItem[]}|undefined {
    for(const item of siblings) {
      if(item.id===itemId)return {item,siblings,ancestors};
      const found=item.children&&visit(item.children,[...ancestors,item]);if(found)return found;
    }
  }
  const found=visit(items,[]);assert(found,'Item not found.');return found;
}
export function checklistHeight(item:ChecklistItem):number {
  return 1+(item.children??[]).reduce((height,child)=>Math.max(height,checklistHeight(child)),0);
}
function checklistChildren(items:ChecklistItem[],parentId:string|undefined) {
  if(parentId===undefined||parentId==='')return items;
  const parent=findChecklistItem(items,parentId).item;return parent.children??(parent.children=[]);
}
function remove<T extends {id:string}>(items:T[],id:string|undefined):T { const i = items.findIndex(x => x.id === id); assert(i >= 0, 'Item not found.'); return items.splice(i, 1)[0]; }
function insert<T>(items:T[],item:T,index=items.length) { integer(index, items.length); items.splice(index, 0, item); }
function move<T extends {id:string}>(items:T[],id:string|undefined,index:number|undefined) { integer(index, items.length - 1); const item = remove(items, id); insert(items, item, index); }

/** A layout column is a regular block container; nesting preserves existing tab axes. */
export function layoutColumn(notebook:Page,containerId:string){
  let found:{row:BlockOf<'columns'>;index:number}|undefined;
  walkBlocks(notebook,block=>{if(block.type==='columns'){const index=block.columns.findIndex(c=>c.id===containerId);if(index>=0)found={row:block,index};}});return found;
}
export function containsBlock(block:Block,id:string):boolean {
  if(block.id===id)return true;
  const lists=block.type==='toggle'?[block]:block.type==='tabs'?block.tabs:block.type==='accordion'?block.items:block.type==='columns'?block.columns:[];
  return lists.some(container=>container.blocks.some(child=>containsBlock(child,id)));
}
export function columnMoveTarget(notebook:Page,blockId:string,containerId:string,targetBlockId:string,createColumn=true){
  const source=findBlock(notebook,blockId),target=findBlock(notebook,targetBlockId);
  assert(!containsBlock(source.block,target.block.id),'Cannot move a block beside itself or its descendants.');
  assert(findContainer(notebook,containerId).blocks===target.siblings,'The target block changed containers. Try the drop again.');
  function axesAllowed(block:Block,axes:Orientation[]){
    if(block.type==='tabs'){
      assert(axes.length<2,'Tabs are limited to two levels.');assert(axes.at(-1)!==block.orientation,'Nested tabs must use the opposite orientation.');
      for(const tab of block.tabs)for(const child of tab.blocks)axesAllowed(child,[...axes,block.orientation]);
    }else{const lists=block.type==='toggle'?[block]:block.type==='accordion'?block.items:block.type==='columns'?block.columns:[];for(const list of lists)for(const child of list.blocks)axesAllowed(child,axes);}
  }
  axesAllowed(source.block,target.axes);
  const column=layoutColumn(notebook,containerId);
  const vacatesColumn=column?.row.columns.some(c=>c.blocks===source.siblings&&c.blocks.length===1)??false;
  const count=column?column.row.columns.length+1-(vacatesColumn?1:0):2;
  if(createColumn)assert(count<=MAX_LAYOUT_COLUMNS,`A row supports at most ${MAX_LAYOUT_COLUMNS} columns.`);
  return {source,target,column,count};
}
function normalizeColumns(blocks:Block[]){
  for(let i=blocks.length-1;i>=0;i--){const block=blocks[i];
    const lists=block.type==='toggle'?[block]:block.type==='tabs'?block.tabs:block.type==='accordion'?block.items:block.type==='columns'?block.columns:[];
    for(const container of lists)normalizeColumns(container.blocks);
    if(block.type==='columns'){
      if(block.columns.some(column=>column.blocks.length===0))block.columns=block.columns.filter(column=>column.blocks.length>0);
      if(block.columns.length<2)blocks.splice(i,1,...(block.columns[0]?.blocks??[]));
    }
  }
}

/** Applies one atomic action to a clone; invalid actions never change the input. */
export function applyAction(current:Page,action:CommandName,input:InternalInput = {}) {
  assert(object(input), 'Tool input must be an object.');
  return mutatePage(copy(current), action, input);
}

/** Mutate an isolated Immer draft; the store publishes it only after validation and persistence. */
export function mutatePage(doc:Page,action:CommandName,input:InternalInput = {},validate=true) {
  assert(object(input), 'Tool input must be an object.');
  let result:ActionResult = {};
  const block = <T extends BlockType=BlockType>(type?:T) => findBlock(doc, input.blockId, type).block;
  switch (action) {
    case 'set_page':
      fields(input, ['title', 'subtitle', 'theme', 'notificationMode']); Object.assign(doc, input); break;
    case 'add_block': {
      fields(input, ['type', 'containerId', 'index', 'icon', 'tone', 'text', 'title', 'orientation', 'dueAt','source','scene','rowCount','columnCount','headerRow','pinnedHeader','pinnedColumns']);
      const container = findContainer(doc, input.containerId);
      const b = makeBlock(input.type!, input); insert(container.blocks, b, input.index); result = { blockId: b.id, block: copy(b) }; break;
    }
    case 'convert_block': {
      fields(input,['blockId','type','expectedText','text','title','orientation','dueAt','source','scene','rowCount','columnCount','headerRow','pinnedHeader','pinnedColumns']);
      const found=findBlock(doc,input.blockId,'text');string(input.expectedText,'Expected text');
      assert(found.block.text===input.expectedText,'The text block changed. Try the command again.');
      const replacement={...makeBlock(input.type!,input),id:found.block.id};
      found.siblings.splice(found.siblings.findIndex(b=>b.id===found.block.id),1,replacement);
      result={blockId:replacement.id,block:copy(replacement)};break;
    }
    case 'update_block': {
      fields(input, ['blockId', 'patch']); const b = block();
      const allowed = { text: ['text'], heading: ['text'], callout:['text','icon','tone'], checklist: ['title'], table:['title','headerRow','pinnedHeader','pinnedColumns'], tabs: ['title', 'orientation'], toggle: ['title', 'open'], accordion: ['title'], reminder: ['title', 'dueAt', 'enabled'], kanban: ['title'], divider: [], mermaid:['title','source'], excalidraw:['title','scene'],columns:[] };
      fields(input.patch, allowed[b.type]); Object.assign(b, input.patch);
      if (b.type === 'reminder' && ('dueAt' in input.patch! || input.patch!.enabled === true)) b.firedAt = null;
      result = { blockId: b.id }; break;
    }
    case 'remove_block': fields(input, ['blockId']); { const f = findBlock(doc, input.blockId); remove(f.siblings, input.blockId); } break;
    case 'table_cell_update': {
      fields(input,['blockId','rowId','columnId','text']);const b=block('table');member(b.columns,input.columnId);string(input.text,'Table cell');assert(input.text.length<=MAX_TABLE_CELL_LENGTH,'Table cell is too long.');
      member(b.rows,input.rowId).cells[b.columns.findIndex(column=>column.id===input.columnId)]=input.text;break;
    }
    case 'table_row_add': {
      fields(input,['blockId','index']);const b=block('table');assert(b.rows.length<MAX_TABLE_ROWS,'Table row limit reached.');const row={id:uid(),cells:b.columns.map(()=> '')};insert(b.rows,row,input.index);result={rowId:row.id};break;
    }
    case 'table_column_add': {
      fields(input,['blockId','index']);const b=block('table');assert(b.columns.length<MAX_TABLE_COLUMNS,'Table column limit reached.');const index=input.index??b.columns.length;const column={id:uid()};insert(b.columns,column,index);for(const row of b.rows)row.cells.splice(index,0,'');result={columnId:column.id};break;
    }
    case 'table_row_remove': fields(input,['blockId','rowId']);{const b=block('table');assert(b.rows.length>1,'Keep at least one table row.');remove(b.rows,input.rowId);}break;
    case 'table_column_remove': {
      fields(input,['blockId','columnId']);const b=block('table');assert(b.columns.length>1,'Keep at least one table column.');member(b.columns,input.columnId);const index=b.columns.findIndex(column=>column.id===input.columnId);remove(b.columns,input.columnId);for(const row of b.rows)row.cells.splice(index,1);b.pinnedColumns=Math.min(b.pinnedColumns,b.columns.length);break;
    }
    case 'move_block': {
      fields(input, ['blockId', 'containerId', 'index','targetBlockId','side']);
      if(input.side!==undefined||input.targetBlockId!==undefined){
        assert(input.side==='left'||input.side==='right','Choose a left or right column edge.');
        assert(input.index===undefined,'Column edge moves do not accept a vertical index.');
        string(input.containerId,'Target container');string(input.targetBlockId,'Target block');string(input.blockId,'Source block');
        const {source,target,column}=columnMoveTarget(doc,input.blockId,input.containerId,input.targetBlockId);
        const moved=remove(source.siblings,input.blockId);
        if(column){
          assert(column.row.columns.filter(c=>c.blocks.length>0).length<MAX_LAYOUT_COLUMNS,`A row supports at most ${MAX_LAYOUT_COLUMNS} columns.`);
          column.row.columns.splice(column.index+(input.side==='right'?1:0),0,{id:uid(),blocks:[moved]});
        }else{
          const columns=[{id:uid(),blocks:[target.block]},{id:uid(),blocks:[moved]}];if(input.side==='left')columns.reverse();
          target.siblings.splice(target.siblings.findIndex(b=>b.id===target.block.id),1,{id:uid(),type:'columns',columns});
        }
        break;
      }
      const target = findContainer(doc, input.containerId);
      const source = findBlock(doc, input.blockId);
      const b = remove(source.siblings, input.blockId); insert(target.blocks, b, input.index);
      // A target inside the moved subtree has disappeared; never silently drop the block.
      assert(findBlock(doc, b.id), 'Cannot move a block inside itself.'); break;
    }
    case 'checklist_add': fields(input, ['blockId', 'text', 'parentId', 'index']); { const item = { id: uid(), text: input.text ?? '', done: false }; insert(checklistChildren(block('checklist').items,input.parentId), item, input.index); result = { itemId: item.id }; } break;
    case 'checklist_update': {
      fields(input,['blockId','itemId','patch']);fields(input.patch,['text','done']);
      const item=findChecklistItem(block('checklist').items,input.itemId).item,completing=input.patch!.done===true&&!item.done;
      Object.assign(item,input.patch);
      if(completing)item.completedAt=new Date().toISOString();else if(input.patch!.done===false)delete item.completedAt;
      break;
    }
    case 'checklist_remove': fields(input, ['blockId', 'itemId']); {const source=findChecklistItem(block('checklist').items,input.itemId);remove(source.siblings,input.itemId);} break;
    case 'checklist_move': {
      fields(input,['blockId','itemId','parentId','index']);const items=block('checklist').items,source=findChecklistItem(items,input.itemId);
      if(input.parentId!==undefined&&input.parentId!=='') {
        const parent=findChecklistItem(items,input.parentId);
        assert(parent.item.id!==input.itemId&&!parent.ancestors.some(item=>item.id===input.itemId),'Cannot move a checklist item into itself or its descendants.');
      }
      const target=input.parentId===undefined?source.siblings:checklistChildren(items,input.parentId);
      integer(input.index,target.length-(target===source.siblings?1:0));insert(target,remove(source.siblings,input.itemId),input.index);break;
    }
    case 'tab_add': fields(input, ['blockId', 'title', 'index']); { const b = block('tabs'); const tab = { id: uid(), title: input.title ?? 'New tab', blocks: [] }; insert(b.tabs, tab, input.index); b.activeTabId = tab.id; result = { tabId: tab.id }; } break;
    case 'tab_update': fields(input, ['blockId', 'tabId', 'title']); member(block('tabs').tabs, input.tabId).title = input.title!; break;
    case 'tab_select': fields(input, ['blockId', 'tabId']); { const b = block('tabs'); member(b.tabs, input.tabId); b.activeTabId = input.tabId!; } break;
    case 'tab_move': fields(input, ['blockId', 'tabId', 'index']); move(block('tabs').tabs, input.tabId, input.index); break;
    case 'tab_remove': fields(input, ['blockId', 'tabId']); { const b = block('tabs'); assert(b.tabs.length > 1, 'Keep at least one tab.'); remove(b.tabs, input.tabId); if (!b.tabs.some(t => t.id === b.activeTabId)) b.activeTabId = b.tabs[0].id; } break;
    case 'accordion_add': fields(input, ['blockId', 'title', 'index']); { const item = { id: uid(), title: input.title ?? 'New item', open: true, blocks: [] }; insert(block('accordion').items, item, input.index); result = { itemId: item.id }; } break;
    case 'accordion_update': fields(input, ['blockId', 'itemId', 'patch']); fields(input.patch, ['title', 'open']); Object.assign(member(block('accordion').items, input.itemId), input.patch); break;
    case 'accordion_remove': fields(input, ['blockId', 'itemId']); remove(block('accordion').items, input.itemId); break;
    case 'accordion_move': fields(input, ['blockId', 'itemId', 'index']); move(block('accordion').items, input.itemId, input.index); break;
    case 'column_add': fields(input, ['blockId', 'title', 'index']); { const col = { id: uid(), title: input.title ?? 'New column', cards: [] }; insert(block('kanban').columns, col, input.index); result = { columnId: col.id }; } break;
    case 'column_update': fields(input, ['blockId', 'columnId', 'title']); member(block('kanban').columns, input.columnId).title = input.title!; break;
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
    case 'reminder_fired': fields(input, ['blockId', 'firedAt']); { const b = block('reminder'); assert(b.enabled && !b.firedAt, 'Reminder is not pending.'); date(input.firedAt, 'Delivery date'); assert(Date.parse(b.dueAt) <= Date.parse(input.firedAt!), 'Reminder is not due.'); b.firedAt = input.firedAt!; } break;
    case 'import_notebook': fields(input, ['notebook']); validateNotebook(input.notebook); return { state: { ...copy(input.notebook as Page), revision: doc.revision + 1, updatedAt: new Date().toISOString() }, result: { imported: true } };
    default: throw new Error(`Unknown action: ${action}.`);
  }
  normalizeColumns(doc.blocks);
  doc.revision++; doc.updatedAt = new Date().toISOString(); if(validate)validateNotebook(doc);
  return { state: doc, result };
}

export function parseImport(raw:string):Page {
  assert(typeof raw === 'string', 'Import must be JSON text.');
  let value; try { value = JSON.parse(raw); } catch { throw new Error('This file is not valid JSON.'); }
  return validateNotebook(upgradePageDates(value));
}

export function dueReminders(notebook:Page, now = Date.now()) {
  const due:BlockOf<'reminder'>[] = []; walkBlocks(notebook, b => { if (b.type === 'reminder' && b.enabled && !b.firedAt && Date.parse(b.dueAt) <= now) due.push(copy(b)); }); return due;
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

/** v1 previously allowed any Date.parse-compatible string. Normalize only import/migration data. */
export function upgradePageDates(raw:unknown):unknown {
  const page=raw as Page;
  if(!page||page.version!==1)return page;
  const normalize=<T extends string|null>(value:T):T=>typeof value==='string'&&!ISO_DATE.test(value)&&Number.isFinite(Date.parse(value))?new Date(Date.parse(value)).toISOString() as T:value;
  page.updatedAt=normalize(page.updatedAt);const stack=Array.isArray(page.blocks)?[...page.blocks]:[];
  while(stack.length){const b=stack.pop();if(!b||typeof b!=='object')continue;if(b.type==='reminder'){b.dueAt=normalize(b.dueAt);b.firedAt=normalize(b.firedAt);}const children=b.type==='toggle'?[b]:b.type==='tabs'?b.tabs:b.type==='accordion'?b.items:b.type==='columns'?b.columns:[];if(Array.isArray(children))for(const child of children)if(Array.isArray(child?.blocks))for(const nested of child.blocks)stack.push(nested);}
  return page;
}
