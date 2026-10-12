import React from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, restore } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
export function mountCanvas(host,scene,theme,onChange,onAPI) {
  const root=createRoot(host);
  function draw(data=scene,nextTheme=theme) {
    root.render(React.createElement(Excalidraw,{ initialData:{...restore(data,null,null),files:data.files,scrollToContent:false},theme:nextTheme,
      excalidrawAPI:onAPI,onChange,handleKeyboardGlobally:false,autoFocus:false,validateEmbeddable:()=>false,
      UIOptions:{canvasActions:{toggleTheme:false}},aiEnabled:false }));
  }
  draw(); return { draw,unmount:()=>root.unmount(),restore:data=>restore(data,null,null) };
}
