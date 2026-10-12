import mermaid from 'mermaid';
let chain=Promise.resolve();
export function renderDiagram(id,source,dark) {
  const next=chain.then(async()=>{
    mermaid.initialize({ startOnLoad:false, securityLevel:'strict', theme:dark?'dark':'neutral', suppressErrorRendering:true,
      maxTextSize:Number.MAX_SAFE_INTEGER, maxEdges:Number.MAX_SAFE_INTEGER, htmlLabels:false,
      secure:['secure','securityLevel','startOnLoad','suppressErrorRendering','maxTextSize','maxEdges','htmlLabels','theme','themeCSS'] });
    return mermaid.render(id,source);
  }); chain=next.catch(()=>{}); return next;
}
