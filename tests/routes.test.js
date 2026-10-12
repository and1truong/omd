import test from 'node:test';
import assert from 'node:assert/strict';
import {appBase,pagePath,routePageId,followPageLink} from '../src/routes.ts';

test('page routes round-trip stable IDs including URL delimiters and dot segments',()=>{
  for(const id of ['normal','a/b','a:b','quote"\\','Tiếng Việt','?q#hash','%2F','.','..','~id','~.']){
    const path=pagePath(id);assert.equal(routePageId(path,appBase.pathname),id);
    assert.equal(new URL(path,'https://example.test').pathname,path);
  }
  assert.equal(routePageId('/omd/page/abc','/omd/'),'abc');
  assert.equal(routePageId('/page/abc','/'),'abc');
  assert.equal(routePageId('/omd/','/omd/'),undefined);
  for(const path of ['/omd/page/','/omd/page','/omd/page/%ZZ','/omd/page/a/b','/other/page/a'])assert.equal(routePageId(path,'/omd/'),null);
});
test('only plain primary link clicks are intercepted; native new-tab gestures survive',()=>{
  let navigations=0,prevented=0;
  const plain={button:0,preventDefault(){prevented++;}};
  for(const patch of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{defaultPrevented:true}])followPageLink({...plain,...patch},()=>navigations++);
  assert.equal(navigations,0);assert.equal(prevented,0);
  followPageLink(plain,()=>navigations++);assert.equal(navigations,1);assert.equal(prevented,1);
});
