import {errorOf} from './dom.js';
import type {StorageLike,StoreOptions,Notebook,StoredRecord,Records,RecordChange,Journal,DueReminder,RecordKey} from './types.js';
import { bookRecords, makeMaterializer, metadataBook, recordKey, nativeRecordKey, recordsMap, equalValue } from './records.js';
import { parseBook, validateBook, wrapPage } from './notebook.js';
import { STORAGE_KEY } from './model.js';
const request=<T>(req:IDBRequest<T>):Promise<T>=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
const completion=(tx:IDBTransaction):Promise<void>=>new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??new Error('Could not save. The database transaction was aborted; your last saved data is intact.'));tx.onerror=()=>{};});
const recordKeyPath=['pageId','kind','id'];
function legacyKey(key:IDBValidKey):[string,string] {
  if(typeof key!=='string')throw new Error('Expected a legacy string key.');
  const parts:unknown=JSON.parse(key);
  if(!Array.isArray(parts)||parts.length!==2||!parts.every(p=>typeof p==='string'))throw new Error('Invalid legacy key.');
  return parts as [string,string];
}
function legacyRecord(key:IDBValidKey,value:StoredRecord&{key?:string}):StoredRecord {
  const [pageId,oldId]=legacyKey(key),kind=value?.kind;
  if(!['page','block','container','scene','files'].includes(kind)||value.pageId!==pageId||value.key!==undefined&&value.key!==key||Object.keys(value).some(k=>!['kind','pageId','key','data'].includes(k)))throw new Error('Legacy record identity does not match its key.');
  const prefix=`$${kind}:`,id=kind==='page'?pageId:oldId.startsWith(prefix)?oldId.slice(prefix.length):'';
  if((kind==='page'?oldId!=='$page':!id)||!value.data||typeof value.data!=='object'||Array.isArray(value.data))throw new Error('Invalid legacy record.');
  if(['page','block','container'].includes(kind)&&(value.data as {id:string}).id!==id)throw new Error('Legacy data ID does not match its key.');
  return {pageId,kind,id,data:value.data} as StoredRecord;
}
function migrate(db:IDBDatabase,tx:IDBTransaction,fail:(error:unknown)=>void) {
  for(const name of ['meta','records','reminders','history','delivery'])if(!db.objectStoreNames.contains(name))throw new Error(`Missing legacy ${name} store.`);
  if(tx.objectStore('records').keyPath!==null||tx.objectStore('reminders').keyPath!==null||tx.objectStore('delivery').keyPath!==null)throw new Error('Unsupported legacy key path.');
  const records=db.createObjectStore('records-v4',{keyPath:recordKeyPath});records.createIndex('pageId','pageId');
  const reminders=db.createObjectStore('reminders-v4',{keyPath:['pageId','id']});reminders.createIndex('due','due');
  const delivery=db.createObjectStore('delivery-v4');
  let remaining=3;const finished=()=>{if(!--remaining)validate();};
  const guard=(fn:()=>void)=>{try{fn();}catch(error){fail(error);}};
  const add=(store:IDBObjectStore,value:unknown,key?:IDBValidKey)=>{const req=key===undefined?store.add(value):store.add(value,key);req.onerror=()=>fail(req.error);};
  const cursor=tx.objectStore('records').openCursor();
  cursor.onsuccess=()=>guard(()=>{
    const row=cursor.result;if(!row){finished();return;}
    const value=legacyRecord(row.primaryKey,row.value);
    if(value.kind==='scene'&&Object.hasOwn(value.data,'files')){
      const {files,...data}=value.data as import('./types.js').Scene;
      add(records,{pageId:value.pageId,kind:'files',id:value.id,data:files});value.data=data;
    }
    add(records,value);row.continue();
  });
  const reminderCursor=tx.objectStore('reminders').openCursor();reminderCursor.onsuccess=()=>guard(()=>{
    const row=reminderCursor.result;if(!row){finished();return;}
    const [pageId,oldId]=legacyKey(row.primaryKey),value=row.value;
    if(!oldId.startsWith('$block:')||value.pageId!==pageId||value.id!==oldId.slice('$block:'.length)||value.type!=='reminder')throw new Error('Invalid legacy reminder key.');
    add(reminders,value);row.continue();
  });
  const deliveryCursor=tx.objectStore('delivery').openCursor();deliveryCursor.onsuccess=()=>guard(()=>{
    const row=deliveryCursor.result;if(!row){finished();return;}
    const [pageId,oldId]=legacyKey(row.primaryKey);
    // The old ledger appended an ISO date (or empty date) to a logical block ID.
    const match=/^(.+):((?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?)$/s.exec(oldId);
    if(!match||match[2]&&!Number.isFinite(Date.parse(match[2]))||typeof row.value!=='string'||!Number.isFinite(Date.parse(row.value)))throw new Error('Invalid legacy delivery key or date.');
    add(delivery,row.value,[pageId,match[1],match[2]]);row.continue();
  });
  function validate(){
    const meta=tx.objectStore('meta').get('book');meta.onsuccess=()=>{
      const rows=records.getAll();rows.onsuccess=()=>guard(()=>{
        const book=meta.result as Notebook|undefined,mapped=recordsMap(rows.result);
        if(book!==undefined){
          const full=validateBook({...book,pages:book.pages.map(p=>makeMaterializer()(mapped,p.id))});
          const normalized=bookRecords(structuredClone(full));
          if(!equalValue(metadataBook(full),book)||normalized.size!==mapped.size||[...mapped].some(([key,row])=>!equalValue(row,normalized.get(key))))throw new Error('Legacy records contain orphaned or inconsistent data.');
        }
        if(book===undefined){
          let remaining=5;
          for(const name of ['meta','records','reminders','history','delivery']){
            const count=tx.objectStore(name).count();count.onerror=()=>fail(count.error);count.onsuccess=()=>guard(()=>{if(count.result)throw new Error(`Legacy notebook metadata is missing but ${name} is not empty.`);if(!--remaining)replace();});
          }
        }else replace();
        function replace(){const pending=reminders.getAll();pending.onsuccess=()=>guard(()=>{
          const expected=[...mapped.values()].filter(r=>r.kind==='block'&&r.data.type==='reminder');
          if(expected.length!==pending.result.length||pending.result.some(value=>{const record=mapped.get(recordKey(value.pageId,'block',value.id));if(record?.kind!=='block'||record.data.type!=='reminder')return true;const {pageId,due,...block}=value;return !equalValue(block,record.data)||due!==reminderDue(record.data);}))throw new Error('Legacy reminder index does not match its records.');
          // Open tabs cannot reuse old patch paths. As in previous upgrades, only transient undo is invalidated.
          const history=tx.objectStore('history');history.clear();if(!history.indexNames.contains('owner'))history.createIndex('owner','owner');
          for(const [name,store]of [['records',records],['reminders',reminders],['delivery',delivery]] as const){db.deleteObjectStore(name);store.name=name;}
        });}
      });
    };
  }
}
const reminderDue=(block:import('./types.js').ReminderBlock)=>block.enabled&&!block.firedAt&&block.dueAt?Date.parse(block.dueAt):Number.MAX_VALUE;
export async function openRepository(storage:StorageLike,{key=STORAGE_KEY,name='omd.notebook.records.v1',indexedDB=globalThis.indexedDB,initial}:StoreOptions={}) {
  if(!indexedDB)throw new Error('IndexedDB is unavailable. Enable browser storage to use omd.');
  const opening=indexedDB.open(name,4);let upgradeError:Error|undefined;
  opening.onupgradeneeded=event=>{
    const db=opening.result,tx=opening.transaction!;
    if(upgradeError){tx.abort();return;}
    const fail=(error:unknown)=>{upgradeError??=new Error(`Notebook database upgrade failed. The previous database and localStorage recovery sources are intact. ${errorOf(error).message}`);try{tx.abort();}catch{}};
    try{
      if(event.oldVersion===0){
        db.createObjectStore('meta');const records=db.createObjectStore('records',{keyPath:recordKeyPath});records.createIndex('pageId','pageId');
        const reminders=db.createObjectStore('reminders',{keyPath:['pageId','id']});reminders.createIndex('due','due');db.createObjectStore('history').createIndex('owner','owner');db.createObjectStore('delivery');
      }else migrate(db,tx,fail);
    }catch(error){fail(error);}
  };
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{
    opening.onblocked=()=>{upgradeError=new Error('Notebook database upgrade is blocked by another open window. Save your changes and close all other omd tabs/windows, then reload this window. Your saved database and localStorage recovery sources are intact.');reject(upgradeError);};
    opening.onsuccess=()=>{if(upgradeError)opening.result.close();else resolve(opening.result);};
    opening.onerror=()=>reject(upgradeError??opening.error);
  });let obsolete=false;db.onversionchange=()=>{obsolete=true;db.close();};
  const stores=['meta','records','reminders','history','delivery'];
  function transaction(mode:IDBTransactionMode='readonly'){if(obsolete)throw new Error('The notebook database was upgraded in another window. Reload before editing.');const tx=db.transaction(stores,mode);return {tx,done:completion(tx)};}
  function reminder(tx:IDBTransaction,record:StoredRecord) {
    if(record?.kind==='block'&&record.data.type==='reminder') {
      const block=record.data;tx.objectStore('reminders').put({pageId:record.pageId,...block,due:reminderDue(block)});
    } else tx.objectStore('reminders').delete([record.pageId,record.id]);
  }
  async function read(expected?:Notebook,preferredPageId?:string) {
    const {tx,done}=transaction();const meta=await request<Notebook|undefined>(tx.objectStore('meta').get('book'));
    if(!meta){await done;return null;}
    if(expected&&expected.id===meta.id&&expected.revision===meta.revision){await done;return {meta};}
    const activePageId=meta.pages.some(p=>p.id===preferredPageId)?preferredPageId!:meta.activePageId;
    const pages=await request<StoredRecord[]>(tx.objectStore('records').index('pageId').getAll(activePageId));await done;
    return {meta:{...meta,activePageId},records:recordsMap(pages)};
  }
  function put(tx:IDBTransaction,key:RecordKey,value:StoredRecord|null){if(value){tx.objectStore('records').put(value);if(value.kind==='block')reminder(tx,value);}else{tx.objectStore('records').delete(key);if(key[1]==='block')tx.objectStore('reminders').delete([key[0],key[2]]);}}
  try {
    if(!await read()) {
      let raw;try{raw=storage.getItem(key);}catch{throw new Error('Browser storage is unavailable. Your saved data has been preserved.');}
      let book:Notebook;if(raw!==null){try{book=parseBook(raw);}catch(error){throw new Error(`Saved notebook could not be read. Its data has been preserved. ${errorOf(error).message}`);}}
      else {const value=initial!();book=value.format==='omd'?wrapPage(value):value;validateBook(book);}
      // Keep the original bytes in localStorage. It is a recovery source, never a write mirror.
      if(raw){const version=JSON.parse(raw).format==='omd'?1:JSON.parse(raw).version;if(version<3){const backup=`${key}.v${version}-backup`;if(storage.getItem(backup)===null)storage.setItem(backup,raw);}}
      const {tx,done}=transaction('readwrite');const existing=await request<Notebook|undefined>(tx.objectStore('meta').get('book'));
      try{if(!existing){tx.objectStore('meta').put(metadataBook(book),'book');for(const value of bookRecords(book).values())put(tx,nativeRecordKey(value),value);}}catch(error){tx.abort();await done.catch(()=>{});throw error;}await done;
    }
  }catch(error){db.close();throw error;}
  return {
    name,read,
    async records(keys:RecordKey[]){const {tx,done}=transaction();const rows=await Promise.all(keys.map(key=>request<StoredRecord|undefined>(tx.objectStore('records').get(key))));await done;return new Map(keys.map((key,i)=>[recordKey(...key),rows[i]??null]));},
    async page(pageId:string){const {tx,done}=transaction();const rows=await request<StoredRecord[]>(tx.objectStore('records').index('pageId').getAll(pageId));await done;if(!rows.length)throw new Error('Page not found.');return recordsMap(rows);},
    async export(){const {tx,done}=transaction();const meta=await request<Notebook|undefined>(tx.objectStore('meta').get('book'));const rows=await request<StoredRecord[]>(tx.objectStore('records').getAll());await done;const records=recordsMap(rows);return {...meta!,pages:meta!.pages.map(p=>makeMaterializer()(records,p.id))};},
    async due(now:number){const {tx,done}=transaction();const rows=await request<DueReminder[]>(tx.objectStore('reminders').index('due').getAll(IDBKeyRange.upperBound(now)));const delivered=await Promise.all(rows.map(r=>request(tx.objectStore('delivery').getKey([r.pageId,r.id,r.dueAt]))));await done;return rows.filter((_,i)=>delivered[i]===undefined);},
    async history(id:string){const {tx,done}=transaction();const value=await request<Journal>(tx.objectStore('history').get(id));await done;return value;},
    async commit(expected:Notebook,meta:Notebook,changes:RecordChange[],{journal,journalId,deleteHistory=[]}:{journal?:Journal|null;journalId?:string|null;deleteHistory?:string[]}={}) {
      const {tx,done}=transaction('readwrite');let resident:Records|undefined;
      try {
        const latest=await request<Notebook|undefined>(tx.objectStore('meta').get('book'));
        if(!latest||latest.id!==expected.id||latest.revision!==expected.revision)throw new Error('Another window changed this notebook. Reload before editing.');
        for(const change of changes){let value=change.after;if(value?.kind==='block'&&value.data.type==='reminder'){
          const b=value.data,deliveryKey=[value.pageId,b.id,b.dueAt];
          const fired=await request<string|undefined>(tx.objectStore('delivery').get(deliveryKey));
          if(fired!==undefined)value={...value,data:{...b,firedAt:fired}};
          else if(b.firedAt)tx.objectStore('delivery').put(b.firedAt,deliveryKey);
          change.after=value;
        }put(tx,change.key,value);}
        // The schema retains a default page for old clients/exports, not a live tab selection.
        const activePageId=meta.pages.some(p=>p.id===latest.activePageId)?latest.activePageId:meta.activePageId;
        tx.objectStore('meta').put({...meta,activePageId},'book');
        for(const id of deleteHistory)tx.objectStore('history').delete(id);
        if(journal)tx.objectStore('history').put(journal,journalId!);
        if(meta.activePageId!==expected.activePageId){const rows=await request<StoredRecord[]>(tx.objectStore('records').index('pageId').getAll(meta.activePageId));resident=recordsMap(rows);}
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
