export const VIEW_KEY='omd.view.v1';
const defaults={sidebarOpen:true,contentWidth:'reading'};
export function validateView(patch) {
  if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('View preferences must be an object.');
  for(const [key,value] of Object.entries(patch)) {
    if(key==='sidebarOpen'){if(typeof value!=='boolean')throw new Error('sidebarOpen must be true or false.');}
    else if(key==='contentWidth'){if(!['reading','wide'].includes(value))throw new Error('contentWidth must be reading or wide.');}
    else throw new Error(`Unknown view preference: ${key}.`);
  }
}
export function createView(storage) {
  let state={...defaults};
  try {const raw=storage.getItem(VIEW_KEY);if(raw){const saved=JSON.parse(raw);validateView(saved);state={...state,...saved};}}catch{/* Bad UI preferences never prevent notebook recovery. */}
  return {
    get:()=>({...state}),
    set(patch){validateView(patch);const next={...state,...patch};try{storage.setItem(VIEW_KEY,JSON.stringify(next));}catch{throw new Error('Could not save view preferences.');}state=next;return {...state};}
  };
}
