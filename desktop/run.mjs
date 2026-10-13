import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url)),kit=join(root,'.desktop/coconut-desktop-kit');
const args=process.argv.slice(2);if(!['dev','build'].includes(args[0]))throw Error('Use npm run desktop:dev or desktop:build.');
const cli=join(kit,'node_modules/@tauri-apps/cli/tauri.js');
const child=spawn(process.execPath,[cli,...args],{cwd:kit,stdio:'inherit',env:{...process.env,CARGO_TARGET_DIR:join(root,'.desktop/target')}});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',(code)=>{process.exitCode=code??1;});
