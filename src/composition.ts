/** Keep native composing controls connected until their final edit has been persisted. */
export function createCompositionGuard({onSettled=()=>{}}:{onSettled?:()=>void}={}) {
  const active=new Map<EventTarget,{pageId:string;finishing?:Promise<unknown>}>();
  return {
    hasActive:()=>active.size>0,
    isComposing:(input:EventTarget)=>active.has(input),
    track(input:EventTarget,write:(pageId:string)=>unknown,getPageId:()=>string) {
      input.addEventListener('compositionstart',()=>active.set(input,{pageId:getPageId()}));
      input.addEventListener('compositionend',()=>{
        const record=active.get(input);if(!record||record.finishing)return;
        record.finishing=Promise.resolve().then(()=>write(record.pageId)).finally(()=>{
          if(active.get(input)===record)active.delete(input);if(!active.size)onSettled();
        });
      });
    }
  };
}
