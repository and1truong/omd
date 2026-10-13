export type ID = string;
export type Orientation = 'horizontal' | 'vertical';
export type Theme = 'system' | 'light' | 'dark';
export type ResolvedTheme = Exclude<Theme,'system'>;
export type NotificationMode = 'notification' | 'alert' | 'toast';
export type JsonValue = null | boolean | number | string | JsonValue[] | {[key:string]:JsonValue};
export type JsonObject = {[key:string]:JsonValue};
export interface SceneElement extends JsonObject {id:ID;type:string;x:number;y:number;width:number;height:number}
export interface SceneFile extends JsonObject {id:ID;dataURL:string}
export interface Scene {elements:SceneElement[];appState:JsonObject;files:Record<ID,SceneFile>}
export interface TextBlock {id:ID;type:'text' | 'heading';text:string}
export interface DividerBlock {id:ID;type:'divider'}
export interface TableRow {id:ID;cells:string[]}
export interface TableBlock {id:ID;type:'table';title:string;headerRow:boolean;pinnedHeader:boolean;pinnedColumns:number;columns:{id:ID}[];rows:TableRow[]}
export interface ChecklistItem {id:ID;text:string;done:boolean;completedAt?:string|null;children?:ChecklistItem[]}
export interface ChecklistBlock {id:ID;type:'checklist';title:string;items:ChecklistItem[]}
export interface Tab {id:ID;title:string;blocks:Block[]}
export interface TabsBlock {id:ID;type:'tabs';title:string;orientation:Orientation;activeTabId:ID;tabs:Tab[]}
export interface ToggleBlock {id:ID;type:'toggle';title:string;open:boolean;blocks:Block[]}
export interface AccordionItem {id:ID;title:string;open:boolean;blocks:Block[]}
export interface AccordionBlock {id:ID;type:'accordion';title:string;items:AccordionItem[]}
export interface ReminderBlock {id:ID;type:'reminder';title:string;dueAt:string;enabled:boolean;firedAt:string|null}
export interface Card {id:ID;title:string;description:string}
export interface Column {id:ID;title:string;cards:Card[]}
export interface KanbanBlock {id:ID;type:'kanban';title:string;columns:Column[]}
export interface MermaidBlock {id:ID;type:'mermaid';title:string;source:string}
export interface ExcalidrawBlock {id:ID;type:'excalidraw';title:string;scene:Scene}
export type Block = TextBlock | DividerBlock | TableBlock | ChecklistBlock | TabsBlock | ToggleBlock | AccordionBlock | ReminderBlock | KanbanBlock | MermaidBlock | ExcalidrawBlock;
export type BlockType = Block['type'];
export type BlockOf<T extends BlockType> = Extract<Block,{type:T}> | (T extends 'text' | 'heading' ? TextBlock : never);
export interface Page {format:'omd';version:1;id:ID;revision:number;title:string;subtitle:string;theme:Theme;notificationMode:NotificationMode;updatedAt:string;blocks:Block[]}
export type PageMetadata = Omit<Page,'blocks'>;
export interface Notebook {format:'omd-notebook';version:3;id:ID;revision:number;activePageId:ID;updatedAt:string;pages:Page[];parents:Record<ID,ID>}
export interface PageRow {pageId:ID;title:string;subtitle:string;index:number;active:boolean;parentId:ID;depth:number;childCount:number;siblingCount:number;descendantCount:number}
export type PartialView = Partial<View>;
export interface View {sidebarOpen:boolean;contentWidth:'reading'|'wide';collapsedPageIds:ID[];theme:Theme}
export interface StorageLike {getItem(key:string):string|null;setItem(key:string,value:string):unknown}
export interface BlockOptions {text?:string;title?:string;orientation?:Orientation;dueAt?:string;source?:string;scene?:Scene;rowCount?:number;columnCount?:number;headerRow?:boolean;pinnedHeader?:boolean;pinnedColumns?:number}
export interface BlockPatch extends BlockOptions {open?:boolean;enabled?:boolean}
export interface CommandInputs {
  set_page:Partial<Pick<Page,'title'|'subtitle'|'theme'|'notificationMode'>>;
  add_block:BlockOptions & {type:BlockType;containerId?:ID;index?:number};
  update_block:{blockId:ID;patch:BlockPatch};
  remove_block:{blockId:ID};move_block:{blockId:ID;containerId:ID;index?:number};
  table_cell_update:{blockId:ID;rowId:ID;columnId:ID;text:string};
  table_row_add:{blockId:ID;index?:number};table_row_remove:{blockId:ID;rowId:ID};
  table_column_add:{blockId:ID;index?:number};table_column_remove:{blockId:ID;columnId:ID};
  checklist_add:{blockId:ID;text?:string;parentId?:ID;index?:number};checklist_update:{blockId:ID;itemId:ID;patch:Partial<Pick<ChecklistItem,'text'|'done'>>};checklist_remove:{blockId:ID;itemId:ID};checklist_move:{blockId:ID;itemId:ID;parentId?:ID;index:number};
  tab_add:{blockId:ID;title?:string;index?:number};tab_update:{blockId:ID;tabId:ID;title:string};tab_select:{blockId:ID;tabId:ID};tab_move:{blockId:ID;tabId:ID;index:number};tab_remove:{blockId:ID;tabId:ID};
  accordion_add:{blockId:ID;title?:string;index?:number};accordion_update:{blockId:ID;itemId:ID;patch:Partial<Pick<AccordionItem,'title'|'open'>>};accordion_remove:{blockId:ID;itemId:ID};accordion_move:{blockId:ID;itemId:ID;index:number};
  column_add:{blockId:ID;title?:string;index?:number};column_update:{blockId:ID;columnId:ID;title:string};column_remove:{blockId:ID;columnId:ID};column_move:{blockId:ID;columnId:ID;index:number};
  card_add:{blockId:ID;columnId:ID;title?:string;description?:string;index?:number};card_update:{blockId:ID;cardId:ID;patch:Partial<Pick<Card,'title'|'description'>>};card_remove:{blockId:ID;cardId:ID};card_move:{blockId:ID;cardId:ID;columnId:ID;index?:number};
  reminder_fired:{blockId:ID;firedAt:string};
  page_add:{title?:string;parentId?:ID;index?:number};page_select:{pageId:ID};page_update:{pageId:ID;title?:string;subtitle?:string};page_move:{pageId:ID;parentId?:ID;index?:number};page_remove:{pageId:ID};
  import_notebook:{notebook:Notebook|Page};
}
export type CommandName = keyof CommandInputs;
export type CommandInput<K extends CommandName> = CommandInputs[K] & {pageId?:ID};
export type CommandResult<K extends CommandName> = K extends 'add_block' ? {blockId:ID;block:Block} : K extends 'update_block' ? {blockId:ID} : K extends 'table_row_add' ? {rowId:ID} : K extends 'checklist_add'|'accordion_add' ? {itemId:ID} : K extends 'tab_add' ? {tabId:ID} : K extends 'column_add'|'table_column_add' ? {columnId:ID} : K extends 'card_add' ? {cardId:ID} : K extends 'page_add' ? {pageId:ID} : K extends 'page_remove' ? {removedPageIds:ID[]} : K extends 'import_notebook' ? {imported:true} : Record<never,never>;
export type MutationResult<K extends CommandName> = CommandResult<K> & {revision:number};
// Internal switch handlers retain runtime validation at the untrusted-input boundary.
export type InternalInput = Partial<BlockOptions & {type:BlockType;theme:Theme;notificationMode:NotificationMode;subtitle:string;description:string;containerId:ID;index:number;blockId:ID;itemId:ID;tabId:ID;rowId:ID;columnId:ID;cardId:ID;pageId:ID;parentId:ID;firedAt:string;notebook:Notebook|Page;patch:BlockPatch & {text?:string;done?:boolean;description?:string}}>;
export type ActionResult = Partial<{blockId:ID;block:Block;itemId:ID;tabId:ID;rowId:ID;columnId:ID;cardId:ID;pageId:ID;removedPageIds:ID[];imported:boolean}>;
export interface ChangeEvent {actionName?:CommandName;changedBlockId?:ID;changedPageId?:ID;quiet?:boolean;reset?:boolean;reminderBlockId?:ID;reminderPageId?:ID;history?:boolean}
export interface SaveStatus {pending:number;navigating:boolean;error:Error|null}
export interface BridgeWrite {notebookId:ID;expectedRevision:number;idempotencyKey:string;semantic:string}
export interface BridgeReceipt {semantic:string;data:unknown;revision:number}
export interface NotebookStore {
  databaseName():string;getNotebookId():ID;getActivePageId():ID;getRevision():number;getState():Page;getRenderState():Readonly<Page>;getLastEvent():ChangeEvent;
  getPageMetadata(id:ID):Page|undefined;getPage(id?:ID):Promise<Page>;getNotebook():Promise<Notebook>;listPages():PageRow[];
  dispatch<K extends CommandName>(action:K,input:CommandInput<K>,options?:ChangeEvent,bridge?:BridgeWrite):Promise<MutationResult<K>>;
  subscribe(fn:(page:Page,event:ChangeEvent)=>void):()=>void;
  subscribeBlock(id:ID,fn:(page:Page,event:ChangeEvent)=>void):()=>void;subscribeContainer(id:ID,fn:(page:Page,event:ChangeEvent)=>void):()=>void;
  afterChange(fn:()=>void):()=>void;subscribeStatus(fn:(status:SaveStatus)=>void):()=>void;
  export():Promise<string>;import(raw:string,options?:ChangeEvent):Promise<MutationResult<'import_notebook'>>;reload():Promise<void>;
  dueReminders(now:number):Promise<DueReminder[]>;canUndo():boolean;canRedo():boolean;undo():Promise<boolean>;redo():Promise<boolean>;idle():Promise<unknown>;close():Promise<void>;
  residency():{pageId:ID;pageCount:number;recordCount:number;undoEntries:number};
}
export interface DueReminder extends ReminderBlock {pageId:ID;due:number}
export type BlockMetadata = Exclude<Block,TabsBlock|ToggleBlock|AccordionBlock|ExcalidrawBlock> | Omit<ToggleBlock,'blocks'> | (Omit<TabsBlock,'tabs'> & {tabs:Omit<Tab,'blocks'>[]}) | (Omit<AccordionBlock,'items'> & {items:Omit<AccordionItem,'blocks'>[]}) | Omit<ExcalidrawBlock,'scene'>;
export interface ContainerRecord {id:ID;blockIds:ID[]}
export type RecordData = {page:PageMetadata;block:BlockMetadata;container:ContainerRecord;scene:Omit<Scene,'files'>;files:Scene['files']};
export type RecordKind = keyof RecordData;
export type RecordKey = [pageId:ID,kind:RecordKind,id:ID];
export type StoredRecord = {[K in RecordKind]:{kind:K;pageId:ID;id:ID;data:RecordData[K]}}[RecordKind];
export type Records = Map<string,StoredRecord>;
export interface RecordChange {key:RecordKey;before:StoredRecord|null;after:StoredRecord|null}
export type Notify = (message:string,kind?:string,sticky?:boolean)=>void;
export type ErrorHandler = (error:Error)=>void;
export interface Journal {owner:string;before:Notebook;after:Notebook;changes:{key:RecordKey;forward:import('immer').Patch[];inverse:import('immer').Patch[]}[]}
export interface StoreOptions {key?:string;name?:string;indexedDB?:IDBFactory;initial?:()=>Notebook|Page;locks?:LockManager;activePageId?:string}
