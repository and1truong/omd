import { recordKey, bookRecords, makeMaterializer, metadataBook } from './records.js';
import { parseBook, validateBook, wrapPage } from './notebook.js';
import { STORAGE_KEY } from './model.js';
const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
const completion=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error??new Error('Could not save. The database transaction was aborted; your last saved data is intact.'));tx.onerror=()=>{};});
export async function openRepository(storage,{key=STORAGE_KEY,name='omd.notebook.records.v1',indexedDB=globalThis.indexedDB,initial}={}) {
  if(!indexedDB)throw new Error('IndexedDB is unavailable. Enable browser storage to use omd.');
  const opening=indexedDB.open(name,1);
  opening.onupgradeneeded=()=>{const db=opening.result;db.createObjectStore('meta');const records=db.createObjectStore('records');records.createIndex('pageId','pageId');const reminders=db.createObjectStore('reminders');reminders.createIndex('due','due');db.createObjectStore('history');db.createObjectStore('delivery');};
  const db=await request(opening);db.onversionchange=()=>db.close();
  const stores=['meta','records','reminders','history','delivery'];
  function transaction(mode='readonly'){const tx=db.transaction(stores,mode);return {tx,done:completion(tx)};}
  function reminder(tx,key,record) {
    if(record?.kind==='block'&&record.data.type==='reminder') {
      const block=record.data;tx.objectStore('reminders').put({pageId:record.pageId,...block,due:block.enabled&&!block.firedAt&&block.dueAt?Date.parse(block.dueAt):Number.MAX_VALUE},key);
    } else tx.objectStore('reminders').delete(key);
  }
  async function read(expected) {
    const {tx,done}=transaction();const meta=await request(tx.objectStore('meta').get('book'));
    if(!meta){await done;return null;}
    if(expected&&expected.id===meta.id&&expected.revision===meta.revision){await done;return {meta};}
    const pages=await request(tx.objectStore('records').index('pageId').getAll(meta.activePageId));await done;
    return {meta,records:new Map(pages.map(r=>[r.key,r]))};
  }
  function put(tx,key,value){if(value){const record={...value,key};tx.objectStore('records').put(record,key);if(value.kind==='block')reminder(tx,key,value);}else{tx.objectStore('records').delete(key);tx.objectStore('reminders').delete(key);}}
  try {
    if(!await read()) {
      let raw;try{raw=storage.getItem(key);}catch{throw new Error('Browser storage is unavailable. Your saved data has been preserved.');}
      let book;if(raw!==null){try{book=parseBook(raw);}catch(error){throw new Error(`Saved notebook could not be read. Its data has been preserved. ${error.message}`);}}
      else {book=initial();if(book.format==='omd')book=wrapPage(book);validateBook(book);}
      // Keep the original bytes in localStorage. It is a recovery source, never a write mirror.
      if(raw){const version=JSON.parse(raw).format==='omd'?1:JSON.parse(raw).version;if(version<3){const backup=`${key}.v${version}-backup`;if(storage.getItem(backup)===null)storage.setItem(backup,raw);}}
      const {tx,done}=transaction('readwrite');const existing=await request(tx.objectStore('meta').get('book'));
      try{if(!existing){tx.objectStore('meta').put(metadataBook(book),'book');for(const [k,v]of bookRecords(book))put(tx,k,v);}}catch(error){tx.abort();await done.catch(()=>{});throw error;}await done;
    }
  }catch(error){db.close();throw error;}
  return {
    name,read,
    async records(keys){const {tx,done}=transaction();const rows=await Promise.all(keys.map(key=>request(tx.objectStore('records').get(key))));await done;return new Map(keys.map((key,i)=>[key,rows[i]??null]));},
    async page(pageId){const {tx,done}=transaction();const rows=await request(tx.objectStore('records').index('pageId').getAll(pageId));await done;if(!rows.length)throw new Error('Page not found.');return new Map(rows.map(r=>[r.key,r]));},
    async export(){const {tx,done}=transaction();const meta=await request(tx.objectStore('meta').get('book'));const rows=await request(tx.objectStore('records').getAll());await done;const records=new Map(rows.map(r=>[r.key,r]));return {...meta,pages:meta.pages.map(p=>makeMaterializer()(records,p.id))};},
    async due(now){const {tx,done}=transaction();const rows=await request(tx.objectStore('reminders').index('due').getAll(IDBKeyRange.upperBound(now)));await done;return rows;},
    async history(id){const {tx,done}=transaction();const value=await request(tx.objectStore('history').get(id));await done;return value;},
    async commit(expected,meta,changes,{journal,journalId,fail}={}) {
      const {tx,done}=transaction('readwrite');
      try {
        const latest=await request(tx.objectStore('meta').get('book'));
        if(latest.id!==expected.id||latest.revision!==expected.revision)throw new Error('Another window changed this notebook. Reload before editing.');
        for(const change of changes){let value=change.after;if(value?.kind==='block'&&value.data.type==='reminder'){
          const b=value.data,deliveryKey=recordKey(value.pageId,`${b.id}:${b.dueAt}`);
          if(b.firedAt)tx.objectStore('delivery').put(b.firedAt,deliveryKey);
          else {const fired=await request(tx.objectStore('delivery').get(deliveryKey));if(fired)value={...value,data:{...b,firedAt:fired}};}
          change.after=value;
        }put(tx,change.key,value);}
        tx.objectStore('meta').put(meta,'book');
        if(journal)tx.objectStore('history').put(journal,journalId);
        if(fail)throw new Error('Injected transaction failure.');
      } catch(error){tx.abort();await done.catch(()=>{});throw error;}await done;
    },
    close(){db.close();}
  };
}
