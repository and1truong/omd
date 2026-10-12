// Only visible branches participate in rendering. Hidden data remains in storage,
// not in DOM nodes, event-handler closures or retained renderer caches.
export function visibleContainers(block) {
  if (block.type === 'tabs') { const tab=block.tabs.find(t=>t.id===block.activeTabId); return [{id:tab.id,blocks:tab.blocks}]; }
  if (block.type === 'toggle') return block.open ? [{id:block.id,blocks:block.blocks}] : [];
  if (block.type === 'accordion') return block.items.filter(i=>i.open).map(i=>({id:i.id,blocks:i.blocks}));
  return [];
}
// Full-page commands reveal the target's ancestors instead of mounting an
// editor behind an inactive tab or a closed section.
export function revealActions(blocks,blockId) {
  for(const block of blocks) {
    if(block.id===blockId)return [];
    const containers=block.type==='tabs'?block.tabs:block.type==='toggle'?[{id:block.id,blocks:block.blocks}]:block.type==='accordion'?block.items:[];
    for(const container of containers) {
      const path=revealActions(container.blocks,blockId);if(path===null)continue;
      const action=block.type==='tabs'?(container.id===block.activeTabId?null:['tab_select',{blockId:block.id,tabId:container.id}]):block.type==='toggle'?(block.open?null:['update_block',{blockId:block.id,patch:{open:true}}]):container.open?null:['accordion_update',{blockId:block.id,itemId:container.id,patch:{open:true}}];
      return action?[action,...path]:path;
    }
  }
  return null;
}
export function renderData(block) {
  if (block.type === 'tabs') return {...block,tabs:block.tabs.map(t=>({...t,blocks:[]}))};
  if (block.type === 'toggle') return {...block,blocks:[]};
  if (block.type === 'accordion') return {...block,items:block.items.map(i=>({...i,blocks:[]}))};
  return block;
}
export function blockSignature(block) {
  const own={...block}; delete own.blocks;
  if(block.type==='tabs') own.tabs=block.tabs.map(({blocks,...tab})=>tab);
  if(block.type==='accordion') own.items=block.items.map(({blocks,...item})=>item);
  return JSON.stringify(own);
}
// Reconcile by node identity, leaving unchanged nodes connected (focus/selection,
// canvas lifetime and DOM observers survive unrelated changes).
export function reconcile(parent,nodes) {
  const desired=new Set(nodes);
  for(const child of [...parent.childNodes])if(!desired.has(child))parent.removeChild(child);
  let cursor=parent.firstChild;
  for(const node of nodes) {
    if(node===cursor) cursor=cursor.nextSibling;
    else parent.insertBefore(node,cursor);
  }
  while(cursor) { const next=cursor.nextSibling; parent.removeChild(cursor);cursor=next; }
}
export function createRenderCache({makeBlock,makeList}) {
  const blocks=new Map(),lists=new Map();let pageId,usedBlocks,usedLists;
  function list(data,id) {
    usedLists.add(id);const shape=JSON.stringify(data.map(b=>b.id));let entry=lists.get(id);
    const nodes=data.map((b,index)=>block(b,id,index,data.length));
    if(!entry || entry.shape!==shape) {
      const fresh=makeList(data,id,nodes);
      if(!entry) { entry={shape,node:fresh.node};lists.set(id,entry); }
      reconcile(entry.node,fresh.children);entry.shape=shape;
    }
    else {
      // Drop slots and the add button keep their existing event handlers.
      const children=[...entry.node.childNodes];nodes.forEach((node,i)=>{children[i*2+1]=node;});reconcile(entry.node,children);
    }
    return entry.node;
  }
  function block(data,containerId,index,count) {
    usedBlocks.add(data.id);const signature=blockSignature(data);let entry=blocks.get(data.id);
    // Synchronize descendants independently; changes inside a tab do not rebuild
    // its headers or its parent block.
    for(const child of visibleContainers(data))list(child.blocks,child.id);
    const context=`${containerId}:${index}:${index===count-1}`;
    if(!entry || entry.signature!==signature || entry.context!==context) {
      entry={signature,context,node:makeBlock(renderData(data),containerId,index,count)};blocks.set(data.id,entry);
    }
    return entry.node;
  }
  return {
    begin(id) { if(id!==pageId){blocks.clear();lists.clear();pageId=id;}usedBlocks=new Set();usedLists=new Set(); },
    list,
    childList: id => lists.get(id).node,
    accept(id,data) { const entry=blocks.get(id);if(entry)entry.signature=blockSignature(data); },
    end() { for(const id of blocks.keys())if(!usedBlocks.has(id))blocks.delete(id);for(const id of lists.keys())if(!usedLists.has(id))lists.delete(id); },
  };
}
