// Records use composite string keys, so imported IDs never become object properties.
export const recordKey = (pageId, id) => JSON.stringify([pageId,id]);
const ownCache=new WeakMap(),containerCache=new WeakMap(),sceneCache=new WeakMap();
export function pageRecords(page) {
  const records=new Map(); const {blocks,...metadata}=page;
  records.set(recordKey(page.id,'$page'),{kind:'page',pageId:page.id,data:metadata});
  function list(blocks,id) {
    let ids=containerCache.get(blocks);if(!ids){ids=blocks.map(b=>b.id);containerCache.set(blocks,ids);}
    records.set(recordKey(page.id,`$container:${id}`),{kind:'container',pageId:page.id,data:{id,blockIds:ids}});
    for(const block of blocks) {
      let data=ownCache.get(block);
      if(!data) {
        data={...block};delete data.blocks;delete data.scene;
        if(block.type==='tabs')data.tabs=block.tabs.map(({blocks,...tab})=>tab);
        if(block.type==='accordion')data.items=block.items.map(({blocks,...item})=>item);
        ownCache.set(block,data);
      }
      records.set(recordKey(page.id,`$block:${block.id}`),{kind:'block',pageId:page.id,data});
      if(block.type==='excalidraw'){let scene=sceneCache.get(block.scene);if(!scene){const {files,...data}=block.scene;scene=data;sceneCache.set(block.scene,scene);}records.set(recordKey(page.id,`$scene:${block.id}`),{kind:'scene',pageId:page.id,data:scene});records.set(recordKey(page.id,`$files:${block.id}`),{kind:'files',pageId:page.id,data:block.scene.files});}
      if(block.type==='tabs')for(const tab of block.tabs)list(tab.blocks,tab.id);
      if(block.type==='toggle')list(block.blocks,block.id);
      if(block.type==='accordion')for(const item of block.items)list(item.blocks,item.id);
    }
  }
  list(blocks,'page');return records;
}
export function bookRecords(book) {
  const records=new Map();
  for(const page of book.pages)for(const [key,value]of pageRecords(page))records.set(key,value);
  return records;
}
export function metadataBook(book) {return {...book,pages:book.pages.map(({blocks,...page})=>({...page,blocks:[]}))};}
export function makeMaterializer() {
  const cache=new Map();
  return function materialize(records,pageId) {
    const get=id=>records.get(recordKey(pageId,id))?.data;
    function list(id) {const ids=get(`$container:${id}`).blockIds,result=ids.map(block);containerCache.set(result,ids);return result;}
    function block(id) {
      const data=get(`$block:${id}`),scene=get(`$scene:${id}`),files=get(`$files:${id}`);let children=[];
      if(data.type==='tabs')children=data.tabs.map(t=>list(t.id));
      if(data.type==='toggle')children=[list(id)];
      if(data.type==='accordion')children=data.items.map(t=>list(t.id));
      const previous=cache.get(id);
      if(previous&&previous.data===data&&previous.scene===scene&&previous.files===files&&children.length===previous.children.length&&children.every((c,i)=>c.length===previous.children[i].length&&c.every((b,j)=>b===previous.children[i][j])))return previous.value;
      let value=data;
      if(data.type==='excalidraw'){const fullScene=previous?.scene===scene&&previous?.files===files?previous.value.scene:{...scene,files};sceneCache.set(fullScene,scene);value={...data,scene:fullScene};}
      if(data.type==='tabs')value={...data,tabs:data.tabs.map((t,i)=>({...t,blocks:children[i]}))};
      if(data.type==='toggle')value={...data,blocks:children[0]};
      if(data.type==='accordion')value={...data,items:data.items.map((t,i)=>({...t,blocks:children[i]}))};
      ownCache.set(value,data);cache.set(id,{data,scene,files,children,value});return value;
    }
    const value={...get('$page'),blocks:list('page')};
    for(const id of cache.keys())if(!records.has(recordKey(pageId,`$block:${id}`)))cache.delete(id);
    return value;
  };
}
export function equalRecord(a,b) {
  if(a===b||a?.data===b?.data)return true;
  if(!a||!b)return false;
  // Own records contain no descendants or canvas scenes. Large scenes are identity-compared.
  if(a.kind==='scene')return false;
  if(a.kind==='files')return equalValue(a.data,b.data);
  return JSON.stringify(a.data)===JSON.stringify(b.data);
}
export function recordChanges(before,after) {
  const changes=[];
  for(const key of new Set([...before.keys(),...after.keys()]))if(!equalRecord(before.get(key),after.get(key)))changes.push({key,before:before.get(key)??null,after:after.get(key)??null});
  return changes;
}

function equalValue(a,b){if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&equalValue(a[key],b[key]));}
