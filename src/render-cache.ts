import type {Block,CommandInput} from './types.js';
// Only visible branches participate in rendering. Hidden data remains in storage,
// not in DOM nodes, event-handler closures or retained renderer caches.
export function visibleContainers(block:Block):{id:string;blocks:Block[]}[] {
  if (block.type === 'tabs') { const tab=block.tabs.find(t=>t.id===block.activeTabId)!; return [{id:tab.id,blocks:tab.blocks}]; }
  if (block.type === 'toggle') return block.open ? [{id:block.id,blocks:block.blocks}] : [];
  if (block.type === 'accordion') return block.items.filter(i=>i.open).map(i=>({id:i.id,blocks:i.blocks}));
  return [];
}
// Full-page commands reveal the target's ancestors instead of mounting an
// editor behind an inactive tab or a closed section.
export type RevealAction=['tab_select',CommandInput<'tab_select'>]|['update_block',CommandInput<'update_block'>]|['accordion_update',CommandInput<'accordion_update'>];
export function revealActions(blocks:Block[],blockId:string):RevealAction[]|null {
  for(const block of blocks) {
    if(block.id===blockId)return [];
    const containers=block.type==='tabs'?block.tabs:block.type==='toggle'?[{id:block.id,blocks:block.blocks}]:block.type==='accordion'?block.items:[];
    for(const container of containers) {
      const path=revealActions(container.blocks,blockId);if(path===null)continue;
      const action:RevealAction|null=block.type==='tabs'?(container.id===block.activeTabId?null:['tab_select',{blockId:block.id,tabId:container.id}]):block.type==='toggle'?(block.open?null:['update_block',{blockId:block.id,patch:{open:true}}]):('open' in container&&container.open)?null:['accordion_update',{blockId:block.id,itemId:container.id,patch:{open:true}}];
      return action?[action,...path]:path;
    }
  }
  return null;
}
export function renderData(block:Block):Block {
  if (block.type === 'tabs') return {...block,tabs:block.tabs.map(t=>({...t,blocks:[]}))};
  if (block.type === 'toggle') return {...block,blocks:[]};
  if (block.type === 'accordion') return {...block,items:block.items.map(i=>({...i,blocks:[]}))};
  return block;
}
export function blockSignature(block:Block) {
  const own:Record<string,unknown>={...block}; delete own.blocks;
  if(block.type==='tabs') own.tabs=block.tabs.map(({blocks,...tab})=>tab);
  if(block.type==='accordion') own.items=block.items.map(({blocks,...item})=>item);
  return JSON.stringify(own);
}
// Reconcile by node identity, leaving unchanged nodes connected (focus/selection,
// canvas lifetime and DOM observers survive unrelated changes).
export function reconcile(parent:Node,nodes:Node[]) {
  const desired=new Set(nodes);
  for(const child of [...parent.childNodes])if(!desired.has(child))parent.removeChild(child);
  let cursor:ChildNode|null=parent.firstChild;
  for(const node of nodes) {
    if(node===cursor) cursor=cursor.nextSibling;
    else parent.insertBefore(node,cursor);
  }
  while(cursor) { const next=cursor.nextSibling; parent.removeChild(cursor);cursor=next; }
}
interface RenderOptions {makeBlock:(block:Block,containerId:string,index:number,count:number)=>HTMLElement;makeList:(blocks:Block[],id:string,nodes:HTMLElement[])=>{node:HTMLElement;children:Node[]};observeBlock?:(id:string,fn:()=>void)=>()=>void;observeList?:(id:string,fn:()=>void)=>()=>void;onChange?:(change:{blockId?:string;containerId?:string})=>unknown}
interface CachedBlock {signature:string;context:string;node:HTMLElement;unsubscribe?:()=>void;data?:Block;children?:string[];containerId?:string}
interface CachedList {shape:string;node:HTMLElement;ids:string[];unsubscribe?:()=>void}
export function createRenderCache({makeBlock,makeList,observeBlock,observeList,onChange}:RenderOptions) {
  const blocks=new Map<string,CachedBlock>(),lists=new Map<string,CachedList>();let pageId:string|undefined,usedBlocks=new Set<string>(),usedLists=new Set<string>();
  function list(data:Block[],id:string):HTMLElement {
    usedLists.add(id);const shape=JSON.stringify(data.map(b=>b.id));let entry=lists.get(id);
    const nodes=data.map((b,index)=>block(b,id,index,data.length));
    if(!entry || entry.shape!==shape) {
      const fresh=makeList(data,id,nodes);
      if(!entry) { entry={shape,node:fresh.node,ids:[]};lists.set(id,entry);entry.unsubscribe=observeList?.(id,()=>onChange?.({containerId:id})); }
      reconcile(entry.node,fresh.children);entry.shape=shape;
    }
    else {
      // Drop slots and the add button keep their existing event handlers.
      const children=[...entry.node.childNodes];nodes.forEach((node,i)=>{children[i*2+1]=node;});reconcile(entry.node,children);
    }
    entry.ids=data.map(b=>b.id);return entry.node;
  }
  function block(data:Block,containerId:string,index:number,count:number):HTMLElement {
    usedBlocks.add(data.id);let entry=blocks.get(data.id);
    if(Object.isFrozen(data)&&entry?.data===data&&entry.context===`${containerId}:${index}:${index===count-1}`){mark(data.id);return entry.node;}
    const signature=blockSignature(data);
    // Synchronize descendants independently; changes inside a tab do not rebuild
    // its headers or its parent block.
    for(const child of visibleContainers(data))list(child.blocks,child.id);
    const context=`${containerId}:${index}:${index===count-1}`;
    if(!entry || entry.signature!==signature || entry.context!==context) {
      const unsubscribe=entry?.unsubscribe??observeBlock?.(data.id,()=>onChange?.({blockId:data.id}));
      entry={signature,context,node:makeBlock(renderData(data),containerId,index,count),unsubscribe};blocks.set(data.id,entry);
    }
    entry.data=data;entry.children=visibleContainers(data).map(c=>c.id);entry.containerId=containerId;return entry.node;
  }
  function mark(id:string):void{const entry=blocks.get(id);if(!entry)return;usedBlocks.add(id);for(const child of entry.children??[]){usedLists.add(child);for(const nested of lists.get(child)?.ids??[])mark(nested);}}
  function unmark(id:string):void{usedBlocks.delete(id);for(const child of blocks.get(id)?.children??[]){usedLists.delete(child);for(const nested of lists.get(child)?.ids??[])unmark(nested);}}
  function clear(){for(const entry of [...blocks.values(),...lists.values()])entry.unsubscribe?.();blocks.clear();lists.clear();}
  return {
    begin(id:string) { if(id!==pageId){clear();pageId=id;}usedBlocks=new Set();usedLists=new Set(); },
    list,
    refresh(data:Block[],id:string){if(!lists.has(id))return;usedBlocks=new Set(blocks.keys());usedLists=new Set(lists.keys());for(const old of lists.get(id)!.ids)unmark(old);list(data,id);this.end();},
    containerFor:(id:string)=>blocks.get(id)?.containerId,
    childList:(id:string)=>lists.get(id)!.node,
    accept(id:string,data:Block) { const entry=blocks.get(id);if(entry){entry.signature=blockSignature(data);entry.data=data;} },
    end() { for(const id of blocks.keys())if(!usedBlocks.has(id)){blocks.get(id)!.unsubscribe?.();blocks.delete(id);}for(const id of lists.keys())if(!usedLists.has(id)){lists.get(id)!.unsubscribe?.();lists.delete(id);} },
  };
}
