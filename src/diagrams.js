import { findBlock } from './model.js';
import { mermaidSource } from './scene.js';
const stateKeys=['viewBackgroundColor','scrollX','scrollY','zoom','currentItemStrokeColor','currentItemBackgroundColor','currentItemFillStyle','currentItemStrokeWidth','currentItemStrokeStyle','currentItemRoughness','currentItemOpacity','currentItemFontFamily','currentItemFontSize','currentItemTextAlign','currentItemStartArrowhead','currentItemEndArrowhead','gridSize','gridStep','gridModeEnabled'];
export function createDiagramManager(store,{notify}) {
  const entries=new Map(); let used=new Set(),focused=null;
  const theme=()=>document.documentElement.dataset.theme === 'dark'?'dark':'light';
  const key=(pageId,blockId)=>`${pageId}:${blockId}`;
  function get(pageId,blockId) { return findBlock(store.getPage(pageId),blockId).block; }
  function flush(entry) {
    if (!entry.pending) return;
    clearTimeout(entry.saveTimer); const scene=entry.pending;
    try { store.dispatch('update_block',{pageId:entry.pageId,blockId:entry.blockId,patch:{scene}},{quiet:true}); entry.saved=JSON.stringify(scene); entry.pending=null; }
    catch(error) { notify(error.message,'error',true); }
  }
  function canvasChange(entry,elements,appState,files) {
    if (entry.disposed || !entry.api) return;
    const app=Object.fromEntries(stateKeys.filter(k=>appState[k]!==undefined).map(k=>[k,appState[k]]));
    const scene=JSON.parse(JSON.stringify({elements,appState:app,files}));
    if (JSON.stringify(scene)===entry.saved || JSON.stringify(scene)===JSON.stringify(entry.pending)) return;
    entry.pending=scene; clearTimeout(entry.saveTimer); entry.saveTimer=setTimeout(()=>flush(entry),160);
  }
  function scheduleMermaid(entry,source) {
    entry.source=source; const token=++entry.token; clearTimeout(entry.timer);
    entry.timer=setTimeout(async()=>{
      try {
        const definition=mermaidSource(entry.source); if(!definition) { entry.preview.textContent='Write a Mermaid diagram to see it here.'; return; }
        const engine=await import('./mermaid-engine.js');
        const result=await engine.renderDiagram(`diagram-${crypto.randomUUID()}`,definition,theme()==='dark');
        if(entry.disposed || token!==entry.token) return;
        const svg=new DOMParser().parseFromString(result.svg,'image/svg+xml').documentElement;
        entry.preview.replaceChildren(document.importNode(svg,true));entry.error.textContent='';
      } catch(error) { if(!entry.disposed && token===entry.token) { entry.preview.replaceChildren(); entry.error.textContent=`Diagram syntax: ${error.message}`; } }
    },200);
  }
  async function initializeCanvas(entry,scene) {
    try {
      window.EXCALIDRAW_ASSET_PATH=new URL('../excalidraw-assets/',import.meta.url).href;
      const cssURL=new URL('./excalidraw-engine.css',import.meta.url).href;
      if(!document.querySelector('link[data-excalidraw-css]')) { const css=document.createElement('link'); css.rel='stylesheet'; css.href=cssURL;css.dataset.excalidrawCss='true';document.head.append(css); }
      const engine=await import('./excalidraw-engine.js'); if(entry.disposed)return;
      entry.host.replaceChildren();
      entry.renderer=engine.mountCanvas(entry.host,scene,theme(),(...args)=>canvasChange(entry,...args),api=>{entry.api=api;});
    } catch(error) { entry.host.textContent=`Canvas could not load: ${error.message}`; }
  }
  function mount(block,pageId) {
    const id=key(pageId,block.id); used.add(id); let entry=entries.get(id);
    if(!entry) {
      const host=document.createElement('div');host.className=block.type==='mermaid'?'mermaid-body':'excalidraw-host'; host.dataset.diagramBlock=block.id;
      entry={host,pageId,blockId:block.id,type:block.type,token:0,saved:block.scene?JSON.stringify(block.scene):null,disposed:false};entries.set(id,entry);
      if(block.type==='mermaid') { entry.preview=document.createElement('div');entry.preview.className='mermaid-preview';entry.preview.dataset.mermaidPreview='true';entry.preview.setAttribute('role','img');entry.preview.setAttribute('aria-label',block.title);entry.error=document.createElement('p');entry.error.className='diagram-error';entry.error.setAttribute('role','status');host.append(entry.preview,entry.error);scheduleMermaid(entry,block.source); }
      else { host.textContent='Opening your canvas…'; initializeCanvas(entry,block.scene); }
    } else if(block.type==='mermaid') { if(entry.source!==block.source) scheduleMermaid(entry,block.source); }
    else if(entry.api && entry.saved!==JSON.stringify(block.scene) && !entry.pending) {
      entry.saved=JSON.stringify(block.scene);entry.api.updateScene({...entry.renderer.restore(block.scene),appState:{...block.scene.appState,theme:theme()},captureUpdate:'NEVER'});
      if(Object.keys(block.scene.files).length) entry.api.addFiles(Object.values(block.scene.files));
    }
    if(block.type==='excalidraw'&&entry.renderer)entry.renderer.draw(block.scene,theme());
    return entry.host;
  }
  function closeFocus() {
    if(!focused)return;
    const entry=entries.get(focused);if(entry) { flush(entry);const placeholder=document.querySelector(`[data-canvas-placeholder="${entry.blockId}"]`); if(placeholder)placeholder.replaceChildren(entry.host); }
    focused=null;document.getElementById('canvas-stage').hidden=true;document.body.classList.remove('canvas-focused');
  }
  function openFocus(blockId) {
    closeFocus();const page=store.getState(),block=findBlock(page,blockId,'excalidraw').block;
    const host=mount(block,page.id); focused=key(page.id,block.id);
    document.getElementById('canvas-stage-title').textContent=page.title || 'Untitled page';
    document.getElementById('canvas-stage-subtitle').textContent=page.subtitle;
    document.getElementById('canvas-stage').hidden=false;document.getElementById('canvas-stage-host').replaceChildren(host);document.body.classList.add('canvas-focused');
    requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
  }
  function cleanup(entry) { flush(entry);entry.disposed=true;clearTimeout(entry.timer);clearTimeout(entry.saveTimer);entry.renderer?.unmount();entries.delete(key(entry.pageId,entry.blockId)); }
  return {
    mount,openFocus,closeFocus,
    updateSource(blockId,source) { const entry=entries.get(key(store.getState().id,blockId));if(entry)scheduleMermaid(entry,source); },
    begin() { used=new Set(); if(focused) { const entry=entries.get(focused);try{get(entry.pageId,entry.blockId);if(entry.pageId!==store.getState().id)closeFocus();}catch{closeFocus();} } },
    end() { if(focused)used.add(focused);for(const [id,entry] of entries)if(!used.has(id))cleanup(entry); if(focused){const entry=entries.get(focused);document.getElementById('canvas-stage-host').replaceChildren(entry.host);} },
    themeChanged() { for(const entry of entries.values()) { if(entry.type==='mermaid')scheduleMermaid(entry,entry.source);else if(entry.renderer)entry.renderer.draw(get(entry.pageId,entry.blockId).scene,theme()); } },
    flushAll() {for(const entry of entries.values())flush(entry);},
    beforeNavigate() {closeFocus();for(const entry of entries.values())flush(entry);},
    syncHeader() { if(focused) { document.getElementById('canvas-stage-title').textContent=store.getState().title;document.getElementById('canvas-stage-subtitle').textContent=store.getState().subtitle; } }
  };
}
