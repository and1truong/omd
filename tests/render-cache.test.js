import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderCache,reconcile,renderData,revealActions} from '../src/render-cache.js';
// Minimal identity-preserving DOM for lifecycle tests. Native browser assertions
// separately cover inputs, React teardown and real diagram engines.
class Node {
  constructor(id='') {this.id=id;this.childNodes=[];this.parentNode=null;}
  get firstChild(){return this.childNodes[0]??null;}
  get nextSibling(){return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this)+1]??null;}
  insertBefore(node,cursor){node.parentNode?.removeChild(node);const i=cursor?this.childNodes.indexOf(cursor):this.childNodes.length;this.childNodes.splice(i,0,node);node.parentNode=this;}
  removeChild(node){this.childNodes.splice(this.childNodes.indexOf(node),1);node.parentNode=null;}
}
const text=(id,value=id)=>({id,type:'text',text:value});
const tabs=()=>({id:'tabs',type:'tabs',orientation:'horizontal',activeTabId:'one',tabs:[{id:'one',title:'One',blocks:[text('a'),text('b')]},{id:'two',title:'Two',blocks:[text('hidden')]}]});
function setup(){
  const created=[];let cache;
  cache=createRenderCache({
    makeBlock(b){created.push(b.id);const node=new Node(b.id);if(b.type==='tabs')reconcile(node,[cache.childList(b.activeTabId)]);if(b.type==='toggle'&&b.open)reconcile(node,[cache.childList(b.id)]);return node;},
    makeList(data,id,nodes){const node=new Node(id),children=[];for(const child of nodes)children.push(new Node('slot'),child);children.push(new Node('slot'),new Node('add'));return {node,children};}
  });
  const render=(blocks,page='page')=>{cache.begin(page);const node=cache.list(blocks,'page');cache.end();return node;};
  return {render,created,cache};
}
test('only changed visible blocks rebuild; descendants and list additions preserve their parent and siblings',()=>{
  const {render,created}=setup(),group=tabs(),page=[group,text('outside')];const root=render(page),parent=root.childNodes[1],list=parent.firstChild,a=list.childNodes[1],b=list.childNodes[3],outside=root.childNodes[3];
  created.length=0;group.tabs[0].blocks[0].text='Changed';render(page);
  assert.deepEqual(created,['a']);assert.equal(root.childNodes[1],parent);assert.equal(parent.firstChild,list);assert.equal(list.childNodes[3],b);assert.equal(root.childNodes[3],outside);
  assert.notEqual(list.childNodes[1],a);const changed=list.childNodes[1];
  group.tabs[0].blocks.push(text('c'));created.length=0;render(page);
  assert.equal(parent.firstChild,list);assert.equal(list.childNodes[1],changed);assert.deepEqual(created,['b','c']); // b's last-item control changes
});
test('inactive tabs never mount; switching, collapsing and changing pages discard caches',()=>{
  const {render,created}=setup(),group=tabs();let root=render([group]);const old=root.childNodes[1].firstChild.childNodes[1];assert.ok(!created.includes('hidden'));
  group.tabs[1].blocks[0].text='Changed while hidden';created.length=0;render([group]);assert.deepEqual(created,[]);
  group.activeTabId='two';render([group]);assert.ok(created.includes('hidden'));group.activeTabId='one';root=render([group]);assert.notEqual(root.childNodes[1].firstChild.childNodes[1],old);
  const toggle={id:'toggle',type:'toggle',open:false,blocks:[text('collapsed')]};created.length=0;render([toggle]);assert.ok(!created.includes('collapsed'));toggle.open=true;root=render([toggle]);const mounted=root.childNodes[1].firstChild.childNodes[1];toggle.open=false;render([toggle]);toggle.open=true;root=render([toggle]);assert.notEqual(root.childNodes[1].firstChild.childNodes[1],mounted);
  render([toggle],'other');assert.notEqual(root.childNodes[1],render([toggle]).childNodes[1]);
});
test('quiet local input updates do not cause a deferred rebuild; external updates still do',()=>{
  const {render,cache,created}=setup(),data=[text('a')],root=render(data),node=root.childNodes[1];data[0].text='Typed';cache.accept('a',data[0]);created.length=0;render(data);assert.deepEqual(created,[]);assert.equal(root.childNodes[1],node);
  data[0].text='Agent edit';render(data);assert.deepEqual(created,['a']);assert.notEqual(root.childNodes[1],node);
});
test('container handlers retain metadata without hidden or visible descendant scene data',()=>{
  const group=tabs(),data=renderData(group);assert.deepEqual(data.tabs.map(t=>t.blocks),[[],[]]);assert.equal(group.tabs[0].blocks.length,2);
  assert.deepEqual(renderData({type:'accordion',items:[{id:'x',open:true,blocks:[text('large')]}]}).items[0].blocks,[]);
});
test('full-page canvas reveals inactive tab and closed section ancestors in order',()=>{
  const group=tabs();group.tabs[1].blocks=[{id:'closed',type:'toggle',open:false,blocks:[{id:'sections',type:'accordion',items:[{id:'section',open:false,blocks:[{id:'canvas',type:'excalidraw'}]}]}]}];
  assert.deepEqual(revealActions([group],'canvas'),[['tab_select',{blockId:'tabs',tabId:'two'}],['update_block',{blockId:'closed',patch:{open:true}}],['accordion_update',{blockId:'sections',itemId:'section',patch:{open:true}}]]);
  assert.deepEqual(revealActions([group],'a'),[]);assert.equal(revealActions([group],'missing'),null);
});
