/** Keep native composing controls connected until their final edit has been persisted. */
export function createCompositionGuard({onSettled=()=>{}}={}) {
  const active=new Map();
  return {
    hasActive:()=>active.size>0,
    isComposing:input=>active.has(input),
    track(input,write,getPageId) {
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
