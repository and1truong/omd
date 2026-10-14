import type {Notebook,Page,NotebookStore,StoreOptions,StorageLike,Records,RecordChange,ChangeEvent,Journal,CommandName,CommandInput,MutationResult,InternalInput,ActionResult,SaveStatus,BridgeWrite} from './types.js';
import {BridgeError} from './bridge-error.js';
import {success,withinMessageCap} from './bridge-engine.js';
import {errorOf} from './dom.js';
import { STORAGE_KEY, mutatePage, validateNotebook } from './model.js';
import { initialNotebook, validateBook, parseBook, listPages, applyBookAction } from './notebook.js';
import {isCloudflare} from './runtime.js';
import { openRepository } from './repository.js';
import { pageRecords, bookRecords, metadataBook, recordChanges, makeMaterializer, recordKey, nativeRecordKey } from './records.js';
import { createZustandStore, subscribeWithSelector, produce, produceWithPatches, applyPatches, enablePatches, freeze } from './state-engine.js';
enablePatches();
/** Serialized events, immutable selectors, durable record transactions. Only the active page is resident. */
export async function createStore(storage:StorageLike,options:StoreOptions = {}):Promise<NotebookStore> {
  const remote=isCloudflare||!!options.cloudEndpoint;
  const repository=remote?await (await import('./cloudflare-repository.js')).openCloudflareRepository(options.cloudEndpoint):await openRepository(storage,{key:STORAGE_KEY,initial:initialNotebook,...options});
  let releaseLease:(()=>void)|undefined,channel:BroadcastChannel|null=null;
  try{
  const owner=crypto.randomUUID(),locks=options.locks??globalThis.navigator?.locks;
  if(locks?.request){
    let readyLease!:()=>void,rejectLease!:(error:unknown)=>void;const ready=new Promise<void>((resolve,reject)=>{readyLease=resolve;rejectLease=reject;});
    locks.request(`${repository.name}.history:${owner}`,()=>{readyLease();return new Promise<void>(resolve=>{releaseLease=resolve;});}).catch(rejectLease);await ready;
  }
  let loaded=await repository.read(undefined,options.activePageId),materialize=makeMaterializer();
  validateNotebook(materialize(loaded!.records!,loaded!.meta.activePageId));
  interface State {meta:Notebook;records:Records;options:ChangeEvent;page:Page}
  const state=createZustandStore<State>()(subscribeWithSelector<State>(()=>({meta:loaded!.meta,records:new Map(),options:{},page:{...loaded!.meta.pages.find(p=>p.id===loaded!.meta.activePageId)!,blocks:[]}})));
  state.setState({meta:freeze(loaded!.meta,true),records:loaded!.records!,page:freeze(materialize(loaded!.records!,loaded!.meta.activePageId),true)});loaded=null;
  const undoStack:string[]=[],redoStack:string[]=[],afterChange=new Set<()=>void>();let queue:Promise<unknown>=Promise.resolve();let closed=true,pending=0,pendingWrites=0,navigations=0,lastError:Error|null=null,failedCloudWrite=false;const statusListeners=new Set<(status:SaveStatus)=>void>();
  function status(){return {pending,navigating:navigations>0,error:lastError,...(remote?{unsaved:pendingWrites>0||failedCloudWrite}:{})};}
  function notifyStatus(){for(const fn of statusListeners)fn(status());}
  function enqueue<T>(fn:()=>Promise<T>,navigate=false,write=false):Promise<T>{pending++;if(write)pendingWrites++;if(navigate)navigations++;notifyStatus();const task=queue.then(fn).catch(error=>{lastError=errorOf(error);if(remote&&write)failedCloudWrite=true;throw error;}).finally(()=>{pending--;if(write)pendingWrites--;if(navigate)navigations--;notifyStatus();});queue=task.catch(()=>{});return task;}
  function publish(meta:Notebook,records:Records,event:ChangeEvent={}) {
    if(meta.activePageId!==state.getState().meta.activePageId)materialize=makeMaterializer();
    state.setState({meta:freeze(meta,true),records,options:event,page:freeze(materialize(records,meta.activePageId),true)});
    for(const fn of afterChange)fn();
  }
  function patchChanges(changes:RecordChange[]){return changes.map(({key,before,after})=>{
    const [,forward,inverse]=produceWithPatches({value:before},draft=>{
      if(!before||!after||before.kind!==after.kind)draft.value=after;
      else {const previous=before.data as unknown as Record<string,unknown>,data=draft.value!.data as unknown as Record<string,unknown>;for(const field of Object.keys(previous))if(!Object.hasOwn(after.data,field))delete data[field];for(const [field,value]of Object.entries(after.data))if(previous[field]!==value)data[field]=value;}
    });return {key,forward,inverse};});}
  async function commit(next:Notebook,changes:RecordChange[],event:ChangeEvent,{history=true,bridge}:{history?:boolean;bridge?:(BridgeWrite&{data:unknown})}={}) {
    const current=state.getState();const id=history?crypto.randomUUID():null;
    const entry=history?{owner,before:current.meta,after:next,changes:patchChanges(changes)}:null;
    const {records:hydrated,replay}=await repository.commit(current.meta,next,changes,{journal:history?entry:null,journalId:id,deleteHistory:history?[...redoStack]:[],bridge});
    if(replay)return replay;
    lastError=null;failedCloudWrite=false;
    if(history){undoStack.push(id!);redoStack.length=0;}
    let records;
    if(next.activePageId===current.meta.activePageId){records=new Map(current.records);for(const c of changes)if((c.after??c.before)?.pageId===next.activePageId){if(c.after)records.set(recordKey(...c.key),c.after);else records.delete(recordKey(...c.key));}}
    else records=hydrated!;
    publish(next,records,event);channel?.postMessage(next.revision);
  }
  channel=typeof window!=='undefined'&&typeof BroadcastChannel!=='undefined'?new BroadcastChannel(`${repository.name}.changes`):null;
  const api:NotebookStore={
    databaseName:()=>repository.name,
    getNotebookId:()=>state.getState().meta.id,
    getRevision:()=>state.getState().meta.revision,
    getActivePageId:()=>state.getState().meta.activePageId,
    getState:()=>structuredClone(state.getState().page),
    getRenderState:()=>state.getState().page,
    getLastEvent:()=>state.getState().options,
    afterChange(fn){afterChange.add(fn);return ()=>afterChange.delete(fn);},
    subscribeStatus(fn){statusListeners.add(fn);fn(status());return ()=>statusListeners.delete(fn);},
    getPageMetadata:id=>state.getState().meta.pages.find(p=>p.id===id),
    async getPage(pageId=api.getActivePageId()){await queue;if(pageId===api.getActivePageId())return api.getState();return structuredClone(makeMaterializer()(await repository.page(pageId),pageId));},
    async getNotebook(){await queue;const book=await repository.export();if(book.pages.some(p=>p.id===api.getActivePageId()))book.activePageId=api.getActivePageId();return book;},
    listPages:()=>listPages(state.getState().meta),
    dispatch<K extends CommandName>(action:K,input:CommandInput<K>,options:ChangeEvent={},bridge?:BridgeWrite) {
      const payload=structuredClone(input) as InternalInput;const target=payload.pageId??api.getActivePageId();
      return enqueue(async()=>{
        // A completed deletion/addition must replay before trying to resolve its old IDs.
        if(bridge){const replay=await repository.bridgeReceipt(bridge);if(replay){lastError=null;failedCloudWrite=false;return structuredClone(replay.data) as MutationResult<K>;}}
        const current=state.getState();let next:Notebook,changes:RecordChange[],result:ActionResult;
        if(bridge&&(current.meta.id!==bridge.notebookId||current.meta.revision!==bridge.expectedRevision))throw new BridgeError('STALE_CONTEXT','The notebook revision changed. Get fresh context and approve again.');
        if(action==='page_select') {
          if(bridge)throw new BridgeError('UNSUPPORTED','Agent navigation is not a durable notebook mutation.');
          const out=applyBookAction(current.meta,action,payload);
          const records=out.state.activePageId!==current.meta.activePageId?await repository.page(out.state.activePageId):current.records;
          lastError=null;publish({...current.meta,activePageId:out.state.activePageId},records,{actionName:action,...options});
          return {revision:current.meta.revision} as MutationResult<K>;
        }
        if(action==='import_notebook') {
          const out=applyBookAction(current.meta,action,payload);next=metadataBook(out.state);result=out.result;
          const old=await repository.export();changes=recordChanges(bookRecords(old),bookRecords(out.state));
        }else if(action.startsWith('page_')) {
          const out=applyBookAction(current.meta,action,payload);next=out.state;result=out.result;changes=[];
          const oldPages=new Map(current.meta.pages.map(p=>[p.id,p]));
          for(const page of next.pages){const previous=oldPages.get(page.id);if(!previous){changes.push(...recordChanges(new Map(),pageRecords(page)));}else if(JSON.stringify(previous)!==JSON.stringify(page)){const {blocks,...data}=page;changes.push({key:[page.id,'page',page.id],before:{kind:'page',pageId:page.id,id:page.id,data:((({blocks,...v})=>v)(previous))},after:{kind:'page',pageId:page.id,id:page.id,data}});}}
          for(const page of current.meta.pages)if(!next.pages.some(p=>p.id===page.id)){const removed=await repository.page(page.id);for(const before of removed.values())changes.push({key:nativeRecordKey(before),before,after:null});}
        }else {
          const {pageId,...args}=payload;
          const records=target===current.meta.activePageId?current.records:await repository.page(target);
          const page=target===current.meta.activePageId?current.page:freeze(makeMaterializer()(records,target),true);
          let output:ReturnType<typeof mutatePage>;const edited=produce(page,draft=>{output=mutatePage(draft,action,args,false);});result=output!.result;validateNotebook(edited);
          changes=recordChanges(records,pageRecords(edited));
          const {blocks,...metadata}=edited;
          next={...current.meta,pages:current.meta.pages.map(p=>p.id===target?{...metadata,blocks:[]}:p),revision:current.meta.revision+1,updatedAt:new Date().toISOString()};validateBook(next);
        }
        const data={...result,revision:next.revision};
        if(bridge&&!Number.isSafeInteger(next.revision))throw new BridgeError('UNSUPPORTED','The notebook revision cannot be advanced safely. No edit was saved.');
        if(bridge&&!withinMessageCap(success(data,next.revision)))throw new BridgeError('INVALID_ARGUMENT','The result exceeds the Bridge message limit. No edit was saved.');
        const replay=await commit(next,changes,{actionName:action,changedBlockId:payload.blockId,changedPageId:target,...options},{history:options.history??!['reminder_fired','page_select'].includes(action),bridge:bridge?{...bridge,data}:undefined});
        return (replay?structuredClone(replay.data):data) as MutationResult<K>;
      },['page_select','page_add','page_remove','import_notebook'].includes(action),!['page_select','reminder_fired'].includes(action));
    },
    subscribe(fn){return state.subscribe(s=>s.meta,()=>{const s=state.getState();fn(s.page,s.options);});},
    subscribeBlock(id,fn){return state.subscribe(s=>[s.records.get(recordKey(s.meta.activePageId,'block',id))?.data,s.records.get(recordKey(s.meta.activePageId,'scene',id))?.data,s.records.get(recordKey(s.meta.activePageId,'files',id))?.data],()=>fn(state.getState().page,state.getState().options),{equalityFn:(a,b)=>a[0]===b[0]&&a[1]===b[1]&&a[2]===b[2]});},
    subscribeContainer(id,fn){return state.subscribe(s=>s.records.get(recordKey(s.meta.activePageId,'container',id))?.data && (s.records.get(recordKey(s.meta.activePageId,'container',id))!.data as import('./types.js').ContainerRecord).blockIds,()=>fn(state.getState().page,state.getState().options));},
    export:async()=>JSON.stringify(await api.getNotebook(),null,2),
    import(raw,options){return api.dispatch('import_notebook',{notebook:parseBook(raw)},options);},
    reload(){if(options.canReload?.()===false||remote&&(pending||failedCloudWrite))return Promise.resolve();return enqueue(async()=>{const current=state.getState(),loaded=await repository.read(current.meta,current.meta.activePageId);if(options.canReload?.()===false||remote&&(pending>1||failedCloudWrite))return;if(!loaded)throw new Error('Saved notebook is missing.');if(remote)lastError=null;if(loaded.meta.id===current.meta.id&&loaded.meta.revision===current.meta.revision)return;await repository.pruneHistory([...undoStack,...redoStack]);undoStack.length=redoStack.length=0;materialize=makeMaterializer();lastError=null;publish(loaded.meta,loaded.records!,{reset:true});});},
    dueReminders:now=>repository.due(now),
    canUndo:()=>undoStack.length>0,canRedo:()=>redoStack.length>0,
    undo:()=>restore(undoStack,redoStack,'inverse'),redo:()=>restore(redoStack,undoStack,'forward'),
    idle:()=>queue,
    async close(){closed=true;channel?.close();channel=null;await queue;try{await repository.pruneOwner(owner);}finally{releaseLease?.();repository.close();}},
    // Read-only diagnostic: no page data is retained by this descriptor.
    residency:()=>({pageId:api.getActivePageId(),pageCount:state.getState().meta.pages.length,recordCount:state.getState().records.size,undoEntries:undoStack.length})
  };
  async function restore(from:string[],to:string[],direction:'inverse'|'forward'){return enqueue(async()=>{
    if(!from.length)return false;
    const current=state.getState(),entry=await repository.history(from.at(-1)!);
    const records=await repository.records(entry.changes.map(p=>p.key)),changes=entry.changes.map(p=>({key:p.key,before:records.get(recordKey(...p.key))??null,after:applyPatches({value:records.get(recordKey(...p.key))??null},p[direction]).value}));
    let next=structuredClone(direction==='inverse'?entry.before:entry.after);next.revision=current.meta.revision+1;next.updatedAt=new Date().toISOString();if(next.pages.some(p=>p.id===current.meta.activePageId))next.activePageId=current.meta.activePageId;
    validateBook(next);const {records:hydrated}=await repository.commit(current.meta,next,changes);lastError=null;failedCloudWrite=false;const id=from.pop()!;to.push(id);let resident;
    if(next.activePageId===current.meta.activePageId){resident=new Map(current.records);for(const c of changes)if((c.after??c.before)?.pageId===next.activePageId){if(c.after)resident.set(recordKey(...c.key),c.after);else resident.delete(recordKey(...c.key));}}
    else resident=hydrated!;
    publish(next,resident);channel?.postMessage(next.revision);return true;
  },false,true);}
  if(channel)channel.onmessage=()=>{if(!closed)api.reload().catch(()=>{});};
  if(locks?.request)for(const previous of await repository.historyOwners())await locks.request(`${repository.name}.history:${previous}`,{ifAvailable:true},async lock=>{if(lock)await repository.pruneOwner(previous);});
  closed=false;
  return api;
  }catch(error){
    try{channel?.close();}finally{try{releaseLease?.();}finally{repository.close();}}
    throw error;
  }
}
