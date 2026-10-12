export const emptyScene = () => ({ elements: [], appState: { viewBackgroundColor: '#fffefb' }, files: {} });
const kinds = ['rectangle','diamond','ellipse','text','line','arrow','freedraw','image','frame','magicframe','embeddable'];
const obj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const assert = (ok,msg) => { if (!ok) throw new Error(msg); };
export function validateScene(scene) {
  assert(obj(scene) && Object.keys(scene).every(key => ['elements','appState','files'].includes(key)), 'Expected Excalidraw elements, appState and files.');
  assert(Array.isArray(scene.elements) && obj(scene.appState) && obj(scene.files), 'Invalid Excalidraw scene.');
  const ids = new Set();
  for (const e of scene.elements) {
    assert(obj(e) && typeof e.id === 'string' && e.id && !ids.has(e.id) && kinds.includes(e.type), 'Invalid or duplicate Excalidraw element.'); ids.add(e.id);
    for (const key of ['x','y','width','height']) assert(Number.isFinite(e[key]), `Excalidraw ${key} must be finite.`);
  }
  for (const [id,file] of Object.entries(scene.files)) assert(obj(file) && file.id === id && typeof file.dataURL === 'string' && /^data:image\/(png|jpeg|webp|gif|svg\+xml);/.test(file.dataURL), 'Invalid Excalidraw image file.');
  function json(value) {
    if (typeof value === 'number') assert(Number.isFinite(value), 'Scene numbers must be finite.');
    if (Array.isArray(value)) for (const item of value) json(item);
    else if (obj(value)) for (const [key,item] of Object.entries(value)) { assert(!['__proto__','constructor','prototype'].includes(key), 'Unsafe scene property.'); json(item); }
    else assert(value === null || ['string','boolean','number'].includes(typeof value), 'Scene must be JSON data.');
  }
  json(scene); return scene;
}
export function parseScene(raw) {
  let value; try { value=JSON.parse(raw); } catch { throw new Error('Excalidraw scene must be valid JSON.'); }
  return validateScene({ elements:value.elements, appState:value.appState ?? {}, files:value.files ?? {} });
}
export function mermaidSource(source) {
  const fence = source.match(/```mermaid\s*\n([\s\S]*?)```/i); return (fence ? fence[1] : source).trim();
}
