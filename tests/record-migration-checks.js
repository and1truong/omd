// The same checks run with fake-indexeddb and the browser's actual IndexedDB.
export async function migrationChecks({sourceRoot,extension='ts',startupVersion}) {
  const {openRepository}=await import(`${sourceRoot}repository.${extension}`);
  const {createStore}=await import(`${sourceRoot}store.${extension}`);
  const {startReminders}=await import(`${sourceRoot}reminders.${extension}`);
  const {emptyNotebook,makeBlock,STORAGE_KEY}=await import(`${sourceRoot}model.${extension}`);
  const {wrapPage,listPages}=await import(`${sourceRoot}notebook.${extension}`);
  const {bookRecords,metadataBook}=await import(`${sourceRoot}records.${extension}`);
  const check=(ok,message)=>{if(!ok)throw new Error(message);};
  const equal=(a,b,message)=>check(JSON.stringify(a)===JSON.stringify(b),message);
  const req=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const done=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
  const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),entries:()=>[...data]};};
  const name=()=>`migration-${crypto.randomUUID()}`;
  const evidence=[];
  async function snapshot(name,existing){
    const db=existing??await req(indexedDB.open(name)),names=[...db.objectStoreNames],tx=db.transaction(names),completed=done(tx),stores={};
    await Promise.all(names.map(async name=>{const store=tx.objectStore(name);const [keys,values]=await Promise.all([req(store.getAllKeys()),req(store.getAll())]);stores[name]={keyPath:store.keyPath,autoIncrement:store.autoIncrement,indexes:[...store.indexNames].map(n=>({name:n,keyPath:store.index(n).keyPath,unique:store.index(n).unique,multiEntry:store.index(n).multiEntry})),keys,values};}));
    await completed;const result={version:db.version,stores};if(!existing)db.close();return result;
  }
  function fixture(){
    const page=emptyNotebook();page.id='p:á/"一';page.title='Giữ nguyên';page.revision=17;
    const text=makeBlock('text',{text:'Markdown **nguyên bản** [link](https://example.com)'});text.id='b:/"一';
    const drawing=makeBlock('excalidraw');drawing.id='draw:/"一';drawing.scene.files.image={id:'image',dataURL:'data:image/png;base64,'+'A'.repeat(200000)};
    const tabs=makeBlock('tabs');tabs.id='tabs:"';tabs.tabs[0].id='tab:first/一';tabs.tabs[1].id='tab:second/一';tabs.activeTabId=tabs.tabs[0].id;
    const toggle=makeBlock('toggle');toggle.id='toggle:一';toggle.open=false;
    const accordion=makeBlock('accordion');accordion.id='accordion:一';accordion.items[0].id='section:/"一';accordion.items[0].open=false;accordion.items[0].blocks=[drawing];toggle.blocks=[accordion];tabs.tabs[1].blocks=[toggle];
    const reminder=makeBlock('reminder',{dueAt:'2020-01-01T00:00:00+07:00'});reminder.id='remind:\n2020-01-01T00:00:00Z:/"一';
    const rootAlias=makeBlock('text',{text:'ID page is a block, not the root container'});rootAlias.id='page';
    page.blocks=[text,tabs,reminder,rootAlias];
    const other=emptyNotebook();other.id='p:á/"二';other.blocks=[{...text,text:'Same logical block ID, another page'}];
    const book=wrapPage(page);book.pages.push(other);book.parents[other.id]=page.id;book.activePageId=other.id;book.revision=29;
    return {book,text,drawing,reminder};
  }
  async function seed(name,version,{book,drawing,reminder}={},mutate){
    const opening=indexedDB.open(name,version);opening.onupgradeneeded=()=>{
      const db=opening.result;db.createObjectStore('meta');db.createObjectStore('records',version===4?{keyPath:['pageId','kind','id']}:undefined).createIndex('pageId','pageId');db.createObjectStore('reminders',version===4?{keyPath:['pageId','id']}:undefined).createIndex('due','due');const history=db.createObjectStore('history');if(version>=3)history.createIndex('owner','owner');db.createObjectStore('delivery');
    };
    const db=await req(opening);if(!book){db.close();return;}
    const tx=db.transaction([...db.objectStoreNames],'readwrite'),completed=done(tx),records=tx.objectStore('records');
    tx.objectStore('meta').put(metadataBook(book),'book');tx.objectStore('meta').put('Do not erase extra metadata','recovery-note');
    for(const value of bookRecords(book).values()){
      if(version<3&&value.kind==='files')continue;
      const id=value.kind==='page'?'$page':`$${value.kind}:${value.id}`,key=JSON.stringify([value.pageId,id]);
      const row={key,kind:value.kind,pageId:value.pageId,data:version<3&&value.kind==='scene'?drawing.scene:value.data};if(version===4)records.put(value);else records.put(row,key);
      if(value.kind==='block'&&value.data.type==='reminder'){const reminder={pageId:value.pageId,...value.data,due:Date.parse(value.data.dueAt)};if(version===4)tx.objectStore('reminders').put(reminder);else tx.objectStore('reminders').put(reminder,key);}
    }
    tx.objectStore('history').put({owner:'legacy-owner',before:version===4?metadataBook(book):book,after:version===4?metadataBook(book):book,changes:[{key:version===4?[book.pages[0].id,'block',reminder.id]:JSON.stringify([book.pages[0].id,`$block:${reminder.id}`]),forward:[],inverse:[]}]},'legacy-undo');
    const firedAt='2020-01-02T00:00:00Z';tx.objectStore('delivery').put(firedAt,version===4?[book.pages[0].id,reminder.id,reminder.dueAt]:JSON.stringify([book.pages[0].id,`${reminder.id}:${reminder.dueAt}`]));
    // Deleted reminders still have ledger entries, and their cursor can outlast records.
    for(let i=0;i<80;i++)tx.objectStore('delivery').put(firedAt,version===4?[book.pages[0].id,`deleted:${i}`,reminder.dueAt]:JSON.stringify([book.pages[0].id,`deleted:${i}:${reminder.dueAt}`]));
    mutate?.(tx,{book,drawing,reminder});await completed;db.close();
  }
  async function rejects(fn,pattern){let error;try{await fn();}catch(e){error=e;}check(error&&pattern.test(error.message),`Expected recovery error ${pattern}, got ${error?.message??'success'}`);}
  function invalidPage(book,index,id){
    const bad=structuredClone(book);bad.pages[index].id=id;bad.activePageId=bad.pages[0].id;
    bad.parents=Object.fromEntries(bad.pages.map((page,i)=>[page.id,i?bad.pages[0].id:'']));return bad;
  }
  const invalidIds=['',null,42,{},[]];
  async function repair(dbName,before,healthy){
    const db=await req(indexedDB.open(dbName,4)),tx=db.transaction([...db.objectStoreNames],'readwrite'),completed=done(tx);
    for(const [name,saved]of Object.entries(healthy.stores)){
      const store=tx.objectStore(name),keys=new Set(saved.keys.map(key=>JSON.stringify(key)));
      for(const key of before.stores[name].keys)if(!keys.has(JSON.stringify(key)))store.delete(key);
      saved.values.forEach((value,i)=>saved.keyPath===null?store.put(value,saved.keys[i]):store.put(value));
    }
    await completed;db.close();
  }
  const nativeFixture=fixture(),healthyName=name();await seed(healthyName,4,nativeFixture);const healthy=await snapshot(healthyName);
  for(const index of [0,1])for(const id of invalidIds){
    const dbName=name(),data=storage(),bad={...nativeFixture,book:invalidPage(nativeFixture.book,index,id)};bad.book.activePageId=nativeFixture.book.pages[1-index].id;
    data.setItem(STORAGE_KEY,JSON.stringify(nativeFixture.book));for(const v of [1,2,3])data.setItem(`${STORAGE_KEY}.v${v}-backup`,`untouched v${v} backup`);const sources=data.entries();
    // Empty IDs were accepted by shipped validators; native keys can represent them coherently.
    await seed(dbName,4,id===''?bad:nativeFixture,id===''?undefined:tx=>tx.objectStore('meta').put(metadataBook(bad.book),'book'));
    const before=await snapshot(dbName),getAll=IDBIndex.prototype.getAll;let reads=0,leases=0;
    IDBIndex.prototype.getAll=function(...args){if(this.objectStore.transaction.db.name===dbName&&this.objectStore.name==='records')reads++;return getAll.apply(this,args);};
    try{
      const locks={request(){leases++;throw new Error('History lease requested before metadata validation.');}};
      await rejects(()=>createStore(data,{name:dbName,initial:emptyNotebook,locks,activePageId:bad.book.activePageId}),/metadata is invalid.*intact.*Recover.*reload.*Notebook ID/);
      check(reads===0&&leases===0,'Malformed v4 metadata reached hydration or history leases');
    }finally{IDBIndex.prototype.getAll=getAll;}
    equal(await snapshot(dbName),before,'Rejected v4 startup changed schema/index/key/value/history/ledger');equal(data.entries(),sources,'Rejected v4 startup changed recovery bytes');
    await repair(dbName,before,healthy);equal(await snapshot(dbName),healthy,'User v4 repair changed valid data or schema');
    const retry=await createStore(data,{name:dbName,initial:emptyNotebook});equal(await retry.getNotebook(),nativeFixture.book,'Same-DB v4 recovery retry failed');check(retry.listPages().length===2,'Recovered v4 hierarchy did not list');await retry.close();equal(data.entries(),sources,'V4 retry rewrote recovery sources');
  }
  evidence.push({case:'native v4 inactive root/child invalid IDs / reject before hydration and locks / exact schema+data+history+ledger+backup preservation / same-DB repair and retry',cases:2*invalidIds.length,passed:true});
  const malformedMetadata=[null,{...metadataBook(nativeFixture.book),id:''},(()=>{const book=metadataBook(nativeFixture.book);book.pages[1].id=book.pages[0].id;return book;})(),{...metadataBook(nativeFixture.book),activePageId:'missing'},(()=>{const book=metadataBook(nativeFixture.book);book.parents[book.pages[0].id]=book.pages[1].id;return book;})()];
  for(const metadata of malformedMetadata){
    const dbName=name(),data=storage();await seed(dbName,4,nativeFixture,tx=>tx.objectStore('meta').put(metadata,'book'));const before=await snapshot(dbName);
    await rejects(()=>openRepository(data,{name:dbName,initial:emptyNotebook}),/metadata is invalid.*intact.*Recover.*reload/);equal(await snapshot(dbName),before,'Malformed native metadata was initialized, repaired or changed');
  }
  evidence.push({case:'native v4 null/empty notebook ID/duplicate page ID/missing active page/cyclic hierarchy reject without writes',cases:malformedMetadata.length,passed:true});
  for(const id of ['__proto__','constructor',' ']){
    const f=fixture(),dbName=name();f.book.pages[0].id=id;f.book.parents=Object.fromEntries([[id,''],[f.book.pages[1].id,id]]);await seed(dbName,4,f);
    const valid=await createStore(storage(),{name:dbName,initial:emptyNotebook,activePageId:id});check(valid.getActivePageId()===id&&valid.residency().pageCount===2,'Valid special v4 ID changed selection/residency');equal(valid.listPages().map(row=>[row.pageId,row.depth]),[[id,0],[f.book.pages[1].id,1]],'Valid special v4 ID failed listing');equal((await valid.getNotebook()).pages,f.book.pages,'Special v4 ID changed payloads');await valid.close();
  }
  evidence.push({case:'native v4 valid special IDs / preferred tab-local selection / lazy residency / export and listing',passed:true});
  if(startupVersion===4){
    const f=fixture();f.book.activePageId=f.book.pages[0].id;const healthyName=name();await seed(healthyName,4,f);const healthy=await snapshot(healthyName),bad={...f,book:invalidPage(f.book,1,'')};
    await seed('omd.notebook.records.v1',4,bad);localStorage.setItem(STORAGE_KEY,JSON.stringify(f.book));for(const v of [1,2,3])localStorage.setItem(`${STORAGE_KEY}.v${v}-backup`,`untouched v${v} backup`);
    return {evidence,startup:f.book,v4:{before:await snapshot('omd.notebook.records.v1'),healthy,sources:Object.entries(localStorage)}};
  }
  for(const version of [1,2,3]){
    const f=fixture(),healthyName=name();await seed(healthyName,version,f);const healthy=await snapshot(healthyName);
    for(const index of [0,1])for(const id of invalidIds){
      const dbName=name(),data=storage(),bad={...f,book:invalidPage(f.book,index,id)};
      data.setItem(STORAGE_KEY,JSON.stringify(f.book));data.setItem(`${STORAGE_KEY}.v1-backup`,'unchanged backup');const sources=data.entries();
      await seed(dbName,version,bad);const before=await snapshot(dbName);
      await rejects(()=>createStore(data,{name:dbName,initial:emptyNotebook}),id===''?/upgrade failed.*intact.*nonempty/:/upgrade failed.*intact/);
      equal(await snapshot(dbName),before,`Invalid page ID at ${index} v${version} changed schema/data`);equal(data.entries(),sources,'Invalid legacy page ID changed recovery bytes');
      // User recovery repairs the malformed rows in the same legacy database, not a reset.
      const db=await req(indexedDB.open(dbName,version)),tx=db.transaction([...db.objectStoreNames],'readwrite'),completed=done(tx);
      for(const [name,saved]of Object.entries(healthy.stores)){
        const store=tx.objectStore(name);for(const key of before.stores[name].keys)if(!saved.keys.includes(key))store.delete(key);
        saved.keys.forEach((key,i)=>store.put(saved.values[i],key));
      }
      await completed;db.close();equal(await snapshot(dbName),healthy,'User recovery changed legacy schema or valid data');
      const retry=await createStore(data,{name:dbName,initial:emptyNotebook});equal(await retry.getNotebook(),f.book,'Recovered page ID failed retry');
      equal(retry.listPages().map(row=>[row.pageId,row.depth]),listPages(f.book).map(row=>[row.pageId,row.depth]),'Special page IDs did not list after recovery');await retry.close();equal(data.entries(),sources,'Recovered migration changed recovery bytes');
    }
    evidence.push({case:`v${version} invalid IDs in every page / exact schema+data rollback / unchanged localStorage / same-DB user recovery and retry / special IDs list`,cases:2*invalidIds.length,passed:true});
  }
  for(const version of [1,2,3]){
    const book=wrapPage(emptyNotebook());book.pages.push(emptyNotebook());book.parents[book.pages[1].id]=book.pages[0].id;
    const raw=book=>JSON.stringify(version===1?book.pages[0]:version===2?(({parents,...book})=>({...book,version:2}))(book):book);
    const valid=raw(book),data=storage(),dbName=name(),store=await createStore(data,{name:dbName,initial:emptyNotebook});
    const before=await snapshot(dbName),exported=await store.export();
    for(const index of version===1?[0]:[0,1])for(const id of invalidIds){
      const invalid=raw(invalidPage(book,index,id));await rejects(()=>store.import(invalid),/Notebook ID must be (nonempty )?text/);
      equal(await snapshot(dbName),before,'Malformed page import changed IndexedDB');check(await store.export()===exported,'Malformed page import changed live notebook');check(store.listPages().length===1,'Malformed import reached page listing');
      const recovery=storage(),recoveryName=name();recovery.setItem(STORAGE_KEY,invalid);for(const v of [1,2,3])recovery.setItem(`${STORAGE_KEY}.v${v}-backup`,`untouched v${v} backup`);const sources=recovery.entries();
      await rejects(()=>createStore(recovery,{name:recoveryName,initial:emptyNotebook}),/Saved notebook.*preserved.*Notebook ID must be (nonempty )?text/);
      const emptyBefore=await snapshot(recoveryName);check(Object.values(emptyBefore.stores).every(store=>store.values.length===0),'Malformed recovery initialized notebook data');
      await rejects(()=>createStore(recovery,{name:recoveryName,initial:emptyNotebook}),/Saved notebook.*preserved.*Notebook ID must be (nonempty )?text/);
      equal(await snapshot(recoveryName),emptyBefore,'Malformed localStorage page wrote IndexedDB');equal(recovery.entries(),sources,'Malformed localStorage page changed source/backup bytes');
      recovery.setItem(STORAGE_KEY,valid);const retry=await createStore(recovery,{name:recoveryName,initial:emptyNotebook});check(retry.listPages().length===(version===1?1:2),'Recovered localStorage page did not list');await retry.close();
      check(recovery.getItem(STORAGE_KEY)===valid,'Recovery source rewritten');for(const v of [1,2,3])check(recovery.getItem(`${STORAGE_KEY}.v${v}-backup`)===`untouched v${v} backup`,'Recovery backup rewritten on retry');
    }
    await store.close();evidence.push({case:`v${version} malformed page import/recovery / no writes or hierarchy loop / exact localStorage backups / user recovery retry`,passed:true});
  }
  for(const version of [1,2,3]){
    const f=fixture(),dbName=name(),data=storage();data.setItem(STORAGE_KEY,'unchanged recovery source');data.setItem(`${STORAGE_KEY}.v1-backup`,'unchanged recovery backup');
    await seed(dbName,version,f);const before=await snapshot(dbName),bytes=data.entries();
    const store=await createStore(data,{name:dbName,initial:emptyNotebook});equal(await store.getNotebook(),f.book,`v${version} full export changed`);equal(data.entries(),bytes,'Recovery bytes changed');
    const after=await snapshot(dbName);check(after.version===4,'Expected schema v4');equal(after.stores.records.keyPath,['pageId','kind','id'],'Not a native compound keyPath');equal(after.stores.records.indexes,[{name:'pageId',keyPath:'pageId',unique:false,multiEntry:false}],'Page index changed');
    for(let i=0;i<after.stores.records.values.length;i++){const row=after.stores.records.values[i];equal(Object.keys(row).sort(),['data','id','kind','pageId'],'Record has serialized key or unknown fields');equal(after.stores.records.keys[i],[row.pageId,row.kind,row.id],'Native primary key mismatch');}
    equal(after.stores.meta,before.stores.meta,'Metadata changed');check(after.stores.history.values.length===0,'Legacy patch paths survived upgrade');check(after.stores.delivery.values.length===before.stores.delivery.values.length,'Delivery ledger lost entries');equal(after.stores.delivery.values,before.stores.delivery.values,'Delivery payload changed');
    equal(after.stores.reminders.values,before.stores.reminders.values,'Reminder values changed');equal(after.stores.reminders.keys,[[f.book.pages[0].id,f.reminder.id]],'Reminder keys were not migrated');
    const beforeTick=await store.export(),timer=startReminders(store,{now:()=>Date.parse('2026-01-01T00:00:00Z'),timers:{setInterval:()=>0,clearInterval:()=>{}},onError:error=>{throw error;},deliver:()=>{throw new Error('Delivered an already-ledgered reminder');}});
    await timer.tick();timer.stop();equal(await store.export(),beforeTick,'First timer tick changed the migrated notebook');equal((await snapshot(dbName)).stores.delivery.values,after.stores.delivery.values,'First timer tick changed delivery timestamps');check((await store.dueReminders(Date.now())).length===0,'Reminder with fired ledger was considered due');
    const first=f.book.pages[0].id,tab=await createStore(data,{name:dbName,initial:emptyNotebook,activePageId:first});check(tab.getActivePageId()===first&&store.getActivePageId()===f.book.activePageId,'Preferred page was not tab-local after migration');
    await store.dispatch('page_select',{pageId:first});await store.dispatch('page_select',{pageId:f.book.activePageId});check(tab.getActivePageId()===first,'Migrated tab followed another tab navigation');equal((await snapshot(dbName)).stores.meta,after.stores.meta,'Page selection wrote migrated notebook metadata');await tab.close();
    await store.dispatch('update_block',{pageId:first,blockId:f.text.id,patch:{text:'changed'}});await store.undo();equal(await store.getPage(first),f.book.pages[0],'Undo changed migrated contents');await store.redo();check((await store.getPage(first)).blocks[0].text==='changed','Redo failed');
    // Tombstones use native keys; undo must restore nested scene and files independently.
    await store.dispatch('remove_block',{pageId:first,blockId:'tabs:"'});await store.undo();equal((await store.getPage(first)).blocks[1],f.book.pages[0].blocks[1],'Nested delete/undo lost images');
    const journals=(await snapshot(dbName)).stores.history.values;check(journals.every(j=>j.changes.every(c=>Array.isArray(c.key)&&c.key.length===3)),'Journal points at old string record keys');
    await store.dispatch('reminder_fired',{pageId:first,blockId:f.reminder.id,firedAt:'2026-01-01T00:00:00Z'});equal((await snapshot(dbName)).stores.delivery.values,after.stores.delivery.values,'Manual reminder claim overwrote an existing ledger timestamp');check((await store.getPage(first)).blocks.find(b=>b.id===f.reminder.id).firedAt==='2020-01-02T00:00:00Z','Existing fired timestamp was not retained');
    await store.dispatch('update_block',{pageId:first,blockId:f.reminder.id,patch:{title:'Do not fire twice'}});check((await store.dueReminders(Date.now())).length===0,'Legacy delivered reminder replayed');
    const saved=await store.export();await store.close();const reopened=await createStore(data,{name:dbName,initial:emptyNotebook});check(await reopened.export()===saved,'v4 reopen changed data');
    const fresh=(await reopened.dispatch('add_block',{pageId:first,type:'reminder',dueAt:'2020-01-01T00:00:00Z'})).block;let deliveries=0;const freshTimer=startReminders(reopened,{now:()=>Date.parse('2026-01-01T00:00:00Z'),timers:{setInterval:()=>0,clearInterval:()=>{}},onError:error=>{throw error;},deliver:()=>{deliveries++;}});await freshTimer.tick();await freshTimer.tick();freshTimer.stop();check(deliveries===1,'Fresh overdue reminder did not deliver exactly once');check((await reopened.getPage(first)).blocks.find(b=>b.id===fresh.id).firedAt==='2026-01-01T00:00:00.000Z','Fresh reminder was not durably claimed');await reopened.close();
    const again=await createStore(data,{name:dbName,initial:emptyNotebook}),afterRestart=startReminders(again,{now:()=>Date.parse('2026-01-01T00:00:00Z'),timers:{setInterval:()=>0,clearInterval:()=>{}},onError:error=>{throw error;},deliver:()=>{deliveries++;}});await afterRestart.tick();afterRestart.stop();check(deliveries===1,'Reopen delivered a reminder again');await again.close();
    evidence.push({case:`v${version} first tick skips old ledger; claim preserves timestamp; fresh reminder delivers once after reopen`,passed:true});
    evidence.push({case:`v${version} → v4`,before:{version:before.version,keyPath:before.stores.records.keyPath,firstKey:before.stores.records.keys[0]},after:{version:after.version,keyPath:after.stores.records.keyPath,firstKey:after.stores.records.keys[0],firstRow:after.stores.records.values[0]},records:after.stores.records.values.length,delivery:after.stores.delivery.values.length});
  }
  for(const version of [1,2,3]){
    const dbName=name(),f=fixture(),data=storage();await seed(dbName,version,f);const before=await snapshot(dbName),add=IDBObjectStore.prototype.add;let count=0;
    IDBObjectStore.prototype.add=function(...args){if(this.transaction.db.name===dbName&&this.name==='records-v4'&&++count===3)throw new DOMException('injected mid-migration quota','QuotaExceededError');return add.apply(this,args);};
    try{await rejects(()=>openRepository(data,{name:dbName,initial:emptyNotebook}),/upgrade failed.*intact.*injected/);}finally{IDBObjectStore.prototype.add=add;}
    equal(await snapshot(dbName),before,`v${version} rollback changed schema/data`);const retry=await openRepository(data,{name:dbName,initial:emptyNotebook});equal(await retry.export(),f.book,'Retry failed');retry.close();evidence.push({case:`v${version} abort / exact rollback / retry`,passed:true});
  }
  function alterRecord(tx,f,kind,id,change){const store=tx.objectStore('records'),key=JSON.stringify([f.book.pages[0].id,`$${kind}:${id}`]),reading=store.get(key);reading.onsuccess=()=>{const row=reading.result;change(row);store.put(row,key);};}
  const corruptions=[
    ['malformed key',tx=>tx.objectStore('records').put({kind:'block',pageId:'bad',data:{id:'x',type:'text',text:'bad'}},'not JSON')],
    ['mismatched ID',tx=>{const k=JSON.stringify(['bad','$block:x']);tx.objectStore('records').put({key:k,kind:'block',pageId:'bad',data:{id:'wrong',type:'text',text:'bad'}},k);}],
    ['alias collision',tx=>{const k='["bad", "$block:x"]';tx.objectStore('records').put({key:k,kind:'block',pageId:'bad',data:{id:'x',type:'text',text:'bad'}},k);const other='["bad","$block:x"]';tx.objectStore('records').put({key:other,kind:'block',pageId:'bad',data:{id:'x',type:'text',text:'bad'}},other);}],
    ['orphan record',tx=>{const k=JSON.stringify(['bad','$block:orphan']);tx.objectStore('records').put({key:k,kind:'block',pageId:'bad',data:{id:'orphan',type:'text',text:'bad'}},k);}],
    ['malformed reminder',tx=>tx.objectStore('reminders').put({pageId:'bad',id:'bad',type:'reminder'},'not JSON')],
    ['malformed empty metadata',tx=>{tx.objectStore('meta').put(null,'book');tx.objectStore('records').clear();tx.objectStore('reminders').clear();}],
    ['malformed delivery',tx=>tx.objectStore('delivery').put('2020-01-02T00:00:00Z',JSON.stringify(['bad','unparseable']))],
    ['unknown container data',(tx,f)=>alterRecord(tx,f,'container','page',row=>row.data.unknown='must not silently discard')],
    ['embedded hidden tab blocks',(tx,f)=>alterRecord(tx,f,'block','tabs:"',row=>row.data.tabs[0].blocks=[{id:'lost',type:'text',text:'must not silently discard'}])],
    ['ambiguous embedded files',(tx,f)=>alterRecord(tx,f,'scene',f.drawing.id,row=>row.data.files=f.drawing.scene.files)]
  ];
  for(const [label,mutate]of corruptions){const dbName=name(),f=fixture();await seed(dbName,3,f,mutate);const before=await snapshot(dbName);await rejects(()=>openRepository(storage(),{name:dbName,initial:emptyNotebook}),/upgrade failed.*intact/);equal(await snapshot(dbName),before,`${label} was partially migrated`);evidence.push({case:`reject ${label} / exact rollback`,passed:true});}
  for(const version of [1,2,3]){
    const data=storage(),f=fixture(),raw=JSON.stringify(version===1?f.book.pages[0]:version===2?(({parents,...book})=>({...book,version:2}))(f.book):f.book);data.setItem(STORAGE_KEY,raw);
    const dbName=name(),put=IDBObjectStore.prototype.put;let fail=true;
    IDBObjectStore.prototype.put=function(...args){if(fail&&this.name==='records'&&this.transaction.db.name===dbName)throw new DOMException('import quota','QuotaExceededError');return put.apply(this,args);};
    try{await rejects(()=>createStore(data,{name:dbName,initial:emptyNotebook}),/import quota/);fail=false;const retry=await createStore(data,{name:dbName,initial:emptyNotebook});equal((await retry.getNotebook()).pages,f.book.pages.slice(0,version===1?1:2),`localStorage v${version} recovery failed`);check(data.getItem(STORAGE_KEY)===raw,'localStorage source was rewritten');if(version<3)check(data.getItem(`${STORAGE_KEY}.v${version}-backup`)===raw,'localStorage backup changed');await retry.close();}finally{IDBObjectStore.prototype.put=put;}
    evidence.push({case:`localStorage v${version} failed import / retry`,passed:true});
  }
  for(const version of [1,2,3]){const dbName=name();await seed(dbName,version);const empty=await createStore(storage(),{name:dbName,initial:emptyNotebook});check((await empty.getNotebook()).pages.length===1,'Empty legacy database failed');check((await snapshot(dbName)).version===4,'Empty legacy database did not upgrade');await empty.close();evidence.push({case:`empty v${version} → initialized v4`,passed:true});}
  for(const version of [1,2,3])for(const orphan of ['meta','records','reminders','history','delivery']){
    const dbName=name(),f=fixture(),data=storage();data.setItem(STORAGE_KEY,'unchanged recovery source');data.setItem(`${STORAGE_KEY}.v1-backup`,'unchanged recovery backup');
    await seed(dbName,version,f,tx=>{
      const reading=tx.objectStore(orphan).openCursor();reading.onsuccess=()=>{const row=reading.result;if(orphan==='meta'&&row.primaryKey==='book'){row.continue();return;}const key=row.primaryKey,value=row.value;for(const store of ['meta','records','reminders','history','delivery'])tx.objectStore(store).clear();tx.objectStore(orphan).put(value,key);};
    });
    const before=await snapshot(dbName),sources=data.entries();await rejects(()=>openRepository(data,{name:dbName,initial:emptyNotebook}),/upgrade failed.*intact.*metadata is missing/);equal(await snapshot(dbName),before,`Orphan ${orphan} v${version} changed schema/data`);equal(data.entries(),sources,'Orphan migration overwrote localStorage');evidence.push({case:`v${version} missing meta.book / ${orphan}-only orphan / exact rollback`,passed:true});
  }
  const data=storage(),fresh=await createStore(data,{name:name(),initial:emptyNotebook});check((await fresh.getNotebook()).pages.length===1,'New install failed');await fresh.close();
  for(const version of [1,2,3]){
    const dbName=name(),f=fixture(),data=storage();await seed(dbName,version,f);data.setItem(STORAGE_KEY,JSON.stringify(f.book));const sources=data.entries(),legacy=await req(indexedDB.open(dbName,version)),before=await snapshot(dbName,legacy);let opening;
    const factory={open:(...args)=>(opening=indexedDB.open(...args))};
    await rejects(()=>openRepository(data,{name:dbName,indexedDB:factory,initial:emptyNotebook}),/blocked.*Save.*close.*reload.*intact/);
    equal(await snapshot(dbName,legacy),before,'Blocked upgrade changed legacy data');equal(data.entries(),sources,'Blocked upgrade changed recovery sources');
    const cancelled=new Promise((resolve,reject)=>{opening.addEventListener('error',resolve,{once:true});opening.addEventListener('success',()=>reject(new Error('Rejected upgrade continued in the background')),{once:true});});legacy.close();await cancelled;
    equal(await snapshot(dbName),before,'Late blocked upgrade changed schema/data before reload');
    const retry=await openRepository(data,{name:dbName,initial:emptyNotebook});equal(await retry.export(),f.book,'Blocked upgrade retry lost data');retry.close();
    evidence.push({case:`v${version} legacy tab without versionchange handler / actionable blocked error / no late upgrade / retry`,passed:true});
  }
  for(const version of [1,2,3]){
    const dbName=name(),f=fixture();await seed(dbName,version,f);const legacy=await req(indexedDB.open(dbName,version));let changed=false;legacy.onversionchange=()=>{changed=true;legacy.close();};
    const current=await openRepository(storage(),{name:dbName,initial:emptyNotebook});check(changed,'Legacy connection did not receive versionchange');let stale=false;try{legacy.transaction('records','readwrite');}catch{stale=true;}check(stale,'Closed legacy writer can still transact');current.close();
  }
  const dbName=name(),live=await openRepository(storage(),{name:dbName,initial:emptyNotebook}),opening=indexedDB.open(dbName,5);const upgraded=await req(opening);await rejects(()=>live.commit({}, {}, []),/upgraded.*Reload/);upgraded.close();live.close();
  evidence.push({case:'new install / versionchange closes connection and rejects obsolete writer',passed:true});
  let startup;
  if(startupVersion){const f=fixture();f.reminder.dueAt='2999-01-01T00:00:00Z';f.book.pages[0].blocks.find(b=>b.id===f.reminder.id).dueAt=f.reminder.dueAt;await seed('omd.notebook.records.v1',startupVersion,f);startup=f.book;}
  return {evidence,startup};
}
