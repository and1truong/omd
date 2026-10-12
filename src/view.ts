import type {View,PartialView,StorageLike,Theme} from './types.js';
export const VIEW_KEY='omd.view.v1';
const defaults:View={sidebarOpen:true,contentWidth:'reading',collapsedPageIds:[],theme:'system'};
export function validateView(patch:unknown):asserts patch is PartialView {
  if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('View preferences must be an object.');
  for(const [key,value] of Object.entries(patch)) {
    if(key==='sidebarOpen'){if(typeof value!=='boolean')throw new Error('sidebarOpen must be true or false.');}
    else if(key==='contentWidth'){if(!['reading','wide'].includes(value as string))throw new Error('contentWidth must be reading or wide.');}
    else if(key==='collapsedPageIds'){if(!Array.isArray(value)||value.some(id=>typeof id!=='string'||!id)||new Set(value).size!==value.length)throw new Error('collapsedPageIds must contain unique page IDs.');}
    else if(key==='theme'){if(!['system','light','dark'].includes(value as string))throw new Error('theme must be system, light or dark.');}
    else throw new Error(`Unknown view preference: ${key}.`);
  }
}
export function createView(storage:StorageLike,legacyTheme:Theme='system') {
  let state={...defaults};
  function read(){const raw=storage.getItem(VIEW_KEY);if(!raw)return {};const saved:unknown=JSON.parse(raw);validateView(saved);return saved;}
  try {
    const saved=read();state={...state,...saved};
    if(saved.theme===undefined){state.theme=['system','light','dark'].includes(legacyTheme)?legacyTheme:'system';try{storage.setItem(VIEW_KEY,JSON.stringify(state));}catch{/* Keep the migrated preference in memory if storage is unavailable. */}}
  }catch{/* Bad UI preferences never prevent notebook recovery. */}
  return {
    get:()=>structuredClone(state),
    refreshTheme(){try{state={...state,theme:read().theme??'system'};}catch{state={...state,theme:'system'};}return state.theme;},
    set(patch:PartialView){validateView(patch);let saved:PartialView={};try{saved=read();}catch{/* A valid write can repair corrupt preferences. */}const next={...state,...saved,...structuredClone(patch)};try{storage.setItem(VIEW_KEY,JSON.stringify(next));}catch{throw new Error('Could not save view preferences.');}state=next;return structuredClone(state);}
  };
}
