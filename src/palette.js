import {MAX_PAGE_LEVELS} from './notebook.js';
export function setupPalette(store, { onError, beforeOpen = () => {}, beforeNavigate = () => {} } = {}) {
  const dialog = document.getElementById('page-palette'), search = document.getElementById('page-search'), list = document.getElementById('palette-pages'), create = document.getElementById('palette-create'),parentSelect=document.getElementById('page-create-parent');
  let selected = 0, matches = [];
  const run = (action, args) => { try { return store.dispatch(action, args); } catch (error) { onError?.(error); return null; } };
  const select = pageId => { beforeNavigate(); dialog.close(); run('page_select', { pageId }); };
  function render() {
    const pages = store.listPages(), query = search.value.toLocaleLowerCase().trim();
    const byId=new Map(pages.map(p=>[p.pageId,p])),chosen=parentSelect.value;
    parentSelect.replaceChildren();const root=document.createElement('option');root.value='';root.textContent='Notebook root';parentSelect.append(root);
    for(const page of pages)if(page.depth+1<MAX_PAGE_LEVELS){const option=document.createElement('option');option.value=page.pageId;option.textContent=`${'  '.repeat(Math.min(page.depth,6))}${page.title||'Untitled page'}${page.parentId?` — ${byId.get(page.parentId).title||'Untitled page'}`:''}`;parentSelect.append(option);}parentSelect.value=byId.has(chosen)&&byId.get(chosen).depth+1<MAX_PAGE_LEVELS?chosen:'';
    matches = pages.filter(p => `${p.title} ${p.subtitle} ${byId.get(p.parentId)?.title??''}`.toLocaleLowerCase().includes(query));
    selected = Math.min(selected, Math.max(0, matches.length - 1)); list.replaceChildren();
    matches.forEach((page, i) => {
      const row = document.createElement('div'); row.className = 'palette-page';
      const pick = document.createElement('button'); pick.className = `palette-pick ${i === selected ? 'highlighted' : ''}`;
      pick.type = 'button'; pick.setAttribute('role','option'); pick.setAttribute('aria-selected', String(i === selected)); pick.id = `palette-${page.pageId}`; pick.textContent = `${page.title || 'Untitled page'}${page.active ? ' · current' : ''}`; pick.addEventListener('click', () => select(page.pageId));
      if(page.parentId){const path=document.createElement('small');path.className='palette-page-path';path.textContent=`Under ${byId.get(page.parentId).title||'Untitled page'}`;pick.append(path);}
      row.append(pick); const controls = document.createElement('div'); controls.className = 'palette-order';
      for (const [label, name, index] of [['↑','up',page.index - 1],['↓','down',page.index + 1]]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.className = 'icon-button'; button.setAttribute('aria-label', `Move ${page.title || 'page'} ${name}`); button.disabled = index < 0 || index >= page.siblingCount;
        button.addEventListener('click', () => { run('page_move',{ pageId:page.pageId,index }); render(); }); controls.append(button);
      }
      row.append(controls); list.append(row);
    });
    if (!matches.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'No matching pages. Start a new one below.'; list.append(empty); }
    if (matches[selected]) search.setAttribute('aria-activedescendant',`palette-${matches[selected].pageId}`); else search.removeAttribute('aria-activedescendant');
    create.textContent = search.value.trim() ? `+ Create “${search.value.trim()}”` : '+ Create a new page';
  }
  function open() { beforeOpen();search.value = '';parentSelect.value=''; selected = 0; render(); if (!dialog.open) dialog.showModal(); search.focus(); }
  create.addEventListener('click', () => { beforeNavigate(); if (run('page_add',{ title:search.value.trim() || 'Untitled page',parentId:parentSelect.value })) dialog.close(); });
  search.addEventListener('input', () => { selected = 0; render(); });
  search.addEventListener('keydown', e => {
    if (e.isComposing) return;
    if (['ArrowUp','ArrowDown'].includes(e.key)) { e.preventDefault(); selected = matches.length ? (selected + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length : 0; render(); }
    if (e.key === 'Enter') { e.preventDefault(); if (matches[selected]) select(matches[selected].pageId); else create.click(); }
  });
  document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopPropagation(); if (dialog.open) dialog.close(); else open(); } }, true);
  document.getElementById('pages-button').addEventListener('click', open);
  function update() { document.getElementById('page-count').textContent = `${store.listPages().length} page${store.listPages().length === 1 ? '' : 's'}`; if (dialog.open) render(); }
  store.subscribe(update); update(); return { open, close: () => dialog.close() };
}
