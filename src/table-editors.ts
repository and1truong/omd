import {pasteMarkdown} from './markdown-paste.js';
import {Editor,StarterKit,Markdown} from './text-editor-engine.js';
import type {NotebookStore,Notify} from './types.js';
import type {createCompositionGuard} from './composition.js';
import type {createTableEdits} from './table-edits.js';
import {errorOf} from './dom.js';
interface Cell {host:HTMLDivElement;editor:Editor;pageId:string;blockId:string;rowId:string;columnId:string;source:string;serialized:string;dirty:boolean;preediting:boolean;saving:Set<Promise<void>>;onKeyDown:(event:KeyboardEvent)=>boolean}
export function createTableEditors(store:NotebookStore,{composition,drafts,notify,flushPending}:{composition:ReturnType<typeof createCompositionGuard>;drafts:ReturnType<typeof createTableEdits>;notify:Notify;flushPending:(options?:{waitForComposition?:boolean})=>Promise<unknown>}) {
  const key=(...ids:string[])=>JSON.stringify(ids),cells=new Map<string,Cell>();
  const bars=new Map<string,{host:HTMLDivElement;active:string|null;buttons:HTMLButtonElement[]}>();
  const controls:[string,string,(editor:Editor)=>void,(editor:Editor)=>boolean][]=[
    ['B','Bold',e=>{e.chain().focus().toggleBold().run();},e=>e.isActive('bold')],
    ['I','Italic',e=>{e.chain().focus().toggleItalic().run();},e=>e.isActive('italic')],
    ['S','Strikethrough',e=>{e.chain().focus().toggleStrike().run();},e=>e.isActive('strike')],
    ['</>','Inline code',e=>{e.chain().focus().toggleCode().run();},e=>e.isActive('code')],
    ['•','Bullet list',e=>{e.chain().focus().toggleBulletList().run();},e=>e.isActive('bulletList')],
    ['1.','Numbered list',e=>{e.chain().focus().toggleOrderedList().run();},e=>e.isActive('orderedList')],
    ['↗','Link',e=>{const value=window.prompt('Link URL (leave empty to remove)');if(value===null)return;if(!value.trim()){e.chain().focus().unsetLink().run();return;}try{const url=new URL(value,document.baseURI);if(!['http:','https:','mailto:','tel:'].includes(url.protocol))throw new Error('Use an http, https, mailto or tel link.');e.chain().focus().extendMarkRange('link').setLink({href:url.href}).run();}catch(error){notify(errorOf(error).message,'error',true);}},e=>e.isActive('link')]
  ];
  function sync(cell:Cell){const bar=bars.get(key(cell.pageId,cell.blockId));if(!bar)return;if(bar.active!==key(cell.pageId,cell.blockId,cell.rowId,cell.columnId))return;bar.buttons.forEach((button,i)=>{button.disabled=cell.preediting||composition.isComposing(cell.editor.view.dom);button.setAttribute('aria-pressed',String(controls[i][3](cell.editor)));});}
  function toolbar(blockId:string,pageId:string){
    const id=key(pageId,blockId),existing=bars.get(id);if(existing)return existing.host;
    const host=document.createElement('div');host.className='table-cell-toolbar';host.setAttribute('role','toolbar');host.setAttribute('aria-label','Table text formatting');
    const bar={host,active:null as string|null,buttons:[] as HTMLButtonElement[]};bars.set(id,bar);
    for(const [label,name,run]of controls){const button=document.createElement('button');button.type='button';button.className='markdown-tool';button.textContent=label;button.title=name;button.setAttribute('aria-label',name);button.disabled=true;
      button.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse')event.preventDefault();});button.addEventListener('mousedown',event=>event.preventDefault());
      button.addEventListener('click',()=>{const cell=bar.active&&cells.get(bar.active);if(cell&&cell.host.isConnected&&!cell.preediting&&!composition.isComposing(cell.editor.view.dom))run(cell.editor);});host.append(button);bar.buttons.push(button);}
    host.addEventListener('keydown',event=>{if(event.key==='Escape'){const cell=bar.active&&cells.get(bar.active);if(cell){event.preventDefault();event.stopPropagation();cell.editor.view.focus();}}});return host;
  }
  function save(cell:Cell,text=cell.serialized){
    cell.dirty=true;const task=drafts.write(cell.pageId,cell.blockId,cell.rowId,cell.columnId,text).then(()=>{if(cell.serialized===text){cell.source=text;cell.dirty=false;}});
    cell.saving.add(task);void task.finally(()=>{cell.saving.delete(task);}).catch(()=>{});return task;
  }
  function changed(cell:Cell){if(cell.preediting||cell.editor.view.composing)return;const text=cell.editor.getMarkdown();if(text===cell.serialized)return;cell.serialized=text;void save(cell,text).catch(error=>notify(errorOf(error).message,'error',true));}
  function mount({pageId,blockId,rowId,columnId,source,id,label,onKeyDown}:{pageId:string;blockId:string;rowId:string;columnId:string;source:string;id:string;label:string;onKeyDown:(event:KeyboardEvent)=>boolean}){
    const cellKey=key(pageId,blockId,rowId,columnId);let cell=cells.get(cellKey);
    if(cell){cell.onKeyDown=onKeyDown;cell.editor.view.dom.setAttribute('aria-label',label);if(!cell.dirty&&!cell.saving.size&&!composition.isComposing(cell.editor.view.dom)&&cell.source!==source){if(cell.serialized!==source)cell.editor.commands.setContent(source,{contentType:'markdown',emitUpdate:false});cell.source=source;cell.serialized=cell.editor.getMarkdown();}return cell.host;}
    const host=document.createElement('div');host.className='table-cell-editor';
    const editor=new Editor({element:host,injectCSS:false,extensions:[StarterKit.configure({undoRedo:false,underline:false,trailingNode:false,link:{openOnClick:false}}),Markdown],content:source,contentType:'markdown',editorProps:{attributes:{id,class:'markdown-editor table-cell',role:'textbox','aria-label':label,'aria-multiline':'true','aria-keyshortcuts':'Tab Shift+Tab Enter Shift+Enter Alt+F10'},
      handleClick:(view,_pos,event)=>{if(event.button!==0||event.shiftKey||event.altKey||view.composing||composition.isComposing(view.dom))return false;const link=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a[href]'):null;if(!link||!view.dom.contains(link)||!link.getAttribute('href'))return false;window.open(link.href,'_blank','noopener,noreferrer');return true;},
      handlePaste:(_view,event)=>pasteMarkdown(editor,event),
      handleKeyDown:(_view,event)=>{
        if(event.isComposing||event.keyCode===229||editor.view.composing)return false;
        if(composition.isComposing(editor.view.dom))return event.key==='Enter'||event.key==='Tab';
        if(event.altKey&&event.key==='F10'){bars.get(key(pageId,blockId))?.buttons[0]?.focus();return true;}
        if((event.ctrlKey||event.metaKey)&&!event.altKey&&['z','y'].includes(event.key.toLowerCase())){void (async()=>{await flushPending({waitForComposition:true});if(event.shiftKey||event.key.toLowerCase()==='y')await store.redo();else await store.undo();})().catch(error=>notify(errorOf(error).message,'error',true));return true;}
        return cell?.onKeyDown(event)??false;
      }
    },onUpdate:()=>{if(cell)changed(cell);}});
    cell={host,editor,pageId,blockId,rowId,columnId,source,serialized:editor.getMarkdown(),dirty:false,preediting:false,saving:new Set(),onKeyDown};cells.set(cellKey,cell);
    editor.view.dom.addEventListener('focus',()=>{const bar=bars.get(key(pageId,blockId));if(bar)bar.active=cellKey;sync(cell!);});editor.on('transaction',()=>sync(cell!));
    editor.view.dom.addEventListener('compositionstart',()=>{if(!cell!.preediting){const text=editor.getMarkdown();if(text!==cell!.serialized){cell!.serialized=text;void save(cell!,text).catch(error=>notify(errorOf(error).message,'error',true));}}cell!.preediting=true;});
    composition.track(editor.view.dom,async()=>{try{await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));if(!cell!.preediting){const text=editor.getMarkdown();if(text!==cell!.serialized){cell!.serialized=text;cell!.dirty=true;}}if(cell!.dirty)await save(cell!);await Promise.all([...cell!.saving]);}catch(error){notify(errorOf(error).message,'error',true);}},()=>pageId);
    editor.view.dom.addEventListener('compositionstart',()=>sync(cell!));
    editor.view.dom.addEventListener('compositionend',()=>{cell!.preediting=false;void composition.settled(input=>input===editor.view.dom).then(()=>sync(cell!));});return host;
  }
  const manager={mount,toolbar,
    captureFocus(){return [...cells].find(([,cell])=>cell.editor.view.dom===document.activeElement)?.[0]??null;},
    restoreFocus(id:string|null){const cell=id?cells.get(id):undefined;if(cell?.host.isConnected)cell.editor.view.focus();},
    hasPending(){return [...cells.values()].some(cell=>cell.dirty||cell.saving.size||cell.preediting||composition.isComposing(cell.editor.view.dom));},
    end(){for(const [id,cell]of cells)if((cell.pageId!==store.getActivePageId()||!cell.host.isConnected)&&!cell.dirty&&!cell.saving.size&&!composition.isComposing(cell.editor.view.dom)){cell.editor.destroy();cells.delete(id);}for(const [id,bar]of bars){if(bar.active&&!cells.has(bar.active)){bar.active=null;for(const button of bar.buttons){button.disabled=true;button.setAttribute('aria-pressed','false');}}if(!bar.host.isConnected&&![...cells.values()].some(cell=>key(cell.pageId,cell.blockId)===id))bars.delete(id);}},
    async flushAll(){await composition.settled(input=>[...cells.values()].some(cell=>cell.editor.view.dom===input));for(const cell of cells.values()){await Promise.all([...cell.saving]);if(cell.dirty)await save(cell);}await drafts.flushAll();manager.end();},
    destroy(){for(const cell of cells.values())cell.editor.destroy();cells.clear();bars.clear();}
  };return manager;
}
