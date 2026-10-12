import 'fake-indexeddb/auto';
import {createStore as openStore} from '../src/store.ts';
const names=new WeakMap();
export function createStore(storage,options={}) {
  if(!names.has(storage))names.set(storage,crypto.randomUUID());
  return openStore(storage,{...options,name:`test-${names.get(storage)}-${options.key??'default'}`});
}
// Simulate quota failure at the actual IndexedDB write boundary, scoped to one database.
export function failWrites(store) {
  const put=IDBObjectStore.prototype.put,dbName=store.databaseName();
  IDBObjectStore.prototype.put=function(...args){if(this.transaction.db.name===dbName)throw new DOMException('Could not save: quota exceeded.','QuotaExceededError');return put.apply(this,args);};
  return ()=>{IDBObjectStore.prototype.put=put;};
}
