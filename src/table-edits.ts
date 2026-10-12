import type {NotebookStore} from './types.js';
import type {createCompositionGuard} from './composition.js';
import {errorOf} from './dom.js';

export type NativeTarget = {pageId:string;kind:'page';field:'title'|'subtitle'} | {pageId:string;kind:'title';blockId:string} | {pageId:string;kind:'cell';blockId:string;rowId:string;columnId:string};
interface Draft {target:NativeTarget;label:string;value:string;error?:Error;saving?:Promise<void>}
export function createNativeEdits(store:NotebookStore,composition:Pick<ReturnType<typeof createCompositionGuard>,'settled'> & {isComposingTarget?:(target:NativeTarget)=>boolean},onChange:()=>void=()=>{}) {
  const drafts=new Map<string,Draft>();
  const key=(target:NativeTarget)=>JSON.stringify(target.kind==='page'?[target.pageId,target.kind,target.field]:target.kind==='title'?[target.pageId,target.kind,target.blockId]:[target.pageId,target.kind,target.blockId,target.rowId,target.columnId]);
  function stage(target:NativeTarget,value:string,label:string) {
    const id=key(target);let draft=drafts.get(id);
    if(draft){draft.value=value;draft.label=label;}else{draft={target:{...target},value,label};drafts.set(id,draft);}
    onChange();return {id,draft};
  }
  async function flush(id:string,draft:Draft):Promise<void> {
    if(draft.saving){await draft.saving;if(drafts.get(id)===draft)await flush(id,draft);return;}
    const value=draft.value,target=draft.target;draft.error=undefined;
    draft.saving=Promise.resolve().then(async()=>{
      if(target.kind==='cell')await store.dispatch('table_cell_update',{pageId:target.pageId,blockId:target.blockId,rowId:target.rowId,columnId:target.columnId,text:value},{quiet:true});
      else if(target.kind==='title')await store.dispatch('update_block',{pageId:target.pageId,blockId:target.blockId,patch:{title:value}},{quiet:true});
      else await store.dispatch('set_page',{pageId:target.pageId,[target.field]:value},{quiet:true});
      if(draft.value===value&&drafts.get(id)===draft)drafts.delete(id);
    });
    onChange();
    try{await draft.saving;}catch(error){draft.error=errorOf(error);throw error;}finally{draft.saving=undefined;onChange();}
    if(drafts.get(id)===draft)await flush(id,draft);
  }
  return {
    id:key,
    value:(target:NativeTarget,saved:string)=>drafts.get(key(target))?.value??saved,
    stage,
    write(target:NativeTarget,value:string,label:string) {
      const {id,draft}=stage(target,value,label);return flush(id,draft);
    },
    list:()=>[...drafts].map(([id,draft])=>({id,target:{...draft.target},label:draft.label,value:draft.value,error:draft.error,saving:!!draft.saving})),
    async retry(id:string){const draft=drafts.get(id);if(draft)await flush(id,draft);},
    discard(id:string){const draft=drafts.get(id);if(draft?.saving)throw new Error('Wait for this edit to finish saving.');drafts.delete(id);onChange();},
    async flushAll({settle=true}:{settle?:boolean}={}){do{if(settle)await composition.settled();await Promise.all([...drafts].filter(([,draft])=>!composition.isComposingTarget?.(draft.target)).map(([id,draft])=>flush(id,draft)));await store.idle();}while(settle&&drafts.size);}
  };
}
export function createTableEdits(store:NotebookStore,composition:Pick<ReturnType<typeof createCompositionGuard>,'settled'>) {
  const edits=createNativeEdits(store,composition);
  const target=(pageId:string,blockId:string,rowId:string,columnId:string):NativeTarget=>({kind:'cell',pageId,blockId,rowId,columnId});
  return {
    value:(pageId:string,blockId:string,rowId:string,columnId:string,saved:string)=>edits.value(target(pageId,blockId,rowId,columnId),saved),
    write:(pageId:string,blockId:string,rowId:string,columnId:string,value:string)=>edits.write(target(pageId,blockId,rowId,columnId),value,'Table cell'),
    flushAll:edits.flushAll
  };
}
