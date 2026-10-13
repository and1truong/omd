import type {WebMCPRegistry} from './webmcp.js';
import type {AgentBridge} from './bridge.js';
export {};
declare global {
  interface Document {modelContext?:WebMCPRegistry}
  interface Navigator {modelContext?:WebMCPRegistry}
  interface Window {EXCALIDRAW_ASSET_PATH?:string;agentBridgeV1?:AgentBridge&{requestAgentTurn?:(prompt:string)=>Promise<unknown>}}
  interface BeforeInstallPromptEvent extends Event {prompt():Promise<unknown>;userChoice:Promise<{outcome:'accepted'|'dismissed';platform:string}>}
  interface WindowEventMap {beforeinstallprompt:BeforeInstallPromptEvent;appinstalled:Event}
}
declare module '*.css';
