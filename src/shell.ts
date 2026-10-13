import type {NotebookStore,PartialView,Page,PageRow,ChangeEvent,ErrorHandler,CommandName,CommandInput,Theme} from './types.js';
import {errorOf} from './dom.js';
import {byId as domId} from './dom.js';
import {icon} from './icons.js';
import {createView,validateView,VIEW_KEY} from './view.js';
import {reconcile} from './render-cache.js';
import {pageAncestors,MAX_PAGE_LEVELS} from './notebook.js';
import {pagePath,followPageLink} from './routes.js';
import {createPageDrag} from './page-drag.js';

interface MenuAction {label:string;icon:string;disabled?:boolean;danger?:boolean;run:()=>unknown}
export function showMenu(id:'block-actions-dialog'|'page-actions-dialog',title:string,actions:MenuAction[],anchor:HTMLElement) {
  const dialog=domId(id),heading=dialog.querySelector('h2')!,list=dialog.querySelector<HTMLElement>('.action-list')!;heading.textContent=title;list.replaceChildren();
  for(const action of actions){const b=document.createElement('button');b.type='button';b.className=`action-item${action.danger?' danger':''}`;b.disabled=!!action.disabled;b.append(icon(action.icon));const label=document.createElement('span');label.textContent=action.label;b.append(label);b.addEventListener('click',()=>{dialog.close();action.run();});list.append(b);}
  dialog.showModal();const r=anchor.getBoundingClientRect(),bounds=dialog.getBoundingClientRect();dialog.style.left=`${Math.max(8,Math.min(r.left,innerWidth-bounds.width-8))}px`;dialog.style.top=`${Math.max(8,Math.min(r.bottom+6,innerHeight-bounds.height-8))}px`;list.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
}
export function setupShell(store:NotebookStore,{beforeNavigate,openPalette,confirm,onError,onThemeChange}:{beforeNavigate:()=>Promise<unknown>;openPalette:()=>unknown;confirm:(title:string,message:string,yes?:string)=>Promise<boolean>;onError:ErrorHandler;onThemeChange:(theme:Theme)=>unknown}) {
  const sidebar=domId('sidebar'),toggle=domId('sidebar-toggle'),pages=domId('sidebar-pages'),media=matchMedia('(max-width: 760px)'),view=createView({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},store.getRenderState().theme),rows=new Map<string,{node:HTMLDivElement;expand:HTMLButtonElement;select:HTMLAnchorElement;label:HTMLSpanElement;more:HTMLButtonElement}>();
  const menu=domId('page-menu'),widthToggle=domId('page-width'),widthLabel=widthToggle.querySelector('span')!;let drawerOpen=false,lastActivePath:string|null=null,movingPageId:string|null=null,breadcrumbSignature='';
  async function run<K extends CommandName>(name:K,input:CommandInput<K>){try{await beforeNavigate();return await store.dispatch(name,input);}catch(error){onError(errorOf(error));return null;}}
  function closeMobile(){if(media.matches){drawerOpen=false;if(sidebar.open)sidebar.close();sync();}}
  function sync(){
    const state=view.get(),open=media.matches?drawerOpen:state.sidebarOpen,fromToggle=document.activeElement===toggle;
    onThemeChange(state.theme);
    document.body.classList.toggle('sidebar-open',!media.matches&&open);document.body.dataset.contentWidth=state.contentWidth;toggle.setAttribute('aria-expanded',String(open));toggle.hidden=open;
    const fluid=state.contentWidth==='wide';widthLabel.textContent=fluid?'Fluid':'Fixed';widthToggle.setAttribute('aria-pressed',String(fluid));widthToggle.title=`Page width: ${fluid?'Fluid':'Fixed'}. Switch to ${fluid?'Fixed':'Fluid'}.`;
    if(sidebar.open!==open){if(open){if(media.matches)sidebar.showModal();else{const active=document.activeElement as HTMLElement|null;sidebar.show();active?.focus({preventScroll:true});}}else sidebar.close();}
    if(open&&fromToggle)domId('sidebar-close').focus();
    window.dispatchEvent(new Event('resize'));
  }
  function getView(){return {...view.get(),sidebarOpen:!document.body.classList.contains('canvas-focused')&&sidebar.open};}
  function setView(patch:PartialView){
    validateView(patch);const saved={...patch};if(media.matches){drawerOpen=sidebar.open;delete saved.sidebarOpen;}
    if(patch.collapsedPageIds){const ids=new Set(store.listPages().map(p=>p.pageId));if(patch.collapsedPageIds.some(id=>!ids.has(id)))throw new Error('Collapsed page not found.');}
    if(Object.keys(saved).length)view.set(saved);
    if(media.matches&&patch.sidebarOpen!==undefined)drawerOpen=patch.sidebarOpen;
    if(patch.sidebarOpen&&document.body.classList.contains('canvas-focused'))beforeNavigate().catch(onError);
    sync();if(patch.collapsedPageIds)render(store.getRenderState());return getView();
  }
  function safeView(patch:PartialView){try{setView(patch);}catch(error){sync();onError(errorOf(error));}}
  const pageDrag=createPageDrag(pages,{rows:()=>store.listPages(),beforeMove:beforeNavigate,move:input=>store.dispatch('page_move',input),onError,expand:id=>safeView({collapsedPageIds:view.get().collapsedPageIds.filter(pageId=>pageId!==id)})});
  function render(state:Page,{actionName}:ChangeEvent={}){
    const focused=pages.contains(document.activeElement)?document.activeElement as HTMLElement:null;
    const pageList=store.listPages(),byId=new Map(pageList.map(p=>[p.pageId,p])),ancestors=pageAncestors(pageList,state.id),activePath=JSON.stringify([...ancestors.map(p=>p.pageId),state.id]);
    const savedCollapsed=view.get().collapsedPageIds,existingCollapsed=savedCollapsed.filter(id=>byId.has(id));if(existingCollapsed.length!==savedCollapsed.length)try{view.set({collapsedPageIds:existingCollapsed});}catch(error){onError(errorOf(error));}
    if(actionName==='page_select'||(lastActivePath!==null&&activePath!==lastActivePath)){const ids=new Set(ancestors.map(p=>p.pageId)),collapsed=view.get().collapsedPageIds,next=collapsed.filter(id=>!ids.has(id));if(next.length!==collapsed.length)try{view.set({collapsedPageIds:next});}catch(error){onError(errorOf(error));}}
    lastActivePath=activePath;
    const collapsed=new Set(view.get().collapsedPageIds),ids=new Set(),nodes=[];let hiddenDepth=null;
    for(const page of pageList){
      if(hiddenDepth!==null&&page.depth>hiddenDepth)continue;hiddenDepth=null;if(collapsed.has(page.pageId))hiddenDepth=page.depth;ids.add(page.pageId);
      let row=rows.get(page.pageId);
      if(!row){
        const node=document.createElement('div');node.className='sidebar-page';node.dataset.pageId=page.pageId;
        const drag=document.createElement('button');drag.type='button';drag.className='icon-button page-drag-handle';drag.append(icon('drag'));drag.setAttribute('aria-label',`Drag page ${page.title||'Untitled page'}`);drag.title='Drag above/below to reorder, or onto a page to nest';pageDrag.attach(drag,page.pageId);node.append(drag);
        const expand=document.createElement('button');expand.type='button';expand.className='icon-button page-tree-toggle';
        expand.addEventListener('click',()=>{const ids=new Set(view.get().collapsedPageIds);if(ids.has(page.pageId))ids.delete(page.pageId);else ids.add(page.pageId);safeView({collapsedPageIds:[...ids]});});
        const select=document.createElement('a');select.href=pagePath(page.pageId);select.className='sidebar-page-select';select.append(icon('page'));const label=document.createElement('span');select.append(label);
        select.addEventListener('click',event=>followPageLink(event,()=>{closeMobile();run('page_select',{pageId:page.pageId});}));
        const more=document.createElement('button');more.type='button';more.className='icon-button sidebar-page-more';more.append(icon('more'));
        more.addEventListener('click',()=>{
          const current=store.listPages(),p=current.find(p=>p.pageId===page.pageId)!;
          showMenu('page-actions-dialog',p.title||'Untitled page',[
            {label:'Add subpage',icon:'plus',disabled:p.depth+1>=MAX_PAGE_LEVELS,run:()=>createPage(p.pageId)},
            {label:'Move page up',icon:'up',disabled:p.index===0,run:()=>run('page_move',{pageId:p.pageId,index:p.index-1})},
            {label:'Move page down',icon:'down',disabled:p.index===p.siblingCount-1,run:()=>run('page_move',{pageId:p.pageId,index:p.index+1})},
            {label:'Move to…',icon:'page',run:()=>openMove(p.pageId)},
            {label:'Move to notebook',icon:'notebook',disabled:p.parentId==='',run:()=>run('page_move',{pageId:p.pageId,parentId:''})},
            {label:'Delete page',icon:'trash',danger:true,disabled:p.descendantCount+1===current.length,run:async()=>{if(await confirm('Delete this page?',`This removes the page and ${p.descendantCount} subpage(s), including their content. You can undo it.`,'Delete page'))run('page_remove',{pageId:p.pageId});}},
          ],more);
        });node.append(expand,select,more);row={node,select,label,more,expand};rows.set(page.pageId,row);
      }
      const name=page.title||'Untitled page';if(row.label.textContent!==name)row.label.textContent=name;row.select.title=name;row.select.setAttribute('aria-label',`Switch to ${name}`);row.more.setAttribute('aria-label',`Page actions for ${name}`);
      row.node.querySelector('.page-drag-handle')!.setAttribute('aria-label',`Drag page ${name}`);
      if(page.active)row.select.setAttribute('aria-current','page');else row.select.removeAttribute('aria-current');nodes.push(row.node);
      row.node.style.setProperty('--page-depth',String(Math.min(page.depth,6)));row.select.setAttribute('aria-description',page.parentId?`Subpage of ${byId.get(page.parentId)!.title||'Untitled page'}`:'Notebook root page');
      row.expand.disabled=!page.childCount;row.expand.style.visibility=page.childCount?'visible':'hidden';
      const expanded=!collapsed.has(page.pageId);row.expand.setAttribute('aria-label',`${expanded?'Collapse':'Expand'} subpages of ${name}`);if(page.childCount)row.expand.setAttribute('aria-expanded',String(expanded));else row.expand.removeAttribute('aria-expanded');
      if(row.expand.dataset.expanded!==String(expanded)){row.expand.replaceChildren(icon(expanded?'down':'toggle'));row.expand.dataset.expanded=String(expanded);}
    }
    for(const id of rows.keys())if(!ids.has(id))rows.delete(id);reconcile(pages,nodes);
    if(focused?.isConnected&&document.activeElement!==focused)focused.focus({preventScroll:true});
    const heading=domId('app-page-title');if(heading.textContent!==state.title)heading.textContent=state.title||'Untitled page';heading.title=state.title||'Untitled page';
    domId('page-new-child').disabled=byId.get(state.id)!.depth+1>=MAX_PAGE_LEVELS;
    const signature=JSON.stringify(ancestors.map(p=>[p.pageId,p.title]));if(signature!==breadcrumbSignature){const trail=domId('page-ancestors');trail.replaceChildren();for(const parent of ancestors){const segment=document.createElement('span');segment.className='ancestor-segment';const link=document.createElement('a');link.href=pagePath(parent.pageId);link.textContent=parent.title||'Untitled page';link.title=link.textContent;link.setAttribute('aria-label',`Open parent page ${link.textContent}`);link.addEventListener('click',event=>followPageLink(event,()=>{closeMobile();run('page_select',{pageId:parent.pageId});}));const divider=document.createElement('span');divider.textContent='/';divider.setAttribute('aria-hidden','true');segment.append(link,divider);trail.append(segment);}trail.hidden=!ancestors.length;breadcrumbSignature=signature;}
  }
  async function createPage(parentId=''){closeMobile();menu.open=false;if(await run('page_add',{parentId})){const title=domId('page-title');title.focus();title.select();}}
  function openMove(pageId:string){
    movingPageId=pageId;const all=store.listPages(),byId=new Map(all.map(p=>[p.pageId,p])),invalid=new Set([pageId]);
    for(const page of all)if(invalid.has(page.parentId))invalid.add(page.pageId);
    const moving=byId.get(pageId)!;let height=1;for(const page of all)if(invalid.has(page.pageId))height=Math.max(height,page.depth-moving.depth+1);
    const target=domId('page-parent-target');target.replaceChildren();const root=document.createElement('option');root.value='';root.textContent='Notebook root';target.append(root);
    for(const page of all)if(!invalid.has(page.pageId)&&page.depth+1+height<=MAX_PAGE_LEVELS){const option=document.createElement('option');option.value=page.pageId;option.textContent=`${'  '.repeat(Math.min(page.depth,6))}${page.title||'Untitled page'}${page.parentId?` — ${byId.get(page.parentId)!.title||'Untitled page'}`:''}`;target.append(option);}
    target.value=byId.get(pageId)!.parentId;domId('page-parent-dialog').showModal();target.focus();
  }
  for(const el of document.querySelectorAll<HTMLElement>('[data-icon]'))el.prepend(icon(el.dataset.icon!));
  toggle.addEventListener('click',()=>safeView({sidebarOpen:!getView().sidebarOpen}));
  domId('sidebar-close').addEventListener('click',()=>safeView({sidebarOpen:false}));
  domId('sidebar-new-page').addEventListener('click',()=>createPage());
  domId('page-new-child').addEventListener('click',()=>createPage(store.getActivePageId()));
  domId('page-parent-apply').addEventListener('click',()=>{domId('page-parent-dialog').close();const parentId=domId('page-parent-target').value;if(parentId!==store.listPages().find(p=>p.pageId===movingPageId)?.parentId)run('page_move',{pageId:movingPageId!,parentId});});
  domId('sidebar-search').addEventListener('click',()=>{closeMobile();openPalette();});
  widthToggle.addEventListener('click',()=>safeView({contentWidth:view.get().contentWidth==='wide'?'reading':'wide'}));
  sidebar.addEventListener('close',()=>{if(sidebar.open)return;if(media.matches)drawerOpen=false;else if(view.get().sidebarOpen){try{view.set({sidebarOpen:false});}catch(error){onError(errorOf(error));}}sync();if(document.activeElement===document.body)toggle.focus({preventScroll:true});});
  sidebar.addEventListener('keydown',event=>{
    if(!media.matches||!sidebar.open||(event as KeyboardEvent).key!=='Tab')return;
    const buttons=[...sidebar.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]')],first=buttons[0],last=buttons.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  });
  media.addEventListener('change',()=>{drawerOpen=false;if(sidebar.open)sidebar.close();sync();});
  window.addEventListener('storage',event=>{if((event.key===VIEW_KEY||event.key===null)&&event.storageArea===localStorage){onThemeChange(view.refreshTheme());}});
  document.addEventListener('click',event=>{if(!menu.contains(event.target as Node))menu.open=false;});
  document.addEventListener('keydown',event=>{if((event as KeyboardEvent).key==='Escape')menu.open=false;});
  for(const dialog of document.querySelectorAll<HTMLDialogElement>('.action-menu'))dialog.addEventListener('keydown',event=>{
    if(!['ArrowUp','ArrowDown','Home','End'].includes((event as KeyboardEvent).key))return;event.preventDefault();const buttons=[...dialog.querySelectorAll<HTMLButtonElement>('.action-item:not(:disabled)')],i=buttons.indexOf(document.activeElement as HTMLButtonElement),next=(event as KeyboardEvent).key==='Home'?0:(event as KeyboardEvent).key==='End'?buttons.length-1:(i+((event as KeyboardEvent).key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();
  });
  store.subscribe(render);render(store.getRenderState());sync();return {getView,setView,closeMobile};
}
