import {Editor,StarterKit,Markdown} from './text-editor-engine.js';
import type {NotebookStore,TextBlock,ChecklistItem,Notify} from './types.js';
import type {createCompositionGuard} from './composition.js';
import {errorOf} from './dom.js';

/** Visible Markdown controls own a Tiptap instance; persisted content stays Markdown. */
export function createTextEditors(store:NotebookStore,{composition,notify,createNext}:{composition:ReturnType<typeof createCompositionGuard>;notify:Notify;createNext:(blockId:string,pageId:string)=>Promise<string|undefined>}) {
  type ItemKeyDown=(event:KeyboardEvent)=>boolean;
  interface Entry {host:HTMLDivElement;editor:Editor;pageId:string;blockId:string;itemId?:string;onKeyDown?:ItemKeyDown;source:string;serialized:string;pending:string|null;saving?:Promise<unknown>;creating:boolean;provisional?:boolean;creation?:Promise<void>}
  const entries=new Map<string,Entry>(),key=(pageId:string,blockId:string,itemId?:string)=>JSON.stringify([pageId,blockId,itemId]);
  function write(entry:Entry,text:string) {
    return entry.itemId
      ?store.dispatch('checklist_update',{pageId:entry.pageId,blockId:entry.blockId,itemId:entry.itemId,patch:{text}},{quiet:true})
      :store.dispatch('update_block',{pageId:entry.pageId,blockId:entry.blockId,patch:{text}},{quiet:true});
  }
  async function flush(entry:Entry):Promise<void> {
    if(entry.provisional||composition.isComposing(entry.editor.view.dom)||entry.pending===null)return;
    if(entry.saving){await entry.saving;return flush(entry);}
    const text=entry.pending;
    try {
      entry.saving=write(entry,text);await entry.saving;
      entry.source=text;if(entry.pending===text)entry.pending=null;
    } finally {entry.saving=undefined;}
    if(entry.pending!==null)await flush(entry);
  }
  function capture(entry:Entry) {
    const text=entry.editor.getMarkdown();if(text===entry.serialized)return;
    entry.serialized=text;entry.pending=text;
  }
  function changed(entry:Entry) {
    if(composition.isComposing(entry.editor.view.dom)||entry.editor.view.composing)return;
    capture(entry);
    void flush(entry).catch(error=>notify(errorOf(error).message,'error',true));
  }
  async function history(redo:boolean) {
    try {await manager.flushAll();if(redo)await store.redo();else await store.undo();}
    catch(error){notify(errorOf(error).message,'error',true);}
  }
  function continueIntoNext(source:Entry) {
    source.creating=true;
    // Receive native input immediately in a real rich editor. Waiting for IDB
    // before focusing lets the next key edit the source paragraph instead.
    const id=crypto.randomUUID(),host=mount({id,type:'text',text:''},source.pageId),next=entries.get(key(source.pageId,id))!;
    next.provisional=true;next.creating=true;host.dataset.pendingBlock='true';source.host.append(host);
    next.editor.view.focus();host.scrollIntoView({block:'nearest'});
    const retry=document.createElement('button');retry.type='button';retry.textContent='Retry creating block';retry.hidden=true;host.append(retry);
    let running=false,created:string|undefined;
    async function finish() {
      if(running)return;running=true;retry.hidden=true;
      try {
        if(!next.provisional){await flush(next);retry.remove();return;}
        created??=await createNext(source.blockId,source.pageId);
        if(!created)throw new Error('The page changed before the next block could be created. Your text remains in the pending editor.');
        // Adopt the same DOM/editor, including its caret, after any IME final
        // acknowledgement. Never move an active composition to another view.
        await composition.settled(input=>input===next.editor.view.dom);
        const target=entries.get(key(source.pageId,created));
        if(!target?.host.isConnected)throw new Error('The next block is no longer visible. Your text remains in the pending editor.');
        const focused=document.activeElement===next.editor.view.dom;
        target.editor.destroy();target.host.replaceWith(host);entries.delete(key(source.pageId,created));entries.delete(key(source.pageId,id));
        next.blockId=created;next.provisional=false;next.creating=false;host.dataset.textEditor=created;delete host.dataset.pendingBlock;next.editor.view.dom.id=`${created}-text`;
        entries.set(key(source.pageId,created),next);
        if(focused)next.editor.view.focus();capture(next);await flush(next);retry.remove();
      }catch(error){retry.hidden=false;notify(errorOf(error).message,'error',true);}
      finally{source.creating=false;running=false;}
    }
    retry.addEventListener('click',()=>{next.creation=Promise.resolve().then(finish);});next.creation=Promise.resolve().then(finish);
  }
  function mount(block:TextBlock,pageId:string,item?:ChecklistItem,onKeyDown?:ItemKeyDown) {
    const source=item?.text??block.text,id=key(pageId,block.id,item?.id);let entry=entries.get(id);
    if(entry) {
      entry.onKeyDown=onKeyDown;
      if(entry.source!==source&&entry.pending===null&&!entry.saving&&!composition.isComposing(entry.editor.view.dom)) {
        entry.editor.commands.setContent(source,{contentType:'markdown',emitUpdate:false});
        entry.source=source;entry.serialized=entry.editor.getMarkdown();
      }
      return entry.host;
    }
    const host=document.createElement('div');host.className=item?'text-editor checklist-text-editor':'text-editor';
    if(item)host.dataset.checklistEditor=item.id;else host.dataset.textEditor=block.id;
    const toolbar=document.createElement('div');toolbar.className='markdown-toolbar';toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','Text formatting');
    const surface=document.createElement('div');surface.className='markdown-surface';if(!item)host.append(toolbar);host.append(surface);
    const editor=new Editor({element:surface,injectCSS:false,extensions:[StarterKit.configure({undoRedo:false,underline:false,trailingNode:false,link:{openOnClick:false}}),Markdown],content:source,contentType:'markdown',
      editorProps:{attributes:{id:item?.id??`${block.id}-text`,class:'markdown-editor',role:'textbox','aria-label':item?'Checklist item':'text content','aria-multiline':'true','aria-keyshortcuts':item?'Enter Shift+Enter Tab Shift+Tab':'Shift+Enter Alt+F10','data-placeholder':item?'A little thing to do':'Write something…'},
        handleClick:(view,_pos,event)=>{
          if(event.button!==0||event.shiftKey||event.altKey||view.composing||composition.isComposing(view.dom))return false;
          const link=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a[href]'):null;
          if(!link||!view.dom.contains(link)||!link.getAttribute('href'))return false;
          // Tiptap's built-in opener does not pass security features to window.open.
          window.open(link.href,'_blank','noopener,noreferrer');return true;
        },
        handlePaste:(view,event)=>{
          const clipboard=event.clipboardData,text=clipboard?.getData('text/plain');
          if(!text||clipboard?.getData('text/html')||view.state.selection.$from.parent.type.name==='codeBlock')return false;
          editor.commands.insertContent(text,{contentType:'markdown'});return true;
        },
        handleKeyDown:(_view,event)=>{
          if(event.isComposing||event.keyCode===229||editor.view.composing)return false;
          if(composition.isComposing(editor.view.dom))return event.key==='Enter'||event.key==='Tab';
          if(!item&&event.altKey&&event.key==='F10') {toolbar.dataset.keyboardOpen='true';toolbar.querySelector<HTMLButtonElement>('button')?.focus();return true;}
          if(entry?.onKeyDown?.(event))return true;
          if(item&&event.key==='Tab')return false;
          if(!item&&event.key==='Enter'&&event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey) {
            if(!entry!.creating&&!event.repeat) {
              continueIntoNext(entry!);
            }
            return true;
          }
          if((event.ctrlKey||event.metaKey)&&!event.altKey&&(event.key.toLowerCase()==='z'||event.key.toLowerCase()==='y')) {
            void history(event.shiftKey||event.key.toLowerCase()==='y');return true;
          }
          return false;
        }
      },onUpdate:()=>{if(entry)changed(entry);}
    });
    entry={host,editor,pageId,blockId:block.id,itemId:item?.id,onKeyDown,source,serialized:editor.getMarkdown(),pending:null,creating:false};entries.set(id,entry);
    composition.track(editor.view.dom,async()=>{
      try {
        // Let ProseMirror consume the final DOM mutation before saving composed text.
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
        if(entry!.provisional){capture(entry!);return;}
        // The guard remains active until this write resolves, so flush directly here.
        if(entry!.saving)await entry!.saving;
        for(;;) {
          capture(entry!);if(entry!.pending===null)break;
          const text=entry!.pending;entry!.saving=write(entry!,text);
          try{await entry!.saving;entry!.source=text;if(entry!.pending===text)entry!.pending=null;}finally{entry!.saving=undefined;}
        }
      } catch(error){capture(entry!);notify(errorOf(error).message,'error',true);}
    },()=>pageId);
    const controls:[string,string,(editor:Editor)=>void,()=>boolean][]=[
      ['B','Bold',e=>{e.chain().focus().toggleBold().run();},()=>editor.isActive('bold')],
      ['I','Italic',e=>{e.chain().focus().toggleItalic().run();},()=>editor.isActive('italic')],
      ['S','Strikethrough',e=>{e.chain().focus().toggleStrike().run();},()=>editor.isActive('strike')],
      ['</>','Inline code',e=>{e.chain().focus().toggleCode().run();},()=>editor.isActive('code')],
      ['H2','Heading',e=>{e.chain().focus().toggleHeading({level:2}).run();},()=>editor.isActive('heading',{level:2})],
      ['•','Bullet list',e=>{e.chain().focus().toggleBulletList().run();},()=>editor.isActive('bulletList')],
      ['1.','Numbered list',e=>{e.chain().focus().toggleOrderedList().run();},()=>editor.isActive('orderedList')],
      ['❝','Quote',e=>{e.chain().focus().toggleBlockquote().run();},()=>editor.isActive('blockquote')],
      ['```','Code block',e=>{e.chain().focus().toggleCodeBlock().run();},()=>editor.isActive('codeBlock')]
    ];
    const buttons=(item?[]:controls).map(([label,name,run])=>{
      const button=document.createElement('button');button.type='button';button.className='markdown-tool';button.textContent=label;button.title=name;button.setAttribute('aria-label',name);
      let selection:{from:number;to:number}|null=null;
      const captureSelection=()=>{
        if(selection)return;selection={from:editor.state.selection.from,to:editor.state.selection.to};
        // Touch browsers may collapse the DOM selection before delivering click.
        const range=window.getSelection(),view=editor.view;
        if(range?.anchorNode&&range.focusNode&&view.dom.contains(range.anchorNode)&&view.dom.contains(range.focusNode)) {
          const anchor=view.posAtDOM(range.anchorNode,range.anchorOffset),head=view.posAtDOM(range.focusNode,range.focusOffset),max=editor.state.doc.content.size-1;
          selection={from:Math.max(1,Math.min(anchor,head,max)),to:Math.max(1,Math.min(Math.max(anchor,head),max))};
        }
      };
      button.addEventListener('touchstart',captureSelection,{passive:true});
      button.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse')event.preventDefault();captureSelection();});
      button.addEventListener('pointercancel',()=>{selection=null;});
      button.addEventListener('mousedown',event=>event.preventDefault());
      button.addEventListener('click',()=>{if(selection)editor.commands.setTextSelection(selection);selection=null;run(editor);});toolbar.append(button);return button;
    });
    const sync=()=>{buttons.forEach((button,index)=>button.setAttribute('aria-pressed',String(controls[index][3]())));host.dataset.empty=String(editor.isEmpty);};
    toolbar.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();delete toolbar.dataset.keyboardOpen;editor.view.focus();}});
    toolbar.addEventListener('focusout',()=>queueMicrotask(()=>{if(!toolbar.contains(document.activeElement))delete toolbar.dataset.keyboardOpen;}));
    editor.on('transaction',sync);sync();return host;
  }
  const manager={mount,
    mountChecklist(blockId:string,item:ChecklistItem,pageId:string,onKeyDown:ItemKeyDown){return mount({id:blockId,type:'text',text:item.text},pageId,item,onKeyDown);},
    end(){for(const [id,entry] of entries)if(!entry.provisional&&(entry.pageId!==store.getActivePageId()||!entry.host.isConnected)){entry.editor.destroy();entries.delete(id);}},
    captureFocus(){const entry=[...entries.values()].find(e=>e.editor.view.dom===document.activeElement);return entry?key(entry.pageId,entry.blockId,entry.itemId):null;},
    restoreFocus(id:string|null){const entry=id&&entries.get(id);if(entry&&entry.host.isConnected)entry.editor.view.focus();},
    focus(blockId:string){
      const entry=entries.get(key(store.getActivePageId(),blockId));if(!entry?.host.isConnected)return;
      // These vanilla views are mounted synchronously. Focus the new selection
      // directly instead of Tiptap's delayed React focus path.
      entry.editor.commands.setTextSelection(1);entry.editor.view.focus();entry.editor.view.dom.scrollIntoView({block:'nearest'});
    },
    hasPending(){return [...entries.values()].some(entry=>entry.provisional||entry.pending!==null||entry.saving);},
    async flushAll({waitForTransitions=true}:{waitForTransitions?:boolean}={}){
      if(waitForTransitions){await Promise.all([...entries.values()].map(entry=>entry.creation));if([...entries.values()].some(entry=>entry.provisional))throw new Error('The next block has not been saved. Retry creating block before leaving this page.');}
      await Promise.all([...entries.values()].map(flush));await store.idle();
    },
    destroy(){for(const entry of entries.values())entry.editor.destroy();entries.clear();}
  };return manager;
}
