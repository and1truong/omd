import {errorOf} from './dom.js';
import type {StorageLike,StoreOptions,Notebook,StoredRecord,Records,RecordChange,Journal,DueReminder} from './types.js';
import { recordKey, bookRecords, makeMaterializer, metadataBook } from './records.js';
import { parseBook, validateBook, wrapPage } from './notebook.js';
import { STORAGE_KEY } from './model.js';
const request=<T>(req:IDBRequest<T>):Promise<T>=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
const completion=(tx:IDBTransaction):Promise<void>=>new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??new Error('Could not save. The database transaction was aborted; your last saved data is intact.'));tx.onerror=()=>{};});
export async function openRepository(storage:StorageLike,{key=STORAGE_KEY,name='omd.notebook.records.v1',indexedDB=globalThis.indexedDB,initial}:StoreOptions={}) {
  if(!indexedDB)throw new Error('IndexedDB is unavailable. Enable browser storage to use omd.');
  const opening=indexedDB.open(name,3);
  opening.onupgradeneeded=()=>{
    const db=opening.result,tx=opening.transaction!;
    if(!db.objectStoreNames.contains('meta')){
      db.createObjectStore('meta');const records=db.createObjectStore('records');records.createIndex('pageId','pageId');
      const reminders=db.createObjectStore('reminders');reminders.createIndex('due','due');db.createObjectStore('history');db.createObjectStore('delivery');
    }
    const history=tx.objectStore('history');history.clear();if(!history.indexNames.contains('owner'))history.createIndex('owner','owner');
    // Earlier record-store previews embedded files in scenes. Upgrade those records in the same schema transaction.
    const records=tx.objectStore('records'),cursor=records.openCursor();cursor.onsuccess=()=>{const row=cursor.result;if(!row)return;const value=row.value;if(value.kind==='scene'&&Object.hasOwn(value.data,'files')){const {files,...data}=value.data,blockId=JSON.parse(row.primaryKey as string)[1].slice('$scene:'.length),key=recordKey(value.pageId,`$files:${blockId}`);records.put({key,kind:'files',pageId:value.pageId,data:files},key);row.update({...value,data});}row.continue();};
  };
  const db=await request(opening);db.onversionchange=()=>db.close();
  const stores=['meta','records','reminders','history','delivery'];
  function transaction(mode:IDBTransactionMode='readonly'){const tx=db.transaction(stores,mode);return {tx,done:completion(tx)};}
  function reminder(tx:IDBTransaction,key:string,record:StoredRecord|null) {
    if(record?.kind==='block'&&record.data.type==='reminder') {
      const block=record.data;tx.objectStore('reminders').put({pageId:record.pageId,...block,due:block.enabled&&!block.firedAt&&block.dueAt?Date.parse(block.dueAt):Number.MAX_VALUE},key);
    } else tx.objectStore('reminders').delete(key);
  }
  async function read(expected?:Notebook) {
    const {tx,done}=transaction();const meta=await request<Notebook|undefined>(tx.objectStore('meta').get('book'));
    if(!meta){await done;return null;}
    if(expected&&expected.id===meta.id&&expected.revision===meta.revision){await done;return {meta};}
    const pages=await request<StoredRecord[]>(tx.objectStore('records').index('pageId').getAll(meta.activePageId));await done;
    return {meta,records:new Map(pages.map(r=>[r.key!,r]))};
  }
  function put(tx:IDBTransaction,key:string,value:StoredRecord|null){if(value){const record={...value,key};tx.objectStore('records').put(record,key);if(value.kind==='block')reminder(tx,key,value);}else{tx.objectStore('records').delete(key);tx.objectStore('reminders').delete(key);}}
  try {
    if(!await read()) {
      let raw;try{raw=storage.getItem(key);}catch{throw new Error('Browser storage is unavailable. Your saved data has been preserved.');}
      let book:Notebook;if(raw!==null){try{book=parseBook(raw);}catch(error){throw new Error(`Saved notebook could not be read. Its data has been preserved. ${errorOf(error).message}`);}}
      else {const value=initial!();book=value.format==='omd'?wrapPage(value):value;validateBook(book);}
      // Keep the original bytes in localStorage. It is a recovery source, never a write mirror.
      if(raw){const version=JSON.parse(raw).format==='omd'?1:JSON.parse(raw).version;if(version<3){const backup=`${key}.v${version}-backup`;if(storage.getItem(backup)===null)storage.setItem(backup,raw);}}
      const {tx,done}=transaction('readwrite');const existing=await request<Notebook|undefined>(tx.objectStore('meta').get('book'));
      try{if(!existing){tx.objectStore('meta').put(metadataBook(book),'book');for(const [k,v]of bookRecords(book))put(tx,k,v);}}catch(error){tx.abort();await done.catch(()=>{});throw error;}await done;
    }
  }catch(error){db.close();throw error;}
  return {
    name,read,
    async records(keys:string[]){const {tx,done}=transaction();const rows=await Promise.all(keys.map(key=>request<StoredRecord|undefined>(tx.objectStore('records').get(key))));await done;return new Map(keys.map((key,i)=>[key,rows[i]??null]));},
    async page(pageId:string){const {tx,done}=transaction();const rows=await request<StoredRecord[]>(tx.objectStore('records').index('pageId').getAll(pageId));await done;if(!rows.length)throw new Error('Page not found.');return new Map(rows.map(r=>[r.key!,r]));},
    async export(){const {tx,done}=transaction();const meta=await request<Notebook|undefined>(tx.objectStore('meta').get('book'));const rows=await request<StoredRecord[]>(tx.objectStore('records').getAll());await done;const records=new Map(rows.map(r=>[r.key!,r]));return {...meta!,pages:meta!.pages.map(p=>makeMaterializer()(records,p.id))};},
    async due(now:number){const {tx,done}=transaction();const rows=await request<DueReminder[]>(tx.objectStore('reminders').index('due').getAll(IDBKeyRange.upperBound(now)));await done;return rows;},
    async history(id:string){const {tx,done}=transaction();const value=await request<Journal>(tx.objectStore('history').get(id));await done;return value;},
    async commit(expected:Notebook,meta:Notebook,changes:RecordChange[],{journal,journalId,deleteHistory=[]}:{journal?:Journal|null;journalId?:string|null;deleteHistory?:string[]}={}) {
      const {tx,done}=transaction('readwrite');let resident:Records|undefined;
      try {
        const latest=await request<Notebook|undefined>(tx.objectStore('meta').get('book'));
        if(!latest||latest.id!==expected.id||latest.revision!==expected.revision)throw new Error('Another window changed this notebook. Reload before editing.');
        for(const change of changes){let value=change.after;if(value?.kind==='block'&&value.data.type==='reminder'){
          const b=value.data,deliveryKey=recordKey(value.pageId,`${b.id}:${b.dueAt}`);
          if(b.firedAt)tx.objectStore('delivery').put(b.firedAt,deliveryKey);
          else {const fired=await request<string|undefined>(tx.objectStore('delivery').get(deliveryKey));if(fired)value={...value,data:{...b,firedAt:fired}};}
          change.after=value;
        }put(tx,change.key,value);}
        tx.objectStore('meta').put(meta,'book');
        for(const id of deleteHistory)tx.objectStore('history').delete(id);
        if(journal)tx.objectStore('history').put(journal,journalId!);
        if(meta.activePageId!==expected.activePageId){const rows=await request<StoredRecord[]>(tx.objectStore('records').index('pageId').getAll(meta.activePageId));resident=new Map(rows.map(r=>[r.key!,r]));}
      } catch(error){tx.abort();await done.catch(()=>{});throw error;}await done;return resident;
    },
    async historyOwners(){
      const tx=db.transaction('history'),done=completion(tx),owners=new Set<string>();
      // WebKit fails to open an index cursor with nextunique. Read keys with the
      // default next direction and deduplicate without loading journal payloads.
      const reading=new Promise<void>((resolve,reject)=>{
        const cursor=tx.objectStore('history').index('owner').openKeyCursor();
        cursor.onerror=()=>reject(cursor.error);
        cursor.onsuccess=()=>{if(!cursor.result)return resolve();owners.add(cursor.result.key as string);cursor.result.continue();};
      });
      await Promise.all([reading,done]);return [...owners];
    },
    async pruneHistory(ids:string[]){if(!ids.length)return;const tx=db.transaction('history','readwrite'),done=completion(tx);for(const id of ids)tx.objectStore('history').delete(id);await done;},
    async pruneOwner(owner:string){const tx=db.transaction('history','readwrite'),done=completion(tx);const ids=await request(tx.objectStore('history').index('owner').getAllKeys(owner));for(const id of ids)tx.objectStore('history').delete(id);await done;},
    close(){db.close();}
  };
}
