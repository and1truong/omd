const paths={
  notebook:['M4 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4V3Z','M8 3v18','M2 7h4M2 12h4M2 17h4'],
  page:['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z','M14 2v6h6'],
  panel:['M3 4h18v16H3Z','M9 4v16'],search:['M21 21l-5-5','M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'],
  plus:['M12 5v14M5 12h14'],close:['M6 6l12 12M18 6 6 18'],up:['m5 14 7-7 7 7'],down:['m5 10 7 7 7-7'],
  left:['m15 5-7 7 7 7'],trash:['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'],
  undo:['M3 10h10a7 7 0 0 1 0 14','m7 6-4 4 4 4'],redo:['M21 10H11a7 7 0 0 0 0 14','m17 6 4 4-4 4'],
  settings:['M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8','M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z'],
  download:['M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5'],upload:['M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5'],
  width:['M3 5v14M21 5v14M5 12h14m-11-3-3 3 3 3m8-6 3 3-3 3'],fullscreen:['M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5'],
  text:['M4 5h16M12 5v15M8 20h8'],heading:['M5 4v16M19 4v16M5 12h14'],checklist:['m3 6 2 2 4-4M12 6h9m-18 8 2 2 4-4M12 14h9'],
  tabs:['M3 5h6v4h12v12H3Z','M9 5h6v4M15 5h6v4'],vertical:['M3 3h18v18H3Z','M9 3v18M3 9h6M3 15h6'],
  toggle:['m8 5 7 7-7 7'],accordion:['M4 4h16v16H4Z','M4 10h16M4 15h16'],reminder:['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4'],
  kanban:['M3 4h18v16H3Z','M9 4v16M15 4v16M5 8h2M11 8h2M17 8h2M5 12h2M11 12h2'],divider:['M3 12h18'],
  mermaid:['M8 3h8v6H8Z','M3 15h6v6H3ZM15 15h6v6h-6Z','M12 9v3M6 15v-3h12v3'],excalidraw:['m4 16-1 5 5-1L20 8l-5-5Z','m13 5 6 6'],
};
export function icon(name) {
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','18');svg.setAttribute('height','18');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.classList.add('ui-icon');
  if(name==='more'||name==='drag')for(const [cx,cy] of name==='more'?[[5,12],[12,12],[19,12]]:[[8,5],[16,5],[8,12],[16,12],[8,19],[16,19]]){const c=document.createElementNS(ns,'circle');c.setAttribute('cx',cx);c.setAttribute('cy',cy);c.setAttribute('r','1.3');c.setAttribute('fill','currentColor');c.setAttribute('stroke','none');svg.append(c);}
  else for(const d of paths[name]??paths.page){const p=document.createElementNS(ns,'path');p.setAttribute('d',d);svg.append(p);}
  return svg;
}
export const labelIcon={'↑':'up','↓':'down','×':'close','⠿':'drag','▾':'down','▸':'toggle','↶':'undo','↷':'redo','…':'more'};
