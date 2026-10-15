/** Commands that can remove the entity receiving an unfinished editor draft. */
export const removesContent=(name:string)=>name==='import_notebook'||name==='convert_block'||name==='undo'||name==='redo'||name.startsWith('remove_')||name.endsWith('_remove');
