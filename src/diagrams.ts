import type {NotebookStore,Notify,Scene,MermaidBlock,ExcalidrawBlock,ResolvedTheme} from './types.js';
import type {CanvasAPI,CanvasChange,mountCanvas} from './excalidraw-engine.js';
import {errorOf} from './dom.js';
import {byId as domId} from './dom.js';
import { findBlock } from './model.js';
import { mermaidSource } from './scene.js';
const stateKeys=['viewBackgroundColor','scrollX','scrollY','zoom','currentItemStrokeColor','currentItemBackgroundColor','currentItemFillStyle','currentItemStrokeWidth','currentItemStrokeStyle','currentItemRoughness','currentItemOpacity','currentItemFontFamily','currentItemFontSize','currentItemTextAlign','currentItemStartArrowhead','currentItemEndArrowhead','gridSize','gridStep','gridModeEnabled'];
export const diagramKey=(pageId:string,blockId:string)=>JSON.stringify([pageId,blockId]);
export function createDiagramManager(store:NotebookStore,{notify}:{notify:Notify}) {
  interface Entry {host:HTMLDivElement;pageId:string;blockId:string;type:'mermaid'|'excalidraw';token:number;saved:string|null;disposed:boolean;pending?:Scene|null;saving?:Promise<unknown>|null;saveTimer?:ReturnType<typeof setTimeout>;timer?:ReturnType<typeof setTimeout>;source?:string|null;preview?:HTMLDivElement;error?:HTMLParagraphElement;renderer?:ReturnType<typeof mountCanvas>|null;api?:CanvasAPI|null}
  const entries=new Map<string,Entry>();let used=new Set<string>(),focused:string|null=null;
  const theme=():ResolvedTheme=>document.documentElement.dataset.theme === 'dark'?'dark':'light';
  const key=diagramKey;
  function get(pageId:string,blockId:string) {if(pageId!==store.getActivePageId())throw new Error('Canvas page is inactive.');return findBlock(store.getRenderState(),blockId,'excalidraw').block;}
  async function flush(entry:Entry):Promise<void> {
    if (!entry.pending) return;
    if(entry.saving){await entry.saving;if(entry.pending)return flush(entry);return;}
    clearTimeout(entry.saveTimer); const scene=entry.pending;
    try { entry.saving=store.dispatch('update_block',{pageId:entry.pageId,blockId:entry.blockId,patch:{scene}},{quiet:true});await entry.saving; entry.saved=JSON.stringify(scene); if(entry.pending===scene)entry.pending=null; }
    catch(error) { notify(errorOf(error).message,'error',true); throw error; }finally{entry.saving=null;}
    if(entry.pending)await flush(entry);
  }
  function canvasChange(entry:Entry,...[elements,appState,files]:Parameters<CanvasChange>) {
    if (entry.disposed || !entry.api) return;
    const app=Object.fromEntries(stateKeys.filter(k=>(appState as unknown as Record<string,unknown>)[k]!==undefined).map(k=>[k,(appState as unknown as Record<string,unknown>)[k]]));
    const scene=JSON.parse(JSON.stringify({elements,appState:app,files}));
    if (JSON.stringify(scene)===entry.saved || JSON.stringify(scene)===JSON.stringify(entry.pending)) return;
    entry.pending=scene;if(!entry.saving)flush(entry).catch(()=>{});
  }
  function scheduleMermaid(entry:Entry,source:string) {
    entry.source=source; const token=++entry.token; clearTimeout(entry.timer);
    entry.timer=setTimeout(async()=>{
      try {
        const definition=mermaidSource(entry.source??''); if(!definition) { entry.error!.textContent='';entry.preview!.textContent='Write a Mermaid diagram to see it here.'; return; }
        const engine=await import('./mermaid-engine.js');
        if(entry.disposed || token!==entry.token)return;
        const result=await engine.renderDiagram(`diagram-${crypto.randomUUID()}`,definition,theme()==='dark');
        if(entry.disposed || token!==entry.token) return;
        const svg=new DOMParser().parseFromString(result.svg,'image/svg+xml').documentElement;
        entry.preview!.replaceChildren(document.importNode(svg,true));entry.error!.textContent='';
      } catch(error) { if(!entry.disposed && token===entry.token) { entry.preview!.replaceChildren(); entry.error!.textContent=`Diagram syntax: ${errorOf(error).message}`; } }
    },200);
  }
  function syncScene(entry:Entry,scene:Scene) {
    if(!entry.api || !entry.renderer || entry.pending || entry.saved===JSON.stringify(scene))return;
    entry.saved=JSON.stringify(scene);entry.api.updateScene({...entry.renderer.restore(scene),appState:{...scene.appState,theme:theme()} as Parameters<CanvasAPI['updateScene']>[0]['appState'],captureUpdate:'NEVER' as Parameters<CanvasAPI['updateScene']>[0]['captureUpdate']});
    if(Object.keys(scene.files).length)entry.api.addFiles(Object.values(scene.files) as unknown as Parameters<CanvasAPI['addFiles']>[0]);
  }
  async function initializeCanvas(entry:Entry) {
    try {
      window.EXCALIDRAW_ASSET_PATH=new URL('../excalidraw-assets/',import.meta.url).href;
      const cssURL=new URL('./excalidraw-engine.css',import.meta.url).href;
      if(!document.querySelector('link[data-excalidraw-css]')) { const css=document.createElement('link'); css.rel='stylesheet'; css.href=cssURL;css.dataset.excalidrawCss='true';document.head.append(css); }
      const engine=await import('./excalidraw-engine.js'); if(entry.disposed)return;
      entry.host.replaceChildren();
      // Agent edits can arrive while the library chunk is still downloading.
      // Read the latest scene at mount, then reconcile again when its API is ready.
      const scene=get(entry.pageId,entry.blockId).scene;entry.saved=JSON.stringify(scene);
      entry.renderer=engine.mountCanvas(entry.host,scene,theme(),(...args:Parameters<CanvasChange>)=>canvasChange(entry,...args),api=>{entry.api=api;if(!entry.disposed)syncScene(entry,get(entry.pageId,entry.blockId).scene);});
    } catch(error) { entry.host.textContent=`Canvas could not load: ${errorOf(error).message}`; }
  }
  function mount(block:MermaidBlock|ExcalidrawBlock,pageId:string) {
    const id=key(pageId,block.id); used.add(id); let entry=entries.get(id);
    // A valid imported notebook may reuse an ID with a different block type.
    if(entry && entry.type!==block.type) { cleanup(entry);entry=undefined; }
    if(!entry) {
      const host=document.createElement('div');host.className=block.type==='mermaid'?'mermaid-body':'excalidraw-host'; host.dataset.diagramBlock=block.id;
      entry={host,pageId,blockId:block.id,type:block.type,token:0,saved:block.type==='excalidraw'?JSON.stringify(block.scene):null,disposed:false};entries.set(id,entry);
      if(block.type==='mermaid') { entry.preview=document.createElement('div');entry.preview.className='mermaid-preview';entry.preview.dataset.mermaidPreview='true';entry.preview.setAttribute('role','img');entry.preview.setAttribute('aria-label',block.title);entry.error=document.createElement('p');entry.error.className='diagram-error';entry.error.setAttribute('role','status');host.append(entry.preview,entry.error);scheduleMermaid(entry,block.source); }
      else { host.textContent='Opening your canvas…'; initializeCanvas(entry); }
    } else if(block.type==='mermaid') { if(entry.source!==block.source) scheduleMermaid(entry,block.source); }
    else if(block.type==='excalidraw')syncScene(entry,block.scene);
    return entry.host;
  }
  function closeFocus() {
    if(!focused)return;
    const entry=entries.get(focused)!;if(entry) { flush(entry).catch(()=>{});const placeholder=document.querySelector(`[data-canvas-placeholder="${CSS.escape(entry.blockId)}"]`); if(placeholder)placeholder.replaceChildren(entry.host); }
    focused=null;domId('canvas-stage').hidden=true;document.body.classList.remove('canvas-focused');
  }
  function openFocus(blockId:string) {
    closeFocus();const page=store.getRenderState(),block=findBlock(page,blockId,'excalidraw').block;
    const host=mount(block,page.id); focused=key(page.id,block.id);
    domId('canvas-stage-title').textContent=page.title || 'Untitled page';
    domId('canvas-stage-subtitle').textContent=page.subtitle;
    domId('canvas-stage').hidden=false;domId('canvas-stage-host').replaceChildren(host);document.body.classList.add('canvas-focused');
    requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
  }
  function cleanup(entry:Entry) {entry.disposed=true;clearTimeout(entry.timer);clearTimeout(entry.saveTimer);entry.renderer?.unmount();entry.api=null;entry.renderer=null;entry.pending=null;entry.saved=null;entry.source=null;entry.host.replaceChildren();entries.delete(key(entry.pageId,entry.blockId)); }
  return {
    mount,openFocus,closeFocus,
    updateSource(pageId:string,blockId:string,source:string) { const entry=entries.get(key(pageId,blockId));if(entry)scheduleMermaid(entry,source); },
    begin() { used=new Set(); if(focused) { const entry=entries.get(focused)!;try{const block=get(entry.pageId,entry.blockId);if(entry.pageId!==store.getRenderState().id||block.type!=='excalidraw')closeFocus();}catch{closeFocus();} } },
    end() {
      // Cached blocks do not call mount again. Derive lifetime from the connected
      // visible notebook, rather than from how many blocks were rebuilt.
      const pageId=store.getActivePageId();
      used=new Set([...document.querySelectorAll<HTMLElement>('#notebook [data-diagram-block]')].map(host=>key(pageId,host.dataset.diagramBlock!)));
      if(focused) {
        const entry=entries.get(focused)!;
        if(!document.querySelector(`#notebook [data-canvas-placeholder="${CSS.escape(entry.blockId)}"]`))closeFocus();
        else used.add(focused);
      }
      for(const [id,entry] of entries)if(!used.has(id))cleanup(entry);
      if(focused){const entry=entries.get(focused)!;const stage=domId('canvas-stage-host');if(entry.host.parentNode!==stage)stage.replaceChildren(entry.host);}
    },
    themeChanged() { for(const entry of entries.values()) { if(entry.type==='mermaid')scheduleMermaid(entry,entry.source??'');else if(entry.renderer)entry.renderer.draw(get(entry.pageId,entry.blockId).scene,theme()); } },
    hasPending(){return [...entries.values()].some(entry=>entry.pending||entry.saving);},
    async flushAll() {await Promise.all([...entries.values()].map(flush));await store.idle();},
    async beforeNavigate() {await this.flushAll();closeFocus();},
    syncHeader() { if(focused) { domId('canvas-stage-title').textContent=store.getRenderState().title;domId('canvas-stage-subtitle').textContent=store.getRenderState().subtitle; } }
  };
}
