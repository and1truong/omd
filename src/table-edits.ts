import type {NotebookStore} from './types.js';
import type {createCompositionGuard} from './composition.js';

interface Draft {pageId:string;blockId:string;rowId:string;columnId:string;value:string;saving?:Promise<void>}
export function createTableEdits(store:NotebookStore,composition:Pick<ReturnType<typeof createCompositionGuard>,'settled'>) {
  const drafts=new Map<string,Draft>();
  const key=(pageId:string,blockId:string,rowId:string,columnId:string)=>JSON.stringify([pageId,blockId,rowId,columnId]);
  async function flush(id:string,draft:Draft):Promise<void> {
    if(draft.saving){await draft.saving;if(drafts.get(id)===draft)await flush(id,draft);return;}
    const value=draft.value;
    draft.saving=(async()=>{
      await store.dispatch('table_cell_update',{pageId:draft.pageId,blockId:draft.blockId,rowId:draft.rowId,columnId:draft.columnId,text:value},{quiet:true});
      if(draft.value===value&&drafts.get(id)===draft)drafts.delete(id);
    })();
    try{await draft.saving;}finally{draft.saving=undefined;}
    if(drafts.get(id)===draft)await flush(id,draft);
  }
  return {
    value:(pageId:string,blockId:string,rowId:string,columnId:string,saved:string)=>drafts.get(key(pageId,blockId,rowId,columnId))?.value??saved,
    write(pageId:string,blockId:string,rowId:string,columnId:string,value:string) {
      const id=key(pageId,blockId,rowId,columnId);let draft=drafts.get(id);
      if(draft)draft.value=value;else{draft={pageId,blockId,rowId,columnId,value};drafts.set(id,draft);}
      return flush(id,draft);
    },
    async flushAll(){await composition.settled();await Promise.all([...drafts].map(([id,draft])=>flush(id,draft)));await store.idle();}
  };
}
