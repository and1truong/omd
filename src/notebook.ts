import type {Notebook,Page,PageRow,CommandName,InternalInput,ActionResult} from './types.js';
import { emptyNotebook, demoNotebook, uid, upgradePageDates, validateNotebook, parseImport, applyAction } from './model.js';
export const NOTEBOOK_VERSION = 3;
export const MAX_PAGE_LEVELS = 32;
const clone = <T>(value:T):T => structuredClone(value);
function assert(ok:unknown,message:string):asserts ok {if(!ok)throw new Error(message);}
function fields(value:unknown,allowed:string[]) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Expected an object.');
  for (const key of Object.keys(value as object)) assert(allowed.includes(key), `Unknown field: ${key}.`);
}
export function wrapPage(page:Page):Notebook {
  validateNotebook(page);
  return { format: 'omd-notebook', version: NOTEBOOK_VERSION, id: uid(), revision: page.revision, activePageId: page.id, updatedAt: page.updatedAt, pages: [clone(page)], parents: {[page.id]:''} };
}
export const initialNotebook = () => wrapPage(demoNotebook());
export function validateBook(raw:unknown):Notebook {
  const book=raw as Notebook;
  fields(book, ['format','version','id','revision','activePageId','updatedAt','pages','parents']);
  assert(book.format === 'omd-notebook' && book.version === NOTEBOOK_VERSION, 'Unsupported omd notebook version.');
  assert(typeof book.id === 'string' && book.id.length > 0, 'Notebook ID must be nonempty text.');
  assert(Number.isSafeInteger(book.revision) && book.revision >= 0, 'Invalid notebook revision.');
  assert(typeof book.updatedAt === 'string' && Number.isFinite(Date.parse(book.updatedAt)), 'Invalid updated date.');
  assert(Array.isArray(book.pages) && book.pages.length > 0, 'Keep at least one notebook page.');
  const ids = new Set([book.id]);
  for (const page of book.pages) { validateNotebook(page); assert(!ids.has(page.id), 'Page IDs must be unique.'); ids.add(page.id); }
  assert(book.pages.some(page => page.id === book.activePageId), 'Active page not found.');
  const pageIds=new Set(book.pages.map(p=>p.id));assert(book.parents&&typeof book.parents==='object'&&!Array.isArray(book.parents),'Invalid page parents.');for(const id of Object.keys(book.parents))assert(pageIds.has(id),'Unknown page in hierarchy.');
  for(const id of pageIds){assert(Object.hasOwn(book.parents,id),'Missing page parent.');const parent=book.parents[id];assert(typeof parent==='string'&&(parent===''||pageIds.has(parent)),'Parent page not found.');}
  // Linear cycle detection, independent of depth and JavaScript call-stack size.
  const levels=new Map();
  for(const id of pageIds){const path=[],visiting=new Set();let current=id;while(current!==''&&!levels.has(current)){assert(!visiting.has(current),'Page hierarchy cannot contain cycles.');visiting.add(current);path.push(current);current=book.parents[current];}let level=current===''?0:levels.get(current);for(let i=path.length-1;i>=0;i--){level++;assert(level<=MAX_PAGE_LEVELS,`Pages are limited to ${MAX_PAGE_LEVELS} levels, including the root page.`);levels.set(path[i],level);}}
  return book;
}
export function parseBook(raw:string):Notebook {
  assert(typeof raw === 'string', 'Import must be JSON text.');
  let value; try { value = JSON.parse(raw); } catch { throw new Error('This file is not valid JSON.'); }
  if (value?.format === 'omd' && value.version === 1) return wrapPage(parseImport(raw));
  if(value?.format==='omd-notebook'&&[2,3].includes(value.version)&&Array.isArray(value.pages))for(const page of value.pages)upgradePageDates(page);
  if(value?.format==='omd-notebook'&&value.version===2){fields(value,['format','version','id','revision','activePageId','updatedAt','pages']);return validateBook({...value,version:NOTEBOOK_VERSION,parents:Object.fromEntries(value.pages.map((p:Page)=>[p.id,'']))});}
  return validateBook(value);
}
export function getPage(book:Notebook, pageId = book.activePageId) {
  const page = book.pages.find(page => page.id === pageId); assert(page, 'Page not found.'); return page;
}
export function listPages(book:Notebook):PageRow[] {
  const groups=new Map<string,Page[]>([['',[]]]);
  for(const page of book.pages){const parent=book.parents[page.id];if(!groups.has(parent))groups.set(parent,[]);groups.get(parent)!.push(page);}
  const rows:PageRow[]=[],byId=new Map<string,PageRow>(),stack=(groups.get('')??[]).map((page,index)=>({page,index,depth:0})).reverse();
  while(stack.length){const {page,index,depth}=stack.pop()!,children=groups.get(page.id)??[];const row={pageId:page.id,title:page.title,subtitle:page.subtitle,index,active:page.id===book.activePageId,parentId:book.parents[page.id],depth,childCount:children.length,siblingCount:groups.get(book.parents[page.id])!.length,descendantCount:0};rows.push(row);byId.set(page.id,row);for(let i=children.length-1;i>=0;i--)stack.push({page:children[i],index:i,depth:depth+1});}
  for(let i=rows.length-1;i>=0;i--){const row=rows[i];if(row.parentId!=='')byId.get(row.parentId)!.descendantCount+=row.descendantCount+1;}
  return rows;
}
export function pageAncestors(pages:PageRow[],pageId:string) {
  const byId=new Map(pages.map(p=>[p.pageId,p])),path:PageRow[]=[];let current=byId.get(pageId);
  while(current&&current.parentId!==''){current=byId.get(current.parentId);if(current)path.push(current);}
  return path.reverse();
}
export function subtreeIds(book:Notebook,pageId:string) {
  const children=new Map<string,string[]>();for(const page of book.pages){const parent=book.parents[page.id];if(!children.has(parent))children.set(parent,[]);children.get(parent)!.push(page.id);}
  const ids=new Set<string>(),stack=[pageId];while(stack.length){const id=stack.pop()!;ids.add(id);for(const child of children.get(id)??[])stack.push(child);}return ids;
}
function placePage(book:Notebook,page:Page,parentId:string,index?:number) {
  assert(typeof parentId==='string','Parent page ID must be text.');if(parentId!=='')getPage(book,parentId);
  let ancestor=parentId;while(ancestor!==''){assert(ancestor!==page.id,'Cannot move a page into itself or its descendants.');ancestor=book.parents[ancestor];}
  const siblings=book.pages.filter(p=>p.id!==page.id&&book.parents[p.id]===parentId),position=index??siblings.length;
  assert(Number.isInteger(position)&&position>=0&&position<=siblings.length,'Invalid page position.');
  const previous=book.pages.indexOf(page);if(previous>=0)book.pages.splice(previous,1);
  const offset=siblings[position]?book.pages.indexOf(siblings[position]):siblings.length?book.pages.indexOf(siblings.at(-1)!)+1:book.pages.length;
  book.parents[page.id]=parentId;book.pages.splice(offset,0,page);
}
export function applyBookAction(current:Notebook,action:CommandName,input:InternalInput = {}) {
  fields(input, Object.keys(input)); const book = clone(current); let result:ActionResult = {};
  switch (action) {
    case 'page_add': {
      fields(input, ['title','index','parentId']); const page = emptyNotebook(); page.title = input.title ?? 'Untitled page'; page.subtitle = '';
      const active = getPage(book); page.theme = active.theme; page.notificationMode = active.notificationMode;
      placePage(book,page,input.parentId??'',input.index);book.activePageId = page.id; result = { pageId: page.id }; break;
    }
    case 'page_select': fields(input, ['pageId']); getPage(book,input.pageId!); book.activePageId = input.pageId!; break;
    case 'page_update': {
      fields(input, ['pageId','title','subtitle']); const page = getPage(book,input.pageId!);
      const patch = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'pageId'));
      const out = applyAction(page, 'set_page', patch); book.pages[book.pages.indexOf(page)] = out.state; break;
    }
    case 'page_move': {
      fields(input, ['pageId','index','parentId']);const page=getPage(book,input.pageId!);placePage(book,page,input.parentId??book.parents[page.id],input.index);break;
    }
    case 'page_remove': {
      fields(input, ['pageId']);getPage(book,input.pageId!);const removed=subtreeIds(book,input.pageId!),parent=book.parents[input.pageId!];assert(removed.size<book.pages.length,'Keep at least one notebook page.');
      book.pages=book.pages.filter(p=>!removed.has(p.id));for(const id of removed)delete book.parents[id];
      if(removed.has(book.activePageId))book.activePageId=parent||book.pages[0].id;result={removedPageIds:[...removed]};break;
    }
    case 'import_notebook':
      fields(input, ['notebook']); Object.assign(book, input.notebook!.format === 'omd' ? wrapPage(input.notebook as Page) : clone(validateBook(input.notebook))); result = { imported: true }; break;
    default: {
      const { pageId, ...args } = input; const page = getPage(book, pageId);
      const out = applyAction(page, action, args); book.pages[book.pages.indexOf(page)] = out.state; result = out.result;
    }
  }
  book.revision = current.revision + 1; book.updatedAt = new Date().toISOString(); validateBook(book);
  return { state: book, result };
}
