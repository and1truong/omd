import test from 'node:test';
import 'fake-indexeddb/auto';
import {migrationChecks} from './record-migration-checks.js';
test('native v4 migration preserves full notebooks, rolls back failures and rejects malformed legacy data',async()=>{
  await migrationChecks({sourceRoot:new URL('../src/',import.meta.url).href});
});
