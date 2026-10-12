/** Keep native composing controls connected until their final edit has been persisted. */
export function createCompositionGuard({onSettled=()=>{}}:{onSettled?:()=>void}={}) {
  const active=new Map<EventTarget,{pageId:string;finishing?:Promise<unknown>}>();
  const waiters=new Map<()=>void,(input:EventTarget)=>boolean>();
  const hasMatching=(matches:(input:EventTarget)=>boolean)=>[...active.keys()].some(matches);
  return {
    hasActive:()=>active.size>0,
    isComposing:(input:EventTarget)=>active.has(input),
    settled:(matches:(input:EventTarget)=>boolean=()=>true)=>hasMatching(matches)?new Promise<void>(resolve=>waiters.set(resolve,matches)):Promise.resolve(),
    track(input:EventTarget,write:(pageId:string)=>unknown,getPageId:()=>string) {
      input.addEventListener('compositionstart',()=>active.set(input,{pageId:getPageId()}));
      input.addEventListener('compositionend',()=>{
        const record=active.get(input);if(!record||record.finishing)return;
        record.finishing=Promise.resolve().then(()=>write(record.pageId)).finally(()=>{
          if(active.get(input)===record)active.delete(input);
          for(const [resolve,matches] of waiters)if(!hasMatching(matches)){waiters.delete(resolve);resolve();}
          if(!active.size)onSettled();
        });
      });
    }
  };
}
