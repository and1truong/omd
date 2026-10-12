/** Keep native composing controls connected until their final edit has been persisted. */
export function createCompositionGuard({onSettled=()=>{}}:{onSettled?:()=>void}={}) {
  const active=new Map<EventTarget,{pageId:string;finishing?:Promise<unknown>}>();
  const waiters=new Set<()=>void>();
  return {
    hasActive:()=>active.size>0,
    isComposing:(input:EventTarget)=>active.has(input),
    settled:()=>active.size?new Promise<void>(resolve=>waiters.add(resolve)):Promise.resolve(),
    track(input:EventTarget,write:(pageId:string)=>unknown,getPageId:()=>string) {
      input.addEventListener('compositionstart',()=>active.set(input,{pageId:getPageId()}));
      input.addEventListener('compositionend',()=>{
        const record=active.get(input);if(!record||record.finishing)return;
        record.finishing=Promise.resolve().then(()=>write(record.pageId)).finally(()=>{
          if(active.get(input)===record)active.delete(input);if(!active.size){for(const resolve of waiters)resolve();waiters.clear();onSettled();}
        });
      });
    }
  };
}
