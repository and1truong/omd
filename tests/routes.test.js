import test from 'node:test';
import assert from 'node:assert/strict';
import {appBase,pagePath,routePageId,followPageLink} from '../src/routes.ts';

test('page routes round-trip stable IDs including URL delimiters and dot segments',()=>{
  for(const id of ['normal','a/b','a:b','quote"\\','Tiếng Việt','?q#hash','%2F','\0','.','..','~id','~.','~u','~ud800','~uD800','~~u','🚀','~ud800\n','line\nbreak']){
    const path=pagePath(id);assert.equal(routePageId(path,appBase.pathname),id);
    assert.equal(path,`${appBase.pathname}page/${encodeURIComponent(id==='.'||id==='..'||id.startsWith('~')?'~'+id:id)}`);
    assert.equal(new URL(path,'https://example.test').pathname,path);
  }
  assert.equal(routePageId('/omd/page/abc','/omd/'),'abc');
  assert.equal(routePageId('/page/abc','/'),'abc');
  assert.equal(routePageId('/omd/','/omd/'),undefined);
  for(const path of ['/omd/page/','/omd/page','/omd/page/%ZZ','/omd/page/a/b','/other/page/a'])assert.equal(routePageId(path,'/omd/'),null);
});
test('page routes losslessly preserve lone UTF-16 units without colliding with ordinary IDs',()=>{
  const ids=['lone-\uD800','lone-\uDC00','\uD800\uD800','\uDC00\uD800','mix-\uD800🚀/\0%~\uDFFF','~u\uD800'];
  for(let unit=0xd800;unit<=0xdfff;unit++)ids.push(String.fromCharCode(unit));
  for(const id of ids){
    const segment=pagePath(id).split('/').at(-1);
    assert.match(segment,/^~u(?:[0-9a-f]{4})+$/);
    for(const base of ['/','/omd/']){
      const path=`${base}page/${segment}`;
      assert.equal(new URL(path,'https://example.test').pathname,path);
      assert.equal(routePageId(path,base),id);
    }
  }
  assert.equal(pagePath('lone-\uD800'),`${appBase.pathname}page/~u006c006f006e0065002dd800`);
  assert.equal(routePageId('/page/~uD800','/'),'\uD800');
  for(const segment of ['~u','~ud80','~ud8000','~ugggg','~ud800%2F','~ud800/0000','~ud800%0A','~ud800%0D%0A','~ud800%00'])assert.equal(routePageId(`/page/${segment}`,'/'),null);
});
test('only plain primary link clicks are intercepted; native new-tab gestures survive',()=>{
  let navigations=0,prevented=0;
  const plain={button:0,preventDefault(){prevented++;}};
  for(const patch of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{defaultPrevented:true}])followPageLink({...plain,...patch},()=>navigations++);
  assert.equal(navigations,0);assert.equal(prevented,0);
  followPageLink(plain,()=>navigations++);assert.equal(navigations,1);assert.equal(prevented,1);
});
