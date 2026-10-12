/** Keep native composing controls connected until their final edit has been persisted. */
export function createCompositionGuard({onSettled=()=>{}}:{onSettled?:()=>void}={}) {
  interface Record {input:EventTarget;pageId:string;finishing?:Promise<unknown>}
  const active=new Map<EventTarget,Record>(),finishing=new Set<Record>();
  const waiters=new Map<()=>void,(input:EventTarget)=>boolean>();
  const hasMatching=(matches:(input:EventTarget)=>boolean)=>[...active.keys()].some(matches)||[...finishing].some(record=>matches(record.input));
  return {
    hasActive:()=>active.size>0||finishing.size>0,
    isComposing:(input:EventTarget)=>hasMatching(target=>target===input),
    isPreediting:(input:EventTarget)=>{const record=active.get(input);return !!record&&!record.finishing;},
    settled:(matches:(input:EventTarget)=>boolean=()=>true)=>hasMatching(matches)?new Promise<void>(resolve=>waiters.set(resolve,matches)):Promise.resolve(),
    track(input:EventTarget,write:(pageId:string,context:{isCurrent:()=>boolean})=>unknown,getPageId:()=>string) {
      input.addEventListener('compositionstart',()=>active.set(input,{input,pageId:getPageId()}));
      input.addEventListener('compositionend',()=>{
        const record=active.get(input);if(!record||record.finishing)return;
        finishing.add(record);
        record.finishing=Promise.resolve().then(()=>write(record.pageId,{isCurrent:()=>active.get(input)===record})).finally(()=>{
          if(active.get(input)===record)active.delete(input);
          finishing.delete(record);
          for(const [resolve,matches] of waiters)if(!hasMatching(matches)){waiters.delete(resolve);resolve();}
          if(!active.size&&!finishing.size)onSettled();
        });
      });
    }
  };
}
