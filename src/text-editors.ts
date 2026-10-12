import {Editor,StarterKit,Markdown} from './text-editor-engine.js';
import type {NotebookStore,TextBlock,Notify} from './types.js';
import type {createCompositionGuard} from './composition.js';
import {errorOf} from './dom.js';

/** Visible text blocks own a Tiptap instance; persisted content stays Markdown. */
export function createTextEditors(store:NotebookStore,{composition,notify,createNext}:{composition:ReturnType<typeof createCompositionGuard>;notify:Notify;createNext:(blockId:string,pageId:string)=>Promise<unknown>}) {
  interface Entry {host:HTMLDivElement;editor:Editor;pageId:string;blockId:string;source:string;serialized:string;pending:string|null;saving?:Promise<unknown>;creating:boolean}
  const entries=new Map<string,Entry>(),key=(pageId:string,blockId:string)=>JSON.stringify([pageId,blockId]);
  async function flush(entry:Entry):Promise<void> {
    if(composition.isComposing(entry.editor.view.dom)||entry.pending===null)return;
    if(entry.saving){await entry.saving;return flush(entry);}
    const text=entry.pending;
    try {
      entry.saving=store.dispatch('update_block',{pageId:entry.pageId,blockId:entry.blockId,patch:{text}},{quiet:true});await entry.saving;
      entry.source=text;if(entry.pending===text)entry.pending=null;
    } finally {entry.saving=undefined;}
    if(entry.pending!==null)await flush(entry);
  }
  function changed(entry:Entry) {
    if(composition.isComposing(entry.editor.view.dom)||entry.editor.view.composing)return;
    const text=entry.editor.getMarkdown();if(text===entry.serialized)return;
    entry.serialized=text;entry.pending=text;
    void flush(entry).catch(error=>notify(errorOf(error).message,'error',true));
  }
  async function history(redo:boolean) {
    try {await manager.flushAll();if(redo)await store.redo();else await store.undo();}
    catch(error){notify(errorOf(error).message,'error',true);}
  }
  function mount(block:TextBlock,pageId:string) {
    const id=key(pageId,block.id);let entry=entries.get(id);
    if(entry) {
      if(entry.source!==block.text&&entry.pending===null&&!entry.saving&&!composition.isComposing(entry.editor.view.dom)) {
        entry.editor.commands.setContent(block.text,{contentType:'markdown',emitUpdate:false});
        entry.source=block.text;entry.serialized=entry.editor.getMarkdown();
      }
      return entry.host;
    }
    const host=document.createElement('div');host.className='text-editor';host.dataset.textEditor=block.id;
    const toolbar=document.createElement('div');toolbar.className='markdown-toolbar';toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','Text formatting');
    const surface=document.createElement('div');surface.className='markdown-surface';host.append(toolbar,surface);
    const editor=new Editor({element:surface,injectCSS:false,extensions:[StarterKit.configure({undoRedo:false,underline:false,trailingNode:false,link:{openOnClick:false}}),Markdown],content:block.text,contentType:'markdown',
      editorProps:{attributes:{id:`${block.id}-text`,class:'markdown-editor',role:'textbox','aria-label':'text content','aria-multiline':'true','aria-keyshortcuts':'Shift+Enter','data-placeholder':'Write something…'},
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
          if(event.isComposing||editor.view.composing||composition.isComposing(editor.view.dom))return false;
          if(event.key==='Enter'&&event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey) {
            if(!entry!.creating&&!event.repeat) {
              entry!.creating=true;
              void createNext(block.id,pageId).catch(error=>notify(errorOf(error).message,'error',true)).finally(()=>{entry!.creating=false;});
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
    entry={host,editor,pageId,blockId:block.id,source:block.text,serialized:editor.getMarkdown(),pending:null,creating:false};entries.set(id,entry);
    composition.track(editor.view.dom,async()=>{
      try {
        // Let ProseMirror consume the final DOM mutation before saving composed text.
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
        const text=editor.getMarkdown();if(text!==entry!.serialized){entry!.serialized=text;entry!.pending=text;}
        // The guard remains active until this write resolves, so flush directly here.
        if(entry!.saving)await entry!.saving;
        if(entry!.pending!==null){const text=entry!.pending;await store.dispatch('update_block',{pageId,blockId:block.id,patch:{text}},{quiet:true});entry!.source=text;if(entry!.pending===text)entry!.pending=null;}
      } catch(error){notify(errorOf(error).message,'error',true);}
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
    const buttons=controls.map(([label,name,run])=>{
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
    editor.on('transaction',sync);sync();return host;
  }
  const manager={mount,
    end(){for(const [id,entry] of entries)if(entry.pageId!==store.getActivePageId()||!entry.host.isConnected){entry.editor.destroy();entries.delete(id);}},
    captureFocus(){const entry=[...entries.values()].find(e=>e.editor.view.dom===document.activeElement);return entry?key(entry.pageId,entry.blockId):null;},
    restoreFocus(id:string|null){const entry=id&&entries.get(id);if(entry&&entry.host.isConnected)entry.editor.view.focus();},
    focus(blockId:string){
      const entry=entries.get(key(store.getActivePageId(),blockId));if(!entry?.host.isConnected)return;
      // These vanilla views are mounted synchronously. Focus the new selection
      // directly instead of Tiptap's delayed React focus path.
      entry.editor.commands.setTextSelection(1);entry.editor.view.focus();entry.editor.view.dom.scrollIntoView({block:'nearest'});
    },
    async flushAll(){await Promise.all([...entries.values()].map(flush));await store.idle();},
    destroy(){for(const entry of entries.values())entry.editor.destroy();entries.clear();}
  };return manager;
}
