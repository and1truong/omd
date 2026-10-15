import type {Page,Notebook,Block,BlockMetadata,Scene,Records,StoredRecord,RecordKind,RecordData,RecordChange,RecordKey} from './types.js';
// String keys are only an in-memory equality cache; IndexedDB and journals use native tuples.
export const recordKey=(pageId:string,kind:RecordKind,id:string)=>JSON.stringify([pageId,kind,id]);
export const nativeRecordKey=({pageId,kind,id}:StoredRecord):RecordKey=>[pageId,kind,id];
export const recordsMap=(rows:StoredRecord[]):Records=>new Map(rows.map(r=>[recordKey(...nativeRecordKey(r)),r]));
const ownCache=new WeakMap<Block,BlockMetadata>(),containerCache=new WeakMap<Block[],string[]>(),sceneCache=new WeakMap<Scene,Omit<Scene,'files'>>();
function own(block:Block):BlockMetadata {
  switch(block.type){
    case 'tabs':return {...block,tabs:block.tabs.map(({blocks,...tab})=>tab)};
    case 'columns':return {...block,columns:block.columns.map(({blocks,...column})=>column)};
    case 'toggle':{const {blocks,...data}=block;return data;}
    case 'accordion':return {...block,items:block.items.map(({blocks,...item})=>item)};
    case 'excalidraw':{const {scene,...data}=block;return data;}
    default:return block;
  }
}
export function pageRecords(page:Page):Records {
  const records:Records=new Map(),{blocks,...metadata}=page;
  records.set(recordKey(page.id,'page',page.id),{kind:'page',pageId:page.id,id:page.id,data:metadata});
  function list(blocks:Block[],id:string):void {
    let ids=containerCache.get(blocks);if(!ids){ids=blocks.map(b=>b.id);containerCache.set(blocks,ids);}
    records.set(recordKey(page.id,'container',id),{kind:'container',pageId:page.id,id,data:{id,blockIds:ids}});
    for(const block of blocks){
      let data=ownCache.get(block);if(!data){data=own(block);ownCache.set(block,data);}
      records.set(recordKey(page.id,'block',block.id),{kind:'block',pageId:page.id,id:block.id,data});
      if(block.type==='excalidraw'){let scene=sceneCache.get(block.scene);if(!scene){const {files,...data}=block.scene;scene=data;sceneCache.set(block.scene,scene);}records.set(recordKey(page.id,'scene',block.id),{kind:'scene',pageId:page.id,id:block.id,data:scene});records.set(recordKey(page.id,'files',block.id),{kind:'files',pageId:page.id,id:block.id,data:block.scene.files});}
      if(block.type==='tabs')for(const tab of block.tabs)list(tab.blocks,tab.id);
      if(block.type==='toggle')list(block.blocks,block.id);
      if(block.type==='accordion')for(const item of block.items)list(item.blocks,item.id);
      if(block.type==='columns')for(const column of block.columns)list(column.blocks,column.id);
    }
  }
  list(blocks,'page');return records;
}
export function bookRecords(book:Notebook):Records {const records:Records=new Map();for(const page of book.pages)for(const [key,value]of pageRecords(page))records.set(key,value);return records;}
export function metadataBook(book:Notebook):Notebook {return {...book,pages:book.pages.map(({blocks,...page})=>({...page,blocks:[]}))};}
interface CacheEntry {data:BlockMetadata;scene:Omit<Scene,'files'>|undefined;files:Scene['files']|undefined;children:Block[][];value:Block}
export function makeMaterializer() {
  const cache=new Map<string,CacheEntry>();
  return function materialize(records:Records,pageId:string):Page {
    function get<K extends RecordKind>(id:string,kind:K):RecordData[K] {const record=records.get(recordKey(pageId,kind,id));if(!record||record.kind!==kind)throw new Error(`Saved ${kind} record is missing.`);return record.data as RecordData[K];}
    function list(id:string):Block[]{const ids=get(id,'container').blockIds,result=ids.map(block);containerCache.set(result,ids);return result;}
    function block(id:string):Block {
      const data=get(id,'block'),scene=data.type==='excalidraw'?get(id,'scene'):undefined,files=data.type==='excalidraw'?get(id,'files'):undefined;let children:Block[][]=[];
      if(data.type==='tabs')children=data.tabs.map(t=>list(t.id));if(data.type==='toggle')children=[list(id)];if(data.type==='accordion')children=data.items.map(t=>list(t.id));if(data.type==='columns')children=data.columns.map(t=>list(t.id));
      const previous=cache.get(id);if(previous&&previous.data===data&&previous.scene===scene&&previous.files===files&&children.length===previous.children.length&&children.every((c,i)=>c.length===previous.children[i].length&&c.every((b,j)=>b===previous.children[i][j])))return previous.value;
      let value:Block;
      switch(data.type){
        case 'excalidraw':{const fullScene=previous?.scene===scene&&previous?.files===files&&previous?.value.type==='excalidraw'?previous.value.scene:{...scene!,files:files!};sceneCache.set(fullScene,scene!);value={...data,scene:fullScene};break;}
        case 'tabs':value={...data,tabs:data.tabs.map((t,i)=>({...t,blocks:children[i]}))};break;
        case 'toggle':value={...data,blocks:children[0]};break;
        case 'columns':value={...data,columns:data.columns.map((c,i)=>({...c,blocks:children[i]}))};break;
        case 'accordion':value={...data,items:data.items.map((t,i)=>({...t,blocks:children[i]}))};break;
        default:value=data;
      }
      ownCache.set(value,data);cache.set(id,{data,scene,files,children,value});return value;
    }
    const value={...get(pageId,'page'),blocks:list('page')};for(const id of cache.keys())if(!records.has(recordKey(pageId,'block',id)))cache.delete(id);return value;
  };
}
export function equalRecord(a:StoredRecord|null|undefined,b:StoredRecord|null|undefined):boolean {if(a===b||a?.data===b?.data)return true;if(!a||!b)return false;if(a.kind==='scene')return false;if(a.kind==='files')return equalValue(a.data,b.data);return JSON.stringify(a.data)===JSON.stringify(b.data);}
export function recordChanges(before:Records,after:Records):RecordChange[] {const changes:RecordChange[]=[];for(const key of new Set([...before.keys(),...after.keys()]))if(!equalRecord(before.get(key),after.get(key)))changes.push({key:nativeRecordKey((after.get(key)??before.get(key))!),before:before.get(key)??null,after:after.get(key)??null});return changes;}
export function equalValue(a:unknown,b:unknown):boolean {if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&equalValue((a as Record<string,unknown>)[key],(b as Record<string,unknown>)[key]));}
