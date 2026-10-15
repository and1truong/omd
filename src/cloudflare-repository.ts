import type {Notebook,Records,RecordChange,Journal,BridgeWrite,BridgeReceipt,StoredRecord,RecordKey,DueReminder} from './types.js';
import type {openRepository} from './repository.js';
import {BridgeError} from './bridge-error.js';
import {recordKey,recordsMap} from './records.js';

type Repository=Awaited<ReturnType<typeof openRepository>>;
export async function openCloudflareRepository(endpoint=new URL('../api/notebook',import.meta.url).href,transport:typeof fetch=fetch):Promise<Repository> {
  const session=crypto.randomUUID();let closed=false;
  async function rpc<T>(operation:string,input:Record<string,unknown>={}):Promise<T>{
    if(closed)throw new Error('The cloud notebook connection is closed. Reload this page.');
    const body=JSON.stringify({operation,session,...input});
    for(let attempt=0;attempt<2;attempt++){
      let response:Response;
      try{response=await transport(endpoint,{method:'POST',headers:{'content-type':'application/json'},body,cache:'no-store',credentials:'omit'});}
      catch{if(!attempt)continue;throw new Error('Cloud connection unavailable. Your unsaved draft stays in this tab. Reconnect and try saving again.');}
      let value:{result:T;error?:string;code?:BridgeError['code']};
      try{value=await response.json();}catch{if(response.status>=500&&!attempt)continue;throw new Error('The cloud server returned an invalid response. Your draft has not been acknowledged.');}
      if(!response.ok){if(response.status>=500&&!attempt)continue;if(value.code)throw new BridgeError(value.code,value.error??'Cloud save failed.');throw new Error(value.error??'Cloud save failed.');}
      return value.result;
    }
    throw new Error('Cloud save failed.');
  }
  return {
    name:`omd.cloud:${new URL(endpoint).origin}`,
    async read(expected?:Notebook,preferredPageId?:string){const result=await rpc<{meta:Notebook;records?:StoredRecord[]}>('read',{expected,preferredPageId});return {...result,records:result.records?recordsMap(result.records):undefined};},
    bridgeReceipt:bridge=>rpc<BridgeReceipt|undefined>('receipt',{bridge}),
    async records(keys:RecordKey[]){const rows=await rpc<(StoredRecord|null)[]>('records',{keys});return new Map(keys.map((key,i)=>[recordKey(...key),rows[i]??null]));},
    async page(pageId:string){return recordsMap(await rpc<StoredRecord[]>('page',{pageId}));},
    export:()=>rpc<Notebook>('export'),
    due:now=>rpc<DueReminder[]>('due',{now}),
    history:id=>rpc<Journal>('history',{id}),
    async commit(expected:Notebook,meta:Notebook,changes:RecordChange[],options:{journal?:Journal|null;journalId?:string|null;deleteHistory?:string[];bridge?:(BridgeWrite&{data:unknown})}={}){
      const result=await rpc<{records?:StoredRecord[];replay?:BridgeReceipt;normalized?:RecordChange[]}>('commit',{requestId:crypto.randomUUID(),expected,meta,changes,...options});
      for(const change of result.normalized??[]){const original=changes.find(c=>recordKey(...c.key)===recordKey(...change.key));if(original)original.after=change.after;}
      return {...result,records:result.records?recordsMap(result.records):undefined} as {records?:Records;replay?:BridgeReceipt};
    },
    // Cloud histories belong to one tab/session. Other devices' leases cannot be inspected locally.
    historyOwners:async()=>[],
    pruneHistory:ids=>rpc<void>('pruneHistory',{ids}),
    pruneOwner:owner=>rpc<void>('pruneOwner',{owner}),
    close(){closed=true;}
  };
}
