import type {Code} from './bridge-engine.js';
export class BridgeError extends Error {
  constructor(public readonly code:Code,message:string){super(message);}
}
