import type {Editor} from './text-editor-engine.js';
import type {BlockType,Orientation} from './types.js';
import {icon} from './icons.js';
export interface SlashOption {type:BlockType;orientation?:Orientation;name:string;caption:string}

/** The command replaces a single plain paragraph beginning with slash. */
export function slashQuery(editor:Editor):string|null {
  const {doc,selection}=editor.state,paragraph=doc.firstChild;
  if(!selection.empty||doc.childCount!==1||paragraph?.type.name!=='paragraph')return null;
  for(let i=0;i<paragraph.childCount;i++){const child=paragraph.child(i);if(!child.isText||child.marks.some(mark=>mark.type.name==='code'))return null;}
  const text=paragraph.textContent;
  if(!text.startsWith('/')||text.length>65||selection.from!==text.length+1)return null;
  return text.slice(1);
}

/** Keep focus in the editor; listbox selection is announced via aria-activedescendant. */
export function createSlashMenu(editor:Editor,{host,getOptions,select,canOpen}:{host:HTMLElement;getOptions:()=>SlashOption[];select:(option:SlashOption)=>void;canOpen:()=>boolean}) {
  const menu=document.createElement('div');menu.className='slash-menu';menu.id=`slash-${crypto.randomUUID()}`;menu.hidden=true;menu.setAttribute('role','listbox');menu.setAttribute('aria-label','Block types');document.body.append(menu);
  const input=editor.view.dom;let query:string|null=null,dismissed:string|null=null,selected=0,matches:SlashOption[]=[],destroyed=false;
  input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-haspopup','listbox');input.setAttribute('aria-expanded','false');
  function close(){menu.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-controls');input.removeAttribute('aria-activedescendant');}
  function position(){
    if(menu.hidden)return;
    const rect=editor.view.coordsAtPos(editor.state.selection.from),width=Math.min(340,innerWidth-16);
    menu.style.width=`${width}px`;menu.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-width-8))}px`;
    const below=innerHeight-rect.bottom-12,above=rect.top-12,up=below<180&&above>below,space=Math.max(80,up?above:below);
    menu.style.maxHeight=`${Math.min(320,space)}px`;menu.style.top=up?'auto':`${rect.bottom+6}px`;menu.style.bottom=up?`${innerHeight-rect.top+6}px`:'auto';
  }
  function render(){
    menu.replaceChildren();
    matches.forEach((option,index)=>{
      const row=document.createElement('div');row.className='slash-option';row.id=`${menu.id}-${index}`;row.setAttribute('role','option');row.setAttribute('aria-selected',String(index===selected));
      const text=document.createElement('span'),name=document.createElement('strong'),caption=document.createElement('small');name.textContent=option.name;caption.textContent=option.caption;text.append(name,caption);
      row.append(icon(option.type==='tabs'&&option.orientation==='vertical'?'vertical':option.type),text);
      row.addEventListener('pointerdown',event=>{event.preventDefault();});row.addEventListener('mousedown',event=>event.preventDefault());
      row.addEventListener('click',()=>{close();select(option);});menu.append(row);
    });
    if(!matches.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='No matching blocks';menu.append(empty);}
    const help=document.createElement('small');help.className='slash-help';help.textContent='↑↓ to choose · Enter to create · Esc to close';menu.append(help);
    menu.hidden=false;input.setAttribute('aria-controls',menu.id);input.setAttribute('aria-expanded','true');
    if(matches[selected])input.setAttribute('aria-activedescendant',`${menu.id}-${selected}`);else input.removeAttribute('aria-activedescendant');position();
  }
  function update(){
    if(destroyed)return;
    const next=slashQuery(editor);if(next!==query){selected=0;dismissed=null;}query=next;
    if(next===null||next===dismissed||!host.isConnected||document.activeElement!==input||!canOpen()||editor.view.composing){close();return;}
    const terms=next.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    matches=getOptions().filter(option=>terms.every(term=>`${option.name} ${option.type} ${option.caption}`.toLocaleLowerCase().includes(term)));
    selected=Math.min(selected,Math.max(0,matches.length-1));render();
  }
  function handleKeyDown(event:KeyboardEvent){
    if(menu.hidden)return false;
    if(event.key==='Escape'){dismissed=query;close();event.stopPropagation();return true;}
    if(event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return false;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      if(matches.length)selected=(selected+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length;
      render();document.getElementById(`${menu.id}-${selected}`)?.scrollIntoView({block:'nearest'});return true;
    }
    if(event.key==='Enter'||event.key==='Tab'){
      const option=matches[selected];if(option){close();if(!event.repeat)select(option);return true;}
      if(event.key==='Tab'){dismissed=query;close();return false;}return true;
    }
    return false;
  }
  const blur=()=>close(),outside=(event:PointerEvent)=>{if(!host.contains(event.target as Node)&&!menu.contains(event.target as Node))close();};
  editor.on('transaction',update);editor.on('focus',update);input.addEventListener('blur',blur);input.addEventListener('compositionstart',close);
  document.addEventListener('pointerdown',outside);document.addEventListener('scroll',position,true);window.addEventListener('resize',position);
  return {update,handleKeyDown,close,destroy(){destroyed=true;close();editor.off('transaction',update);editor.off('focus',update);input.removeEventListener('blur',blur);input.removeEventListener('compositionstart',close);document.removeEventListener('pointerdown',outside);document.removeEventListener('scroll',position,true);window.removeEventListener('resize',position);menu.remove();}};
}
