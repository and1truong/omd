export type ColumnSide='left'|'right'|'before'|'after';
interface Preview {allowed:boolean;message:string;anchor:HTMLElement}
/** Native block drag only. Geometry never mutates the document before a drop. */
export function createColumnDropPreview(){
  const marker=document.createElement('div');marker.className='column-drop-preview';marker.hidden=true;marker.setAttribute('aria-hidden','true');
  const label=document.createElement('span');marker.append(label);document.body.append(marker);
  const status=document.createElement('div');status.className='sr-only';status.setAttribute('role','status');status.setAttribute('aria-live','polite');document.body.append(status);
  let current:HTMLElement|undefined;
  const clear=()=>{marker.hidden=true;current=undefined;};
  const sideAt=(node:HTMLElement,event:DragEvent):ColumnSide|undefined=>{const r=node.getBoundingClientRect(),width=Math.min(30,r.width*.22);if(event.clientY<r.top||event.clientY>r.bottom)return;if(event.clientX>=r.left&&event.clientX<=r.left+width)return 'left';if(event.clientX<=r.right&&event.clientX>=r.right-width)return 'right';if(event.clientX<r.left||event.clientX>r.right)return;const height=Math.min(18,r.height*.25);if(event.clientY<=r.top+height)return 'before';if(event.clientY>=r.bottom-height)return 'after';};
  function attach(node:HTMLElement,{inspect,drop,active}:{active:()=>boolean;inspect:(side:ColumnSide)=>Preview;drop:(side:ColumnSide,preview:Preview)=>unknown}){
    const preview=(event:DragEvent)=>{
      if(!active()||(event.target instanceof Element&&event.target.closest('[data-block-id]')!==node))return;
      const side=sideAt(node,event);if(!side){if(current===node)clear();return;}
      const result=inspect(side);event.preventDefault();event.stopPropagation();if(event.dataTransfer)event.dataTransfer.dropEffect=result.allowed?'move':'none';
      const rect=result.anchor.getBoundingClientRect(),vertical=side==='before'||side==='after';current=node;marker.hidden=false;marker.dataset.allowed=String(result.allowed);marker.dataset.side=side;marker.style.left=`${side==='left'||vertical?rect.left:rect.right}px`;marker.style.top=`${side==='after'?rect.bottom:rect.top}px`;marker.style.width=vertical?`${rect.width}px`:'4px';marker.style.height=vertical?'4px':`${Math.max(32,rect.height)}px`;label.textContent=result.message;if(status.textContent!==result.message)status.textContent=result.message;
      return {side,result};
    };
    node.addEventListener('dragover',preview);
    node.addEventListener('dragleave',event=>{if(current===node&&(!event.relatedTarget||!node.contains(event.relatedTarget as Node)))clear();});
    node.addEventListener('drop',event=>{const next=preview(event);clear();if(next)drop(next.side,next.result);});
  }
  document.addEventListener('dragend',clear);document.addEventListener('drop',clear);window.addEventListener('blur',clear);window.addEventListener('scroll',clear,true);
  return {attach,clear};
}
