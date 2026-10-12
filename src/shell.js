import {icon} from './icons.js';
import {createView,validateView} from './view.js';
import {reconcile} from './render-cache.js';

export function showMenu(id,title,actions,anchor) {
  const dialog=document.getElementById(id),heading=dialog.querySelector('h2'),list=dialog.querySelector('.action-list');heading.textContent=title;list.replaceChildren();
  for(const action of actions){const b=document.createElement('button');b.type='button';b.className=`action-item${action.danger?' danger':''}`;b.disabled=!!action.disabled;b.append(icon(action.icon));const label=document.createElement('span');label.textContent=action.label;b.append(label);b.addEventListener('click',()=>{dialog.close();action.run();});list.append(b);}
  dialog.showModal();const r=anchor.getBoundingClientRect(),bounds=dialog.getBoundingClientRect();dialog.style.left=`${Math.max(8,Math.min(r.left,innerWidth-bounds.width-8))}px`;dialog.style.top=`${Math.max(8,Math.min(r.bottom+6,innerHeight-bounds.height-8))}px`;list.querySelector('button:not(:disabled)')?.focus();
}
export function setupShell(store,{beforeNavigate,openPalette,onError}) {
  const sidebar=document.getElementById('sidebar'),toggle=document.getElementById('sidebar-toggle'),pages=document.getElementById('sidebar-pages'),media=matchMedia('(max-width: 760px)'),view=createView(localStorage),rows=new Map();
  const menu=document.getElementById('page-menu');let drawerOpen=false;
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
    if(Object.keys(saved).length)view.set(saved);
    if(media.matches&&patch.sidebarOpen!==undefined)drawerOpen=patch.sidebarOpen;
    if(patch.sidebarOpen&&document.body.classList.contains('canvas-focused'))beforeNavigate();
    sync();return getView();
  }
  function safeView(patch){try{setView(patch);}catch(error){onError(error);}}
  function render(state){
    const focused=pages.contains(document.activeElement)?document.activeElement:null;
    const pageList=store.listPages(),ids=new Set(pageList.map(p=>p.pageId)),nodes=[];
    for(const page of pageList){
      let row=rows.get(page.pageId);
      if(!row){
        const node=document.createElement('div');node.className='sidebar-page';node.dataset.pageId=page.pageId;
        const select=document.createElement('button');select.type='button';select.className='sidebar-page-select';select.append(icon('page'));const label=document.createElement('span');select.append(label);
        select.addEventListener('click',()=>{closeMobile();run('page_select',{pageId:page.pageId});});
        const more=document.createElement('button');more.type='button';more.className='icon-button sidebar-page-more';more.append(icon('more'));
        more.addEventListener('click',()=>{
          const current=store.listPages(),p=current.find(p=>p.pageId===page.pageId);
          showMenu('page-actions-dialog',p.title||'Untitled page',[
            {label:'Move page up',icon:'up',disabled:p.index===0,run:()=>run('page_move',{pageId:p.pageId,index:p.index-1})},
            {label:'Move page down',icon:'down',disabled:p.index===current.length-1,run:()=>run('page_move',{pageId:p.pageId,index:p.index+1})},
          ],more);
        });node.append(select,more);row={node,select,label,more};rows.set(page.pageId,row);
      }
      const name=page.title||'Untitled page';if(row.label.textContent!==name)row.label.textContent=name;row.select.title=name;row.select.setAttribute('aria-label',`Switch to ${name}`);row.more.setAttribute('aria-label',`Page actions for ${name}`);
      if(page.active)row.select.setAttribute('aria-current','page');else row.select.removeAttribute('aria-current');nodes.push(row.node);
    }
    for(const id of rows.keys())if(!ids.has(id))rows.delete(id);reconcile(pages,nodes);
    if(focused?.isConnected&&document.activeElement!==focused)focused.focus({preventScroll:true});
    const heading=document.getElementById('app-page-title');if(heading.textContent!==state.title)heading.textContent=state.title||'Untitled page';heading.title=state.title||'Untitled page';
  }
  for(const el of document.querySelectorAll('[data-icon]'))el.prepend(icon(el.dataset.icon));
  toggle.addEventListener('click',()=>safeView({sidebarOpen:!getView().sidebarOpen}));
  document.getElementById('sidebar-close').addEventListener('click',()=>safeView({sidebarOpen:false}));
  document.getElementById('sidebar-new-page').addEventListener('click',()=>{closeMobile();if(run('page_add',{})){const title=document.getElementById('page-title');title.focus();title.select();}});
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
