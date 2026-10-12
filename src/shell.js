import {icon} from './icons.js';
import {createView,validateView} from './view.js';
import {reconcile} from './render-cache.js';
import {pageAncestors,MAX_PAGE_LEVELS} from './notebook.js';

export function showMenu(id,title,actions,anchor) {
  const dialog=document.getElementById(id),heading=dialog.querySelector('h2'),list=dialog.querySelector('.action-list');heading.textContent=title;list.replaceChildren();
  for(const action of actions){const b=document.createElement('button');b.type='button';b.className=`action-item${action.danger?' danger':''}`;b.disabled=!!action.disabled;b.append(icon(action.icon));const label=document.createElement('span');label.textContent=action.label;b.append(label);b.addEventListener('click',()=>{dialog.close();action.run();});list.append(b);}
  dialog.showModal();const r=anchor.getBoundingClientRect(),bounds=dialog.getBoundingClientRect();dialog.style.left=`${Math.max(8,Math.min(r.left,innerWidth-bounds.width-8))}px`;dialog.style.top=`${Math.max(8,Math.min(r.bottom+6,innerHeight-bounds.height-8))}px`;list.querySelector('button:not(:disabled)')?.focus();
}
export function setupShell(store,{beforeNavigate,openPalette,confirm,onError}) {
  const sidebar=document.getElementById('sidebar'),toggle=document.getElementById('sidebar-toggle'),pages=document.getElementById('sidebar-pages'),media=matchMedia('(max-width: 760px)'),view=createView(localStorage),rows=new Map();
  const menu=document.getElementById('page-menu');let drawerOpen=false,lastActivePath=null,movingPageId=null,breadcrumbSignature='';
  function run(name,input){try{beforeNavigate();return store.dispatch(name,input);}catch(error){onError(error);return null;}}
  function closeMobile(){if(media.matches){drawerOpen=false;if(sidebar.open)sidebar.close();sync();}}
  function sync(){
    const state=view.get(),open=media.matches?drawerOpen:state.sidebarOpen;
    document.body.classList.toggle('sidebar-open',!media.matches&&open);document.body.dataset.contentWidth=state.contentWidth;document.getElementById('wide-page').checked=state.contentWidth==='wide';toggle.setAttribute('aria-expanded',String(open));
    if(sidebar.open!==open){if(open){if(media.matches)sidebar.showModal();else{const active=document.activeElement;sidebar.show();active?.focus({preventScroll:true});}}else sidebar.close();}
    window.dispatchEvent(new Event('resize'));
  }
  function getView(){return {...view.get(),sidebarOpen:!document.body.classList.contains('canvas-focused')&&sidebar.open};}
  function setView(patch){
    validateView(patch);const saved={...patch};if(media.matches){drawerOpen=sidebar.open;delete saved.sidebarOpen;}
    if(patch.collapsedPageIds){const ids=new Set(store.listPages().map(p=>p.pageId));if(patch.collapsedPageIds.some(id=>!ids.has(id)))throw new Error('Collapsed page not found.');}
    if(Object.keys(saved).length)view.set(saved);
    if(media.matches&&patch.sidebarOpen!==undefined)drawerOpen=patch.sidebarOpen;
    if(patch.sidebarOpen&&document.body.classList.contains('canvas-focused'))beforeNavigate();
    sync();if(patch.collapsedPageIds)render(store.getState());return getView();
  }
  function safeView(patch){try{setView(patch);}catch(error){onError(error);}}
  function render(state,{actionName}={}){
    const focused=pages.contains(document.activeElement)?document.activeElement:null;
    const pageList=store.listPages(),byId=new Map(pageList.map(p=>[p.pageId,p])),ancestors=pageAncestors(pageList,state.id),activePath=JSON.stringify([...ancestors.map(p=>p.pageId),state.id]);
    const savedCollapsed=view.get().collapsedPageIds,existingCollapsed=savedCollapsed.filter(id=>byId.has(id));if(existingCollapsed.length!==savedCollapsed.length)try{view.set({collapsedPageIds:existingCollapsed});}catch(error){onError(error);}
    if(actionName==='page_select'||(lastActivePath!==null&&activePath!==lastActivePath)){const ids=new Set(ancestors.map(p=>p.pageId)),collapsed=view.get().collapsedPageIds,next=collapsed.filter(id=>!ids.has(id));if(next.length!==collapsed.length)try{view.set({collapsedPageIds:next});}catch(error){onError(error);}}
    lastActivePath=activePath;
    const collapsed=new Set(view.get().collapsedPageIds),ids=new Set(),nodes=[];let hiddenDepth=null;
    for(const page of pageList){
      if(hiddenDepth!==null&&page.depth>hiddenDepth)continue;hiddenDepth=null;if(collapsed.has(page.pageId))hiddenDepth=page.depth;ids.add(page.pageId);
      let row=rows.get(page.pageId);
      if(!row){
        const node=document.createElement('div');node.className='sidebar-page';node.dataset.pageId=page.pageId;
        const expand=document.createElement('button');expand.type='button';expand.className='icon-button page-tree-toggle';
        expand.addEventListener('click',()=>{const ids=new Set(view.get().collapsedPageIds);if(ids.has(page.pageId))ids.delete(page.pageId);else ids.add(page.pageId);safeView({collapsedPageIds:[...ids]});});
        const select=document.createElement('button');select.type='button';select.className='sidebar-page-select';select.append(icon('page'));const label=document.createElement('span');select.append(label);
        select.addEventListener('click',()=>{closeMobile();run('page_select',{pageId:page.pageId});});
        const more=document.createElement('button');more.type='button';more.className='icon-button sidebar-page-more';more.append(icon('more'));
        more.addEventListener('click',()=>{
          const current=store.listPages(),p=current.find(p=>p.pageId===page.pageId);
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
      if(page.active)row.select.setAttribute('aria-current','page');else row.select.removeAttribute('aria-current');nodes.push(row.node);
      row.node.style.setProperty('--page-depth',Math.min(page.depth,6));row.select.setAttribute('aria-description',page.parentId?`Subpage of ${byId.get(page.parentId).title||'Untitled page'}`:'Notebook root page');
      row.expand.disabled=!page.childCount;row.expand.style.visibility=page.childCount?'visible':'hidden';
      const expanded=!collapsed.has(page.pageId);row.expand.setAttribute('aria-label',`${expanded?'Collapse':'Expand'} subpages of ${name}`);if(page.childCount)row.expand.setAttribute('aria-expanded',String(expanded));else row.expand.removeAttribute('aria-expanded');
      if(row.expand.dataset.expanded!==String(expanded)){row.expand.replaceChildren(icon(expanded?'down':'toggle'));row.expand.dataset.expanded=String(expanded);}
    }
    for(const id of rows.keys())if(!ids.has(id))rows.delete(id);reconcile(pages,nodes);
    if(focused?.isConnected&&document.activeElement!==focused)focused.focus({preventScroll:true});
    const heading=document.getElementById('app-page-title');if(heading.textContent!==state.title)heading.textContent=state.title||'Untitled page';heading.title=state.title||'Untitled page';
    document.getElementById('page-new-child').disabled=byId.get(state.id).depth+1>=MAX_PAGE_LEVELS;
    const signature=JSON.stringify(ancestors.map(p=>[p.pageId,p.title]));if(signature!==breadcrumbSignature){const trail=document.getElementById('page-ancestors');trail.replaceChildren();for(const parent of ancestors){const segment=document.createElement('span');segment.className='ancestor-segment';const link=document.createElement('button');link.textContent=parent.title||'Untitled page';link.title=link.textContent;link.setAttribute('aria-label',`Open parent page ${link.textContent}`);link.addEventListener('click',()=>{closeMobile();run('page_select',{pageId:parent.pageId});});const divider=document.createElement('span');divider.textContent='/';divider.setAttribute('aria-hidden','true');segment.append(link,divider);trail.append(segment);}trail.hidden=!ancestors.length;breadcrumbSignature=signature;}
  }
  function createPage(parentId=''){closeMobile();menu.open=false;if(run('page_add',{parentId})){const title=document.getElementById('page-title');title.focus();title.select();}}
  function openMove(pageId){
    movingPageId=pageId;const all=store.listPages(),byId=new Map(all.map(p=>[p.pageId,p])),invalid=new Set([pageId]);
    for(const page of all)if(invalid.has(page.parentId))invalid.add(page.pageId);
    const moving=byId.get(pageId);let height=1;for(const page of all)if(invalid.has(page.pageId))height=Math.max(height,page.depth-moving.depth+1);
    const target=document.getElementById('page-parent-target');target.replaceChildren();const root=document.createElement('option');root.value='';root.textContent='Notebook root';target.append(root);
    for(const page of all)if(!invalid.has(page.pageId)&&page.depth+1+height<=MAX_PAGE_LEVELS){const option=document.createElement('option');option.value=page.pageId;option.textContent=`${'  '.repeat(Math.min(page.depth,6))}${page.title||'Untitled page'}${page.parentId?` — ${byId.get(page.parentId).title||'Untitled page'}`:''}`;target.append(option);}
    target.value=byId.get(pageId).parentId;document.getElementById('page-parent-dialog').showModal();target.focus();
  }
  for(const el of document.querySelectorAll('[data-icon]'))el.prepend(icon(el.dataset.icon));
  toggle.addEventListener('click',()=>safeView({sidebarOpen:!getView().sidebarOpen}));
  document.getElementById('sidebar-close').addEventListener('click',()=>safeView({sidebarOpen:false}));
  document.getElementById('sidebar-new-page').addEventListener('click',()=>createPage());
  document.getElementById('page-new-child').addEventListener('click',()=>createPage(store.getActivePageId()));
  document.getElementById('page-parent-apply').addEventListener('click',()=>{document.getElementById('page-parent-dialog').close();run('page_move',{pageId:movingPageId,parentId:document.getElementById('page-parent-target').value});});
  document.getElementById('sidebar-search').addEventListener('click',()=>{closeMobile();openPalette();});
  document.getElementById('wide-page').addEventListener('change',event=>safeView({contentWidth:event.target.checked?'wide':'reading'}));
  sidebar.addEventListener('close',()=>{if(media.matches&&!sidebar.open){drawerOpen=false;toggle.setAttribute('aria-expanded','false');}});
  sidebar.addEventListener('keydown',event=>{
    if(!media.matches||!sidebar.open||event.key!=='Tab')return;
    const buttons=[...sidebar.querySelectorAll('button:not(:disabled)')],first=buttons[0],last=buttons.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  });
  media.addEventListener('change',()=>{drawerOpen=false;if(sidebar.open)sidebar.close();sync();});
  document.addEventListener('click',event=>{if(!menu.contains(event.target))menu.open=false;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')menu.open=false;});
  for(const dialog of document.querySelectorAll('.action-menu'))dialog.addEventListener('keydown',event=>{
    if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();const buttons=[...dialog.querySelectorAll('.action-item:not(:disabled)')],i=buttons.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();
  });
  store.subscribe(render);render(store.getState());sync();return {getView,setView,closeMobile};
}
