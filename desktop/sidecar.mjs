import {startServer} from './omd-server.mjs';
const server=await startServer(process.env.OMD_ASSET_DIR,process.env.OMD_ORIGIN);
try{await import('./sidecar.mjs');}
catch(error){server.close();throw error;}
// Assets and MCP live in the native-owned process. Closing its stdin/parent tears both down.
