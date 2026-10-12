import type {NotebookStore,Block,Scene} from '../src/types.js';
async function commandContracts(store:NotebookStore) {
  const item=await store.dispatch('checklist_add',{blockId:'list',text:'task'});const id:string=item.itemId;
  await store.dispatch('checklist_add',{blockId:'list',parentId:id,text:'child'});
  await store.dispatch('checklist_move',{blockId:'list',itemId:id,parentId:'',index:0});
  // @ts-expect-error Parent IDs are strings.
  await store.dispatch('checklist_add',{blockId:'list',parentId:3});
  const card=await store.dispatch('card_add',{blockId:'board',columnId:'column'});const cardId:string=card.cardId;
  // @ts-expect-error A checklist item's done flag is boolean.
  await store.dispatch('checklist_update',{blockId:'list',itemId:id,patch:{done:'yes'}});
  // @ts-expect-error A card requires a target column.
  await store.dispatch('card_add',{blockId:'board'});
  // @ts-expect-error Commands cannot invent action names.
  await store.dispatch('replace_everything',{});
  // @ts-expect-error Creation results expose only their command's IDs.
  const wrong:string=item.cardId;
  // @ts-expect-error The internal published page view is immutable.
  store.getRenderState().title='mutated';
  const block=undefined as unknown as Block;
  if(block.type==='checklist'){const done:boolean=block.items[0].done;void done;}
  if(block.type==='excalidraw'){const scene:Scene=block.scene;void scene;}
  // @ts-expect-error A divider has no editable text field.
  if(block.type==='divider')void block.text;
  void cardId;void wrong;
}
void commandContracts;
