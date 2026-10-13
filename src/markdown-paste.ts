import type {Editor} from './text-editor-engine.js';
import type {JSONContent} from '@tiptap/core';

function hasFormatting(node:JSONContent,markdownLinks:boolean):boolean {
  return !!node.marks?.some(mark=>mark.type!=='link'||markdownLinks)||!!node.type&&!['doc','paragraph','text'].includes(node.type)||(node.content??[]).some(child=>hasFormatting(child,markdownLinks));
}

/** Raw Markdown can carry an HTML wrapper when copied from a browser or code editor. */
export function pasteMarkdown(editor:Editor,event:ClipboardEvent):boolean {
  const clipboard=event.clipboardData,text=clipboard?.getData('text/plain');
  if(!text||editor.state.selection.$from.parent.type.name==='codeBlock')return false;
  const html=clipboard?.getData('text/html');
  if(html){
    // A copy from a ProseMirror editor already describes the intended rich document.
    const template=document.createElement('template');template.innerHTML=html;
    if(template.content.querySelector('[data-pm-slice]'))return false;
  }
  const parsed=editor.markdown?.parse(text);if(!parsed)return false;
  if(html){
    const markdownLinks=/\]\s*(?:\(|\[|:)|<[^>\s]+>/.test(text);
    const escapes=/\\[\\`*{}\[\]()>#+.!_-]/.test(text);
    if(!hasFormatting(parsed,markdownLinks)&&!escapes)return false;
  }
  const blocks=parsed.content??[];
  // Inline Markdown replaces the selection without splitting its surrounding paragraph.
  const content=blocks.length===1&&blocks[0].type==='paragraph'?blocks[0].content??[]:blocks;
  return editor.commands.insertContent(content,{contentType:'json'});
}
