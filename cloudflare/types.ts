export interface D1Result<T=unknown>{results:T[];meta:{changes:number}}
export interface D1Statement {bind(...values:unknown[]):D1Statement;first<T=unknown>():Promise<T|null>;all<T=unknown>():Promise<D1Result<T>>}
export interface D1Database {prepare(sql:string):D1Statement;batch<T=unknown>(statements:D1Statement[]):Promise<D1Result<T>[]>}
export interface Env {DB:D1Database;ASSETS:{fetch(request:Request):Promise<Response>}}
