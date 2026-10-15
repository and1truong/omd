import type {D1Database,D1Statement} from './types.js';

const encoder=new TextEncoder();
const MAX_QUERIES=50,MAX_BIND_BYTES=2_000_000,JSON_BIND_BYTES=1_000_000;

/** Count statements, including every statement inside batch(), against D1 Free. */
export function boundedDatabase(database:D1Database):D1Database{
  let queries=0;
  const statements=new WeakMap<D1Statement,D1Statement>();
  function reserve(count:number){
    if(queries+count>MAX_QUERIES)throw new Error('This cloud operation exceeds the D1 query budget. No pending transaction was saved. Reduce the import or edit size.');
    queries+=count;
  }
  function wrap(statement:D1Statement):D1Statement{
    const wrapped:D1Statement={
      bind(...values){for(const value of values)if(typeof value==='string'&&encoder.encode(value).byteLength>MAX_BIND_BYTES)throw new Error('Cloud operation exceeds the D1 value limit. Reduce the import or edit size.');return wrap(statement.bind(...values));},
      first<T>(){reserve(1);return statement.first<T>();},
      all<T>(){reserve(1);return statement.all<T>();}
    };
    statements.set(wrapped,statement);return wrapped;
  }
  return {prepare:sql=>wrap(database.prepare(sql)),batch<T>(batch:D1Statement[]){reserve(batch.length);return database.batch<T>(batch.map(statement=>statements.get(statement)!));}};
}

/** One SQL value must stay below D1's limit, even for a many-part record. */
export function* jsonBatches(rows:Iterable<unknown>):Generator<string>{
  let parts:string[]=[],bytes=2;
  for(const row of rows){
    const json=JSON.stringify(row),size=encoder.encode(json).byteLength;
    if(size+2>JSON_BIND_BYTES)throw new Error('A cloud record exceeds the D1 batch value limit.');
    if(parts.length&&bytes+size+1>JSON_BIND_BYTES){yield '['+parts.join(',')+']';parts=[];bytes=2;}
    bytes+=size+(parts.length?1:0);parts.push(json);
  }
  if(parts.length)yield '['+parts.join(',')+']';
}
