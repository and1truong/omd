// The same checks run with fake-indexeddb and the browser's actual IndexedDB.
export async function migrationChecks({sourceRoot,extension='ts',startupVersion}) {
  const {openRepository}=await import(`${sourceRoot}repository.${extension}`);
  const {createStore}=await import(`${sourceRoot}store.${extension}`);
  const {emptyNotebook,makeBlock,STORAGE_KEY}=await import(`${sourceRoot}model.${extension}`);
  const {wrapPage}=await import(`${sourceRoot}notebook.${extension}`);
  const {bookRecords,metadataBook}=await import(`${sourceRoot}records.${extension}`);
  const check=(ok,message)=>{if(!ok)throw new Error(message);};
  const equal=(a,b,message)=>check(JSON.stringify(a)===JSON.stringify(b),message);
  const req=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const done=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
  const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),entries:()=>[...data]};};
  const name=()=>`migration-${crypto.randomUUID()}`;
  const evidence=[];
  async function snapshot(name){
    const db=await req(indexedDB.open(name)),names=[...db.objectStoreNames],tx=db.transaction(names),completed=done(tx),stores={};
    await Promise.all(names.map(async name=>{const store=tx.objectStore(name);const [keys,values]=await Promise.all([req(store.getAllKeys()),req(store.getAll())]);stores[name]={keyPath:store.keyPath,indexes:[...store.indexNames].map(n=>({name:n,keyPath:store.index(n).keyPath})),keys,values};}));
    await completed;const result={version:db.version,stores};db.close();return result;
  }
  function fixture(){
    const page=emptyNotebook();page.id='p:á/"一';page.title='Giữ nguyên';page.revision=17;
    const text=makeBlock('text',{text:'Markdown **nguyên bản** [link](https://example.com)'});text.id='b:/"一';
    const drawing=makeBlock('excalidraw');drawing.id='draw:/"一';drawing.scene.files.image={id:'image',dataURL:'data:image/png;base64,'+'A'.repeat(200000)};
    const tabs=makeBlock('tabs');tabs.id='tabs:"';tabs.tabs[0].id='tab:first/一';tabs.tabs[1].id='tab:second/一';tabs.activeTabId=tabs.tabs[0].id;
    const toggle=makeBlock('toggle');toggle.id='toggle:一';toggle.open=false;
    const accordion=makeBlock('accordion');accordion.id='accordion:一';accordion.items[0].id='section:/"一';accordion.items[0].open=false;accordion.items[0].blocks=[drawing];toggle.blocks=[accordion];tabs.tabs[1].blocks=[toggle];
    const reminder=makeBlock('reminder',{dueAt:'2020-01-01T00:00:00+07:00'});reminder.id='remind:2020-01-01T00:00:00Z:/"一';
    const rootAlias=makeBlock('text',{text:'ID page is a block, not the root container'});rootAlias.id='page';
    page.blocks=[text,tabs,reminder,rootAlias];
    const other=emptyNotebook();other.id='p:á/"二';other.blocks=[{...text,text:'Same logical block ID, another page'}];
    const book=wrapPage(page);book.pages.push(other);book.parents[other.id]=page.id;book.activePageId=other.id;book.revision=29;
    return {book,text,drawing,reminder};
  }
  async function seed(name,version,{book,drawing,reminder},mutate){
    const opening=indexedDB.open(name,version);opening.onupgradeneeded=()=>{
      const db=opening.result;db.createObjectStore('meta');db.createObjectStore('records').createIndex('pageId','pageId');db.createObjectStore('reminders').createIndex('due','due');const history=db.createObjectStore('history');if(version>=3)history.createIndex('owner','owner');db.createObjectStore('delivery');
    };
    const db=await req(opening),tx=db.transaction([...db.objectStoreNames],'readwrite'),completed=done(tx),records=tx.objectStore('records');
    tx.objectStore('meta').put(metadataBook(book),'book');tx.objectStore('meta').put('Do not erase extra metadata','recovery-note');
    for(const value of bookRecords(book).values()){
      if(version<3&&value.kind==='files')continue;
      const id=value.kind==='page'?'$page':`$${value.kind}:${value.id}`,key=JSON.stringify([value.pageId,id]);
      const row={key,kind:value.kind,pageId:value.pageId,data:version<3&&value.kind==='scene'?drawing.scene:value.data};records.put(row,key);
      if(value.kind==='block'&&value.data.type==='reminder')tx.objectStore('reminders').put({pageId:value.pageId,...value.data,due:Date.parse(value.data.dueAt)},key);
    }
    tx.objectStore('history').put({owner:'legacy-owner',before:book,after:book,changes:[{key:JSON.stringify([book.pages[0].id,`$block:${reminder.id}`]),forward:[],inverse:[]}]},'legacy-undo');
    const firedAt='2020-01-02T00:00:00Z';tx.objectStore('delivery').put(firedAt,JSON.stringify([book.pages[0].id,`${reminder.id}:${reminder.dueAt}`]));
    // Deleted reminders still have ledger entries, and their cursor can outlast records.
    for(let i=0;i<80;i++)tx.objectStore('delivery').put(firedAt,JSON.stringify([book.pages[0].id,`deleted:${i}:${reminder.dueAt}`]));
    mutate?.(tx);await completed;db.close();
  }
  async function rejects(fn,pattern){let error;try{await fn();}catch(e){error=e;}check(error&&pattern.test(error.message),`Expected recovery error ${pattern}, got ${error?.message??'success'}`);}
  for(const version of [1,2,3]){
    const f=fixture(),dbName=name(),data=storage();data.setItem(STORAGE_KEY,'unchanged recovery source');data.setItem(`${STORAGE_KEY}.v1-backup`,'unchanged recovery backup');
    await seed(dbName,version,f);const before=await snapshot(dbName),bytes=data.entries();
    const store=await createStore(data,{name:dbName,initial:emptyNotebook});equal(await store.getNotebook(),f.book,`v${version} full export changed`);equal(data.entries(),bytes,'Recovery bytes changed');
    const after=await snapshot(dbName);check(after.version===4,'Expected schema v4');equal(after.stores.records.keyPath,['pageId','kind','id'],'Not a native compound keyPath');equal(after.stores.records.indexes,[{name:'pageId',keyPath:'pageId'}],'Page index changed');
    for(let i=0;i<after.stores.records.values.length;i++){const row=after.stores.records.values[i];equal(Object.keys(row).sort(),['data','id','kind','pageId'],'Record has serialized key or unknown fields');equal(after.stores.records.keys[i],[row.pageId,row.kind,row.id],'Native primary key mismatch');}
    equal(after.stores.meta,before.stores.meta,'Metadata changed');check(after.stores.history.values.length===0,'Legacy patch paths survived upgrade');check(after.stores.delivery.values.length===before.stores.delivery.values.length,'Delivery ledger lost entries');equal(after.stores.delivery.values,before.stores.delivery.values,'Delivery payload changed');
    equal(after.stores.reminders.values,before.stores.reminders.values,'Reminder values changed');equal(after.stores.reminders.keys,[[f.book.pages[0].id,f.reminder.id]],'Reminder keys were not migrated');
    check((await store.dueReminders(Date.now())).length===1,'Reminder query failed');
    const first=f.book.pages[0].id;await store.dispatch('update_block',{pageId:first,blockId:f.text.id,patch:{text:'changed'}});await store.undo();equal(await store.getPage(first),f.book.pages[0],'Undo changed migrated contents');await store.redo();check((await store.getPage(first)).blocks[0].text==='changed','Redo failed');
    // Tombstones use native keys; undo must restore nested scene and files independently.
    await store.dispatch('remove_block',{pageId:first,blockId:'tabs:"'});await store.undo();equal((await store.getPage(first)).blocks[1],f.book.pages[0].blocks[1],'Nested delete/undo lost images');
    const journals=(await snapshot(dbName)).stores.history.values;check(journals.every(j=>j.changes.every(c=>Array.isArray(c.key)&&c.key.length===3)),'Journal points at old string record keys');
    await store.dispatch('update_block',{pageId:first,blockId:f.reminder.id,patch:{title:'Do not fire twice'}});check((await store.dueReminders(Date.now())).length===0,'Legacy delivered reminder replayed');
    const saved=await store.export();await store.close();const reopened=await createStore(data,{name:dbName,initial:emptyNotebook});check(await reopened.export()===saved,'v4 reopen changed data');await reopened.close();
    evidence.push({case:`v${version} → v4`,before:{version:before.version,keyPath:before.stores.records.keyPath,firstKey:before.stores.records.keys[0]},after:{version:after.version,keyPath:after.stores.records.keyPath,firstKey:after.stores.records.keys[0],firstRow:after.stores.records.values[0]},records:after.stores.records.values.length,delivery:after.stores.delivery.values.length});
  }
  for(const version of [1,2,3]){
    const dbName=name(),f=fixture(),data=storage();await seed(dbName,version,f);const before=await snapshot(dbName),add=IDBObjectStore.prototype.add;let count=0;
    IDBObjectStore.prototype.add=function(...args){if(this.transaction.db.name===dbName&&this.name==='records-v4'&&++count===3)throw new DOMException('injected mid-migration quota','QuotaExceededError');return add.apply(this,args);};
    try{await rejects(()=>openRepository(data,{name:dbName,initial:emptyNotebook}),/upgrade failed.*intact.*injected/);}finally{IDBObjectStore.prototype.add=add;}
    equal(await snapshot(dbName),before,`v${version} rollback changed schema/data`);const retry=await openRepository(data,{name:dbName,initial:emptyNotebook});equal(await retry.export(),f.book,'Retry failed');retry.close();evidence.push({case:`v${version} abort / exact rollback / retry`,passed:true});
  }
  const corruptions=[
    ['malformed key',tx=>tx.objectStore('records').put({kind:'block',pageId:'bad',data:{id:'x',type:'text',text:'bad'}},'not JSON')],
    ['mismatched ID',tx=>{const k=JSON.stringify(['bad','$block:x']);tx.objectStore('records').put({key:k,kind:'block',pageId:'bad',data:{id:'wrong',type:'text',text:'bad'}},k);}],
    ['alias collision',tx=>{const k='["bad", "$block:x"]';tx.objectStore('records').put({key:k,kind:'block',pageId:'bad',data:{id:'x',type:'text',text:'bad'}},k);const other='["bad","$block:x"]';tx.objectStore('records').put({key:other,kind:'block',pageId:'bad',data:{id:'x',type:'text',text:'bad'}},other);}],
    ['orphan record',tx=>{const k=JSON.stringify(['bad','$block:orphan']);tx.objectStore('records').put({key:k,kind:'block',pageId:'bad',data:{id:'orphan',type:'text',text:'bad'}},k);}],
    ['malformed reminder',tx=>tx.objectStore('reminders').put({pageId:'bad',id:'bad',type:'reminder'},'not JSON')],
    ['malformed delivery',tx=>tx.objectStore('delivery').put('2020-01-02T00:00:00Z',JSON.stringify(['bad','unparseable']))]
  ];
  for(const [label,mutate]of corruptions){const dbName=name(),f=fixture();await seed(dbName,3,f,mutate);const before=await snapshot(dbName);await rejects(()=>openRepository(storage(),{name:dbName,initial:emptyNotebook}),/upgrade failed.*intact/);equal(await snapshot(dbName),before,`${label} was partially migrated`);evidence.push({case:`reject ${label} / exact rollback`,passed:true});}
  for(const version of [1,2,3]){
    const data=storage(),f=fixture(),raw=JSON.stringify(version===1?f.book.pages[0]:version===2?(({parents,...book})=>({...book,version:2}))(f.book):f.book);data.setItem(STORAGE_KEY,raw);
    const dbName=name(),put=IDBObjectStore.prototype.put;let fail=true;
    IDBObjectStore.prototype.put=function(...args){if(fail&&this.name==='records'&&this.transaction.db.name===dbName)throw new DOMException('import quota','QuotaExceededError');return put.apply(this,args);};
    try{await rejects(()=>createStore(data,{name:dbName,initial:emptyNotebook}),/import quota/);fail=false;const retry=await createStore(data,{name:dbName,initial:emptyNotebook});equal((await retry.getNotebook()).pages,f.book.pages.slice(0,version===1?1:2),`localStorage v${version} recovery failed`);check(data.getItem(STORAGE_KEY)===raw,'localStorage source was rewritten');if(version<3)check(data.getItem(`${STORAGE_KEY}.v${version}-backup`)===raw,'localStorage backup changed');await retry.close();}finally{IDBObjectStore.prototype.put=put;}
    evidence.push({case:`localStorage v${version} failed import / retry`,passed:true});
  }
  const data=storage(),fresh=await createStore(data,{name:name(),initial:emptyNotebook});check((await fresh.getNotebook()).pages.length===1,'New install failed');await fresh.close();
  for(const version of [1,2,3]){
    const dbName=name(),f=fixture();await seed(dbName,version,f);const legacy=await req(indexedDB.open(dbName,version));let changed=false;legacy.onversionchange=()=>{changed=true;legacy.close();};
    const current=await openRepository(storage(),{name:dbName,initial:emptyNotebook});check(changed,'Legacy connection did not receive versionchange');let stale=false;try{legacy.transaction('records','readwrite');}catch{stale=true;}check(stale,'Closed legacy writer can still transact');current.close();
  }
  const dbName=name(),live=await openRepository(storage(),{name:dbName,initial:emptyNotebook}),opening=indexedDB.open(dbName,5);const upgraded=await req(opening);await rejects(()=>live.commit({}, {}, []),/upgraded.*Reload/);upgraded.close();live.close();
  evidence.push({case:'new install / versionchange closes connection and rejects obsolete writer',passed:true});
  let startup;
  if(startupVersion){const f=fixture();f.reminder.dueAt='2999-01-01T00:00:00Z';await seed('omd.notebook.records.v1',startupVersion,f);startup=f.book;}
  return {evidence,startup};
}
