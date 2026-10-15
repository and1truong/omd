// Test-only wrapper over real D1: independently enforce documented production limits.
import worker from '../cloudflare/worker.js';
import type {D1Database,D1Statement,D1Result,Env} from '../cloudflare/types.js';

export default {async fetch(request:Request,env:Env){
  let count=0,recordRows=0,maxBindBytes=0;const pages=new Set<string>(),kinds=new Set<string>(),raw=new WeakMap<D1Statement,D1Statement>();
  const encoder=new TextEncoder();
  const reserve=(amount:number)=>{count+=amount;if(count>50)throw new Error('TEST: exceeded 50 D1 statements per invocation');};
  function inspect<T>(result:D1Result<T>){for(const row of result.results as Record<string,unknown>[])if(typeof row.page_id==='string'&&typeof row.kind==='string'){recordRows++;pages.add(row.page_id);kinds.add(row.kind);}return result;}
  function wrap(statement:D1Statement):D1Statement{
    const wrapped:D1Statement={
      bind(...values){for(const value of values)if(typeof value==='string'){const size=encoder.encode(value).byteLength;maxBindBytes=Math.max(maxBindBytes,size);if(size>2_000_000)throw new Error('TEST: D1 string exceeds 2 MB');}return wrap(statement.bind(...values));},
      async first<T>(){reserve(1);return statement.first<T>();},
      async all<T>(){reserve(1);return inspect(await statement.all<T>());}
    };raw.set(wrapped,statement);return wrapped;
  }
  const DB:D1Database={prepare:sql=>wrap(env.DB.prepare(sql)),async batch<T>(statements:D1Statement[]){reserve(statements.length);return (await env.DB.batch<T>(statements.map(statement=>raw.get(statement)!))).map(inspect);}};
  const response=await worker.fetch(request,{...env,DB}),headers=new Headers(response.headers);
  headers.set('x-test-d1-count',String(count));headers.set('x-test-d1-record-rows',String(recordRows));headers.set('x-test-d1-record-pages',JSON.stringify([...pages]));headers.set('x-test-d1-record-kinds',JSON.stringify([...kinds]));headers.set('x-test-d1-max-bind-bytes',String(maxBindBytes));
  return new Response(response.body,{status:response.status,headers});
}};
