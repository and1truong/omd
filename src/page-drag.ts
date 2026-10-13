import type {PageRow} from './types.js';
import {MAX_PAGE_LEVELS} from './notebook.js';
export type PageDropPosition='before'|'after'|'inside';
export interface PageMove {pageId:string;parentId:string;index:number}
export const pageTreeSignature=(rows:PageRow[])=>JSON.stringify(rows.map(row=>[row.pageId,row.parentId,row.index]));
/** Resolve positions against siblings after removing the moving subtree root. */
export function pageDrop(rows:PageRow[],pageId:string,targetId:string|null,position:PageDropPosition):PageMove|null {
  const byId=new Map(rows.map(row=>[row.pageId,row])),source=byId.get(pageId),target=targetId===null?null:byId.get(targetId);
  if(!source||targetId!==null&&!target)return null;
  const subtree=new Set([pageId]);let height=1;
  for(const row of rows)if(subtree.has(row.parentId)){subtree.add(row.pageId);height=Math.max(height,row.depth-source.depth+1);}
  if(target&&subtree.has(target.pageId))return null;
  const parentId=target?(position==='inside'?target.pageId:target.parentId):'';
  const parentDepth=parentId===''?-1:byId.get(parentId)!.depth;
  if(parentDepth+1+height>MAX_PAGE_LEVELS)return null;
  const siblings=rows.filter(row=>row.parentId===parentId&&row.pageId!==pageId);
  const index=!target||position==='inside'?siblings.length:siblings.findIndex(row=>row.pageId===target.pageId)+(position==='after'?1:0);
  if(source.parentId===parentId&&source.index===index)return null;
  return {pageId,parentId,index};
}
export function createPageDrag(pages:HTMLElement,{rows,beforeMove,move,onError,expand}:{rows:()=>PageRow[];beforeMove:()=>Promise<unknown>;move:(input:PageMove)=>Promise<unknown>;onError:(error:Error)=>void;expand:(id:string)=>void}) {
  const mime='application/x-omd-page-move';let drag:{pageId:string;nonce:string;signature:string}|null=null;
  function clearMarkers(){for(const row of pages.querySelectorAll<HTMLElement>('[data-page-drop]'))delete row.dataset.pageDrop;delete pages.dataset.pageDropRoot;}
  function cancel(){drag=null;clearMarkers();pages.classList.remove('page-dragging');}
  function owns(event:DragEvent){return !!drag&&!!event.dataTransfer&&[...event.dataTransfer.types].includes(mime)&&pageTreeSignature(rows())===drag.signature;}
  function target(event:DragEvent){
    const node=event.target instanceof Element?event.target.closest<HTMLElement>('.sidebar-page'):null;
    if(!node||!pages.contains(node))return {targetId:null,position:'after' as const,node:null};
    const rect=node.getBoundingClientRect(),fraction=(event.clientY-rect.top)/rect.height;
    return {targetId:node.dataset.pageId!,position:(fraction<.25?'before':fraction>.75?'after':'inside') as PageDropPosition,node};
  }
  pages.addEventListener('dragover',event=>{
    if(!owns(event))return;const destination=target(event),input=pageDrop(rows(),drag!.pageId,destination.targetId,destination.position);clearMarkers();
    if(!input){event.dataTransfer!.dropEffect='none';return;}
    event.preventDefault();event.stopPropagation();event.dataTransfer!.dropEffect='move';
    if(destination.node)destination.node.dataset.pageDrop=destination.position;else pages.dataset.pageDropRoot='true';
  });
  pages.addEventListener('dragleave',event=>{if(!pages.contains(event.relatedTarget as Node|null))clearMarkers();});
  pages.addEventListener('drop',event=>{
    if(!owns(event)||event.dataTransfer!.getData(mime)!==drag!.nonce)return;
    event.preventDefault();event.stopPropagation();const source=drag!,destination=target(event);cancel();
    void (async()=>{
      await beforeMove();
      if(pageTreeSignature(rows())!==source.signature)throw new Error('The page tree changed during the drag. Try moving the page again.');
      const input=pageDrop(rows(),source.pageId,destination.targetId,destination.position);if(!input)return;
      await move(input);if(input.parentId)expand(input.parentId);
    })().catch(error=>onError(error instanceof Error?error:new Error(String(error))));
  });
  pages.addEventListener('keydown',event=>{if(event.key==='Escape')cancel();});
  return {attach(handle:HTMLButtonElement,pageId:string){
    handle.draggable=true;handle.addEventListener('dragstart',event=>{
      if(!event.dataTransfer||!rows().some(row=>row.pageId===pageId)){event.preventDefault();return;}
      event.stopPropagation();drag={pageId,nonce:crypto.randomUUID(),signature:pageTreeSignature(rows())};event.dataTransfer.setData(mime,drag.nonce);event.dataTransfer.effectAllowed='move';pages.classList.add('page-dragging');
    });handle.addEventListener('dragend',cancel);
  },cancel};
}
