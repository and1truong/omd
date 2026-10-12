import React from 'react';
import {createRoot} from 'react-dom/client';
import {Excalidraw,restore} from '@excalidraw/excalidraw';
import type {ExcalidrawProps,ExcalidrawImperativeAPI,BinaryFiles} from '@excalidraw/excalidraw/types';
import type {Scene,ResolvedTheme} from './types.js';
import '@excalidraw/excalidraw/index.css';
export type CanvasAPI=ExcalidrawImperativeAPI;
export type CanvasChange=NonNullable<ExcalidrawProps['onChange']>;
export function mountCanvas(host:HTMLElement,scene:Scene,theme:ResolvedTheme,onChange:CanvasChange,onAPI:(api:CanvasAPI)=>void) {
  const root=createRoot(host);
  // Portable scenes are runtime-validated; upstream restore fills missing editor-specific fields.
  function restoreScene(data:Scene){return restore(data as unknown as Parameters<typeof restore>[0],null,null);}
  function draw(data=scene,nextTheme=theme){root.render(React.createElement(Excalidraw,{initialData:{...restoreScene(data),files:data.files as unknown as BinaryFiles,scrollToContent:false},theme:nextTheme,excalidrawAPI:onAPI,onChange,handleKeyboardGlobally:false,autoFocus:false,validateEmbeddable:()=>false,UIOptions:{canvasActions:{toggleTheme:false}},aiEnabled:false}));}
  draw();return {draw,unmount:()=>root.unmount(),restore:restoreScene};
}
