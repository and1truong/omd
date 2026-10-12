import type {NotebookStore,ErrorHandler} from './types.js';
import {errorOf} from './dom.js';

export const appBase=new URL('../',import.meta.url);
export const pagePath=(id:string)=>`${appBase.pathname}page/${encodeURIComponent(id)}`;
export function routePageId(path=location.pathname,base=appBase.pathname):string|undefined|null {
  if(path===base||path===`${base}index.html`)return undefined;
  if(!path.startsWith(`${base}page/`))return null;
  const encoded=path.slice(`${base}page/`.length).replace(/\/$/,'');
  if(!encoded||encoded.includes('/'))return null;
  try{return decodeURIComponent(encoded);}catch{return null;}
}
export function followPageLink(event:MouseEvent,navigate:()=>unknown) {
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  event.preventDefault();navigate();
}
export function setupRoutes(store:NotebookStore,{beforeNavigate,onError}:{beforeNavigate:()=>Promise<unknown>;onError:ErrorHandler}) {
  let traversing=false,queue=Promise.resolve();
  function sync(push=false) {
    const path=pagePath(store.getActivePageId());
    if(location.pathname!==path)history[push?'pushState':'replaceState'](null,'',path);
  }
  const initial=routePageId();
  if(initial===null||initial!==undefined&&initial!==store.getActivePageId())onError(new Error('That page is missing or was deleted. Opened an existing notebook page instead.'));
  sync();
  store.subscribe((_page,event)=>{if(!traversing)sync(event.actionName==='page_select'||event.actionName==='page_add');});
  window.addEventListener('popstate',()=>{
    const id=routePageId();
    queue=queue.then(async()=>{
      traversing=true;
      try {
        await beforeNavigate();
        if(id===null||id!==undefined&&!store.getPageMetadata(id))throw new Error('That page is missing or was deleted.');
        if(id!==undefined)await store.dispatch('page_select',{pageId:id});
      }catch(error){onError(errorOf(error));}
      finally{traversing=false;sync();}
    });
  });
}
