import type {Env,D1Database,D1Statement} from './types.js';
import type {Notebook,StoredRecord,RecordKey,RecordChange,Journal,BridgeWrite,BridgeReceipt} from '../src/types.js';
import {emptyNotebook} from '../src/model.js';
import {validateBook,wrapPage} from '../src/notebook.js';
import {bookRecords,metadataBook,makeMaterializer,recordKey,recordsMap,nativeRecordKey,equalValue} from '../src/records.js';
import {BridgeError} from '../src/bridge-error.js';

const MAX_REQUEST=8*1024*1024,PART=64*1024,RETENTION=7*86400000;
const guard='EXISTS(SELECT 1 FROM notebook WHERE singleton=1 AND token=?)';
type Row={page_id:string;kind:StoredRecord['kind'];id:string;part:number;payload:string};
type Input=Record<string,unknown>;
function assert(ok:unknown,message:string):asserts ok{if(!ok)throw new Error(message);}
function text(value:unknown,label:string,limit=4096):asserts value is string{assert(typeof value==='string'&&value.length>0&&value.length<=limit,`${label} must be nonempty text (up to ${limit} characters).`);}
function key(value:unknown):asserts value is RecordKey{assert(Array.isArray(value)&&value.length===3,'Invalid record key.');text(value[0],'Page ID');text(value[2],'Record ID');assert(['page','block','container','scene','files'].includes(value[1]),'Invalid record kind.');}
function chunks(value:unknown){const json=JSON.stringify(value),parts:string[]=[];for(let start=0;start<json.length;){let end=Math.min(start+PART,json.length);const last=json.charCodeAt(end-1);if(end<json.length&&last>=0xd800&&last<=0xdbff)end--;parts.push(json.slice(start,end));start=end;}return parts;}
function parseRows(rows:{payload:string}[]){return JSON.parse(rows.map(r=>r.payload).join(''));}
function unpack(rows:Row[]):StoredRecord[]{const groups=new Map<string,Row[]>();for(const row of rows){const id=recordKey(row.page_id,row.kind,row.id);const list=groups.get(id)??[];list.push(row);groups.set(id,list);}return [...groups.values()].map(list=>parseRows(list.sort((a,b)=>a.part-b.part)));}
function recordWrites(db:D1Database,row:StoredRecord,token:string){return chunks(row).map((payload,part)=>db.prepare(`INSERT INTO records(page_id,kind,id,part,payload) SELECT ?,?,?,?,? WHERE ${guard}`).bind(row.pageId,row.kind,row.id,part,payload,token));}
async function initialize(db:D1Database){
  if(await db.prepare('SELECT singleton FROM notebook WHERE singleton=1').first())return;
  const page=emptyNotebook();page.title='Shared notebook';page.subtitle='Anyone with this URL can read and edit. Changes save to the cloud.';
  const book=wrapPage(page),token=crypto.randomUUID();
  await db.batch([db.prepare('INSERT OR IGNORE INTO notebook(singleton,metadata,revision,token) VALUES(1,?,?,?)').bind(JSON.stringify(metadataBook(book)),book.revision,token),...[...bookRecords(book).values()].flatMap(row=>recordWrites(db,row,token))]);
}
async function snapshot(db:D1Database){
  const result=await db.batch([db.prepare('SELECT metadata,token FROM notebook WHERE singleton=1'),db.prepare('SELECT * FROM records ORDER BY page_id,kind,id,part')]);
  const meta=JSON.parse((result[0].results[0] as {metadata:string}).metadata) as Notebook,records=recordsMap(unpack(result[1].results as Row[]));
  return {meta,records,token:(result[0].results[0] as {token:string}).token};
}
function fullBook(meta:Notebook,records:ReturnType<typeof recordsMap>){const materialize=makeMaterializer();return validateBook({...meta,pages:meta.pages.map(page=>materialize(records,page.id))});}
async function receipt(db:D1Database,bridge:BridgeWrite,meta:Notebook){
  assert(bridge&&typeof bridge==='object','Invalid Bridge request.');text(bridge.idempotencyKey,'Idempotency key');text(bridge.semantic,'Semantic request',65536);
  if(meta.id!==bridge.notebookId)throw new BridgeError('STALE_CONTEXT','The shared notebook changed. Get fresh context.');
  const row=await db.prepare('SELECT payload FROM bridge_receipts WHERE notebook_id=? AND key=?').bind(bridge.notebookId,bridge.idempotencyKey).first<{payload:string}>();
  const saved=row?JSON.parse(row.payload) as BridgeReceipt:undefined;
  if(saved&&saved.semantic!==bridge.semantic)throw new BridgeError('IDEMPOTENCY_CONFLICT','This key was used for a different request.');return saved;
}
async function commit(db:D1Database,input:Input,session:string){
  text(input.requestId,'Request ID');const requestId=input.requestId;
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input))))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const saved=await db.prepare('SELECT digest,payload FROM commit_receipts WHERE id=? ORDER BY part').bind(requestId).all<{digest:string;payload:string}>();
  if(saved.results.length){assert(saved.results[0].digest===digest,'Request ID was already used for different data.');return parseRows(saved.results);}
  const {meta:current,records,token:currentToken}=await snapshot(db),expected=input.expected as Notebook,next=input.meta as Notebook;
  const bridge=input.bridge as (BridgeWrite&{data:unknown})|undefined;
  if(bridge){const replay=await receipt(db,bridge,current);if(replay)return {replay};if(bridge.expectedRevision!==current.revision)throw new BridgeError('STALE_CONTEXT','The shared notebook revision changed. Get fresh context.');}
  if(!expected||expected.id!==current.id||expected.revision!==current.revision)throw new BridgeError('STALE_CONTEXT','Another device changed the shared notebook. Keep or copy your draft, then reload before editing.');
  validateBook(next);assert(next.revision===current.revision+1,'Revision must advance by one.');assert(next.pages.every(p=>p.blocks.length===0),'Metadata must not embed block content.');
  assert(new TextEncoder().encode(JSON.stringify(next)).byteLength<=1024*1024,'Notebook metadata exceeds the D1 row limit.');
  assert(Array.isArray(input.changes),'Expected record changes.');const changes=input.changes as RecordChange[],seen=new Set<string>(),candidate=new Map(records),normalized:RecordChange[]=[],deliveries:D1Statement[]=[];
  const deliveryRows=changes.some(change=>change?.after?.kind==='block'&&change.after.data.type==='reminder')?await db.prepare('SELECT page_id,block_id,due_at,fired_at FROM delivery WHERE notebook_id=?').bind(next.id).all<{page_id:string;block_id:string;due_at:string;fired_at:string}>():{results:[]};
  const delivered=new Map(deliveryRows.results.map(row=>[JSON.stringify([row.page_id,row.block_id,row.due_at]),row.fired_at]));
  const token=crypto.randomUUID();
  for(const change of changes){
    assert(change&&typeof change==='object','Invalid record change.');key(change.key);const id=recordKey(...change.key);assert(!seen.has(id),'Duplicate record change.');seen.add(id);
    assert(equalValue(records.get(id)??null,change.before),'Record changed before this edit.');
    if(change.after){assert(equalValue(nativeRecordKey(change.after),change.key),'Record identity mismatch.');
      if(change.after.kind==='block'&&change.after.data.type==='reminder'){
        const block=change.after.data,old=delivered.get(JSON.stringify([change.after.pageId,block.id,block.dueAt]));
        if(old){change.after={...change.after,data:{...block,firedAt:old}};normalized.push(change);}
        else if(block.firedAt)deliveries.push(db.prepare(`INSERT OR IGNORE INTO delivery SELECT ?,?,?,?,? WHERE ${guard}`).bind(next.id,change.after.pageId,block.id,block.dueAt,block.firedAt,token));
      }
      candidate.set(id,change.after);
    }else candidate.delete(id);
  }
  const book=fullBook(next,candidate),canonical=bookRecords(book);assert(equalValue(metadataBook(book),next)&&canonical.size===candidate.size&&[...canonical].every(([id,row])=>equalValue(row,candidate.get(id))),'Records and notebook metadata are inconsistent.');
  const storedMeta={...next,activePageId:next.pages.some(p=>p.id===current.activePageId)?current.activePageId:next.activePageId};
  const statements=[db.prepare('UPDATE notebook SET metadata=?,revision=?,token=? WHERE singleton=1 AND revision=? AND token=?').bind(JSON.stringify(storedMeta),next.revision,token,current.revision,currentToken)];
  for(const change of changes){statements.push(db.prepare(`DELETE FROM records WHERE page_id=? AND kind=? AND id=? AND ${guard}`).bind(...change.key,token));if(change.after)statements.push(...recordWrites(db,change.after,token));}
  statements.push(...deliveries);
  const ids=input.deleteHistory??[];assert(Array.isArray(ids),'Invalid history list.');for(const id of ids){text(id,'History ID');statements.push(db.prepare(`DELETE FROM history WHERE session=? AND id=? AND ${guard}`).bind(session,id,token));}
  const journal=input.journal as Journal|undefined;
  if(journal){text(input.journalId,'History ID');text(journal.owner,'History owner');assert(equalValue(journal.before,expected)&&equalValue(journal.after,next)&&Array.isArray(journal.changes),'Invalid history journal.');
    chunks(journal).forEach((payload,part)=>statements.push(db.prepare(`INSERT INTO history SELECT ?,?,?,?,?,? WHERE ${guard}`).bind(session,input.journalId,journal.owner,part,payload,Date.now(),token)));
  }
  if(bridge){const payload=JSON.stringify({semantic:bridge.semantic,data:bridge.data,revision:next.revision});assert(new TextEncoder().encode(payload).byteLength<=512*1024,'Bridge receipt is too large.');statements.push(db.prepare(`INSERT INTO bridge_receipts SELECT ?,?,? WHERE ${guard}`).bind(next.id,bridge.idempotencyKey,payload,token));}
  const response={normalized,records:next.activePageId!==expected.activePageId?[...candidate.values()].filter(row=>row.pageId===next.activePageId):undefined};
  chunks(response).forEach((payload,part)=>statements.push(db.prepare(`INSERT INTO commit_receipts SELECT ?,?,?,?,? WHERE ${guard}`).bind(requestId,part,digest,payload,Date.now(),token)));
  statements.push(db.prepare(`DELETE FROM history WHERE created_at<? AND ${guard}`).bind(Date.now()-RETENTION,token),db.prepare(`DELETE FROM commit_receipts WHERE created_at<? AND ${guard}`).bind(Date.now()-RETENTION,token));
  const result=await db.batch(statements);
  if(!result[0].meta.changes){const replay=await db.prepare('SELECT digest,payload FROM commit_receipts WHERE id=? ORDER BY part').bind(requestId).all<{digest:string;payload:string}>();if(replay.results.length&&replay.results[0].digest===digest)return parseRows(replay.results);if(bridge){const updated=await snapshot(db),receiptValue=await receipt(db,bridge,updated.meta);if(receiptValue)return {replay:receiptValue};}throw new BridgeError('STALE_CONTEXT','Another device saved first. Your draft is still in this tab; reload before editing.');}
  return response;
}
async function api(request:Request,env:Env){
  assert(request.method==='POST','Use POST for the notebook API.');assert(request.headers.get('content-type')?.split(';')[0]==='application/json','Use application/json.');
  const origin=request.headers.get('origin');assert(!origin||origin===new URL(request.url).origin,'Cross-origin notebook requests are not supported.');
  const reader=request.body?.getReader();assert(reader,'Request body is required.');const parts:Uint8Array[]=[];let bytes=0;
  for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_REQUEST){await reader.cancel();throw new Error('Cloud save exceeds the 8 MiB request limit. The draft has not been saved.');}parts.push(value);}
  const buffer=new Uint8Array(bytes);let offset=0;for(const part of parts){buffer.set(part,offset);offset+=part.length;}const input=JSON.parse(new TextDecoder().decode(buffer)) as Input;
  assert(input&&typeof input==='object'&&!Array.isArray(input),'Invalid API input.');text(input.session,'Session ID');const session=input.session;
  await initialize(env.DB);
  if(input.operation==='commit')return commit(env.DB,input,session);
  if(input.operation==='history'){text(input.id,'History ID');const rows=await env.DB.prepare('SELECT payload FROM history WHERE session=? AND id=? ORDER BY part').bind(session,input.id).all<{payload:string}>();assert(rows.results.length,'Undo history is no longer available.');return parseRows(rows.results);}
  if(input.operation==='pruneHistory'){assert(Array.isArray(input.ids),'Invalid history IDs.');for(const id of input.ids){text(id,'History ID');await env.DB.prepare('DELETE FROM history WHERE session=? AND id=?').bind(session,id).all();}return null;}
  if(input.operation==='pruneOwner'){text(input.owner,'History owner');await env.DB.prepare('DELETE FROM history WHERE session=? AND owner=?').bind(session,input.owner).all();return null;}
  // Idle polling reads only metadata, not every notebook record.
  if(input.operation==='read'&&input.expected){const expected=input.expected as Notebook,row=await env.DB.prepare('SELECT metadata FROM notebook WHERE singleton=1').first<{metadata:string}>();const meta=validateBook(JSON.parse(row!.metadata));if(expected.id===meta.id&&expected.revision===meta.revision)return {meta};}
  const {meta,records}=await snapshot(env.DB);
  switch(input.operation){
    case 'read':{const expected=input.expected as Notebook|undefined;if(expected?.id===meta.id&&expected.revision===meta.revision)return {meta};const activePageId=meta.pages.some(p=>p.id===input.preferredPageId)?input.preferredPageId as string:meta.activePageId;return {meta:{...meta,activePageId},records:[...records.values()].filter(row=>row.pageId===activePageId)};}
    case 'page':{text(input.pageId,'Page ID');assert(meta.pages.some(p=>p.id===input.pageId),'Page not found.');return [...records.values()].filter(row=>row.pageId===input.pageId);}
    case 'export':return fullBook(meta,records);
    case 'records':assert(Array.isArray(input.keys),'Invalid record keys.');return input.keys.map(value=>{key(value);return records.get(recordKey(...value))??null;});
    case 'receipt':return receipt(env.DB,input.bridge as BridgeWrite,meta);
    case 'due':assert(typeof input.now==='number'&&Number.isFinite(input.now),'Invalid reminder time.');return [...records.values()].flatMap(row=>row.kind==='block'&&row.data.type==='reminder'&&row.data.enabled&&!row.data.firedAt&&row.data.dueAt&&Date.parse(row.data.dueAt)<=(input.now as number) ? [{...row.data,pageId:row.pageId,due:Date.parse(row.data.dueAt)}]:[]);
    default:throw new Error('Unknown notebook operation.');
  }
}
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(url.pathname==='/api/notebook'){
      try{return Response.json({result:await api(request,env)},{headers:{'cache-control':'no-store'}});}
      catch(error){const e=error instanceof Error?error:new Error('Cloud request failed.'),code=error instanceof BridgeError?error.code:undefined;const unavailable=e.message.startsWith('D1_');return Response.json({error:unavailable?'Cloud storage unavailable. Your draft has not been acknowledged; try again.':e.message,code},{status:unavailable?503:code?409:400,headers:{'cache-control':'no-store'}});}
    }
    if(url.pathname.startsWith('/api/'))return new Response('Not found',{status:404});
    if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405});
    const asset=/^\/page\/[^/]+\/?$/.test(url.pathname)||url.pathname==='/'?new Request(new URL('/index.html',url),request):request;
    const response=await env.ASSETS.fetch(asset),headers=new Headers(response.headers);if(response.headers.get('content-type')?.includes('text/html'))headers.set('cache-control','no-store');headers.set('x-content-type-options','nosniff');return new Response(response.body,{status:response.status,headers});
  }
};
