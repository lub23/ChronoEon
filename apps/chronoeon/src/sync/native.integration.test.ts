// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createEntryId } from "@chronoeon/domain";
import { AiConversationStore, SqliteEntryStore, SyncEngine, SyncStore, type AttachmentMetadata, type Publication, type RemoteFetch, type SyncBackend } from "@chronoeon/storage";
import { MemorySqliteBackend } from "@chronoeon/storage/test";
import type { SyncConfig } from "./types";

const executable = process.env.CHRONOEON_NATIVE_SYNC_BIN;
class Host {
  process: ChildProcessWithoutNullStreams;
  pending: Array<{resolve:(value:any)=>void;reject:(error:Error)=>void}> = [];
  stderr = "";
  constructor() {
    this.process=spawn(executable!,[],{stdio:"pipe",windowsHide:true});
    createInterface({input:this.process.stdout}).on("line",(line)=>{
      const request=this.pending.shift(); if(!request) return;
      try {const result=JSON.parse(line);if(result.ok)request.resolve(result.value);else request.reject(new Error(result.error));}
      catch(error){request.reject(error as Error);}
    });
    this.process.stderr.on("data",(data)=>{this.stderr+=String(data);});
    this.process.on("exit",(code)=>{for(const pending of this.pending.splice(0))pending.reject(new Error(`native host exited ${code}: ${this.stderr}`));});
  }
  request<T>(value:Record<string,unknown>):Promise<T>{return new Promise((resolve,reject)=>{this.pending.push({resolve,reject});this.process.stdin.write(JSON.stringify(value)+"\n");});}
  async close(){this.process.stdin.end();if(this.process.exitCode===null)await new Promise<void>((resolve)=>this.process.once("exit",()=>resolve()));}
}
function webdavServer() {
  const files=new Map<string,Buffer>();
  let lock: string | null = null;
  let deletionPause: {path:string; entered:()=>void; resume:Promise<void>} | null = null;
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks);
    const key=req.url!;const old=files.get(key);const etag=old?`"${createHash("sha256").update(old).digest("hex")}"`:null;
    if(req.method==="LOCK") {
      if(lock && !String(req.headers.if??"").includes(lock)){res.writeHead(423).end();return;}
      lock ??= `<opaquelocktoken:${createEntryId()}>`;res.writeHead(200,{"Lock-Token":lock,Timeout:"Second-600"}).end();return;
    }
    if(req.method==="UNLOCK") {if(req.headers["lock-token"]===lock){lock=null;res.writeHead(204).end();}else res.writeHead(409).end();return;}
    if(lock && ["PUT","DELETE","MKCOL"].includes(req.method??"") && !String(req.headers.if??"").includes(lock)){res.writeHead(423).end();return;}
    if(req.method==="MKCOL"){res.writeHead(201).end();return;}
    if(req.method==="PUT"){
      if((req.headers["if-none-match"] && old)||(req.headers["if-match"] && req.headers["if-match"]!==etag)){res.writeHead(412).end();return;}
      files.set(key,body);res.writeHead(201,{ETag:`"${createHash("sha256").update(body).digest("hex")}"`}).end();return;
    }
    if(req.method==="GET"){if(old)res.writeHead(200,{ETag:etag!,"Content-Length":old.length}).end(old);else res.writeHead(404).end();return;}
    if(req.method==="DELETE"){if(deletionPause?.path===key){const pause=deletionPause;deletionPause=null;pause.entered();await pause.resume;}files.delete(key);res.writeHead(204).end();return;}
    res.writeHead(405).end();
  });
  return {server,files,pauseDelete:(path:string)=>{
    let entered!:()=>void;let release!:()=>void;const blocked=new Promise<void>((resolve)=>{entered=resolve;});const resume=new Promise<void>((resolve)=>{release=resolve;});
    deletionPause={path,entered,resume};return{blocked,release};
  }};
}

describe.skipIf(!executable)("real native Git/WebDAV + Zstd + SQLite round trip",()=>{
  let host:Host;let root:string;const hosts:Host[]=[];const databases:MemorySqliteBackend[]=[];
  beforeAll(async()=>{root=await mkdtemp(path.join(tmpdir(),"chronoeon-native-sync-"));host=new Host();});
  afterAll(async()=>{
    for(const db of databases)await db.close();await host.close();for(const worker of hosts)await worker.close();
    if(!path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep)||!path.basename(root).startsWith("chronoeon-native-sync-"))throw new Error("Unsafe test cleanup path");
    await rm(root,{recursive:true,force:true});
  });
  it.each(["git","webdav"] as const)("rebuilds a device, merges offline edits/messages and compacts safely using %s",async(mode)=>{
    const folder=path.join(root,mode);await mkdir(folder,{recursive:true});
    const dav=webdavServer();let url="";
    if(mode==="webdav"){
      await new Promise<void>((resolve)=>dav.server.listen(0,"127.0.0.1",resolve));
      const address=dav.server.address() as {port:number};url=`http://127.0.0.1:${address.port}/ChronoEon/`;
    }
    const remote=path.join(folder,"remote.git");if(mode==="git")execFileSync("git",["init","--bare","--initial-branch=main",remote],{windowsHide:true,stdio:"pipe"});
    const config:SyncConfig={mode,gitRemote:remote,gitToken:"",webdavUrl:url,webdavUsername:"test",webdavPassword:"test"};
    let now=new Date("2026-09-07T12:00:00Z");
    async function device(name:string){
      const cache=path.join(folder,name,"cache");const images=path.join(folder,name,"attachments");await mkdir(images,{recursive:true});
      const db=await MemorySqliteBackend.open([]);databases.push(db);const store=await SqliteEntryStore.create(db);const sync=new SyncStore(db);
      const worker=new Host();hosts.push(worker);
      const backend:SyncBackend={id:`${mode}:${mode==="git"?remote:url}`,fetch:(known)=>worker.request<RemoteFetch>({op:"fetch",config,cache,images,known}),publish:(publication)=>worker.request<{conflict:boolean}>({op:"publish",config,cache,images,publication})};
      const engine=new SyncEngine(sync,backend,{deviceName:name,now:()=>now});return{cache,images,store,sync,engine,chat:new AiConversationStore(db),backend};
    }
    try {
      const a=await device("A");const b=await device("B");
      const photo=await host.request<AttachmentMetadata>({op:"photo",config,cache:a.cache,images:a.images});expect(photo.bytes).toBeLessThanOrEqual(100000);
      const reference=`attachments/${photo.sha256}.webp`;
      const first=await a.store.create({id:createEntryId(),kind:"idea",title:"日记",note:"第一行\n第二行",date:"2026-09-07",allDay:true,category:"general",color:"#77787b",createdAt:now.toISOString(),images:[reference],tags:["diary"]});
      await a.sync.completeAttachmentMetadata([photo.sha256],[photo]);
      const conversation=await a.chat.createConversation({providerKind:"openai-compatible",title:"One conversation"});
      const firstMessage=await a.chat.appendMessage(conversation.id,{role:"user",content:"你好\nnew line"});
      await a.engine.run();await b.engine.run();
      const transferred=await readFile(path.join(b.images,`${photo.sha256}.webp`));expect(createHash("sha256").update(transferred).digest("hex")).toBe(photo.sha256);
      expect((await b.store.get(first.id))?.note).toBe("第一行\n第二行");expect((await b.chat.listMessages(conversation.id))[0].id).toBe(firstMessage.id);
      await a.store.update({...first,title:"A edits the title"});await b.store.update({...(await b.store.get(first.id))!,note:"B edits the diary\nwithout flattening lines"});
      const aMessage=await a.chat.appendMessage(conversation.id,{role:"assistant",content:"A message"});const bMessage=await b.chat.appendMessage(conversation.id,{role:"user",content:"B message"});
      await a.engine.run();await b.engine.run();await a.engine.run();
      expect(await a.store.get(first.id)).toMatchObject({title:"A edits the title",note:"B edits the diary\nwithout flattening lines"});
      expect((await a.chat.listMessages(conversation.id)).map((message)=>message.id).sort()).toEqual([firstMessage.id,aMessage.id,bMessage.id].sort());
      // Force a real compare-and-swap race between fetch and publication.
      await b.store.update({...(await b.store.get(first.id))!,location:"from B"});
      const publish=b.backend.publish;let raced=false;
      b.backend.publish=async(publication:Publication)=>{
        if(!raced){raced=true;await a.store.update({...(await a.store.get(first.id))!,tags:["diary","from A"]});await a.engine.run();}
        return publish(publication);
      };
      await b.engine.run();await a.engine.run();expect(raced).toBe(true);
      expect(await a.store.get(first.id)).toMatchObject({location:"from B",tags:["diary","from A"]});
      now=new Date("2026-09-23T12:00:00Z");await a.store.update({...(await a.store.get(first.id))!,images:[]});await a.engine.run();
      const beforeAck=await a.backend.fetch(await a.sync.knownDocuments());expect(beforeAck.index!.snapshot!.generation).toBe(2);
      expect(beforeAck.index!.retired.some((ref)=>ref.path===reference)).toBe(true);
      const c=await device("C");await c.engine.run();expect((await c.store.get(first.id))?.images??[]).toEqual([]);
      expect(await c.chat.listMessages(conversation.id)).toHaveLength(3);
      if(mode==="webdav") {
        const pause=dav.pauseDelete(`/ChronoEon/${reference}`);
        const collecting=b.engine.run();
        try {
          await pause.blocked;
          await a.store.update({...((await a.store.get(first.id))!),images:[reference]});
          await expect(a.engine.run()).rejects.toThrow("SYNC_REMOTE_BUSY");
        } finally {pause.release();await collecting;}
        await a.engine.run();await c.engine.run();
        expect((await c.store.get(first.id))?.images).toEqual([reference]);
        expect(dav.files.has(`/ChronoEon/${reference}`)).toBe(true);
      } else await b.engine.run();
      const afterAck=await b.backend.fetch(await b.sync.knownDocuments());expect(afterAck.index!.retired).toEqual([]);
      if(mode==="git"){
        const files=execFileSync("git",["--git-dir",remote,"ls-tree","-r","--name-only","main"],{encoding:"utf8",windowsHide:true});
        expect(files).not.toMatch(/\.db|\.sqlite|data\//);expect(files).not.toContain(reference);
        expect(files.split("\n").filter(Boolean).every((file)=>file==="index.json"||file.endsWith(".jsonl.zst")||/^attachments\/[a-f0-9]{64}\.webp$/.test(file))).toBe(true);
        expect(execFileSync("git",["--git-dir",path.join(a.cache,"git"),"config","--get","rerere.enabled"],{encoding:"utf8",windowsHide:true}).trim()).toBe("true");
      }
    } finally {if(mode==="webdav"){dav.server.closeAllConnections();await new Promise<void>((resolve)=>dav.server.close(()=>resolve()));}}
  },90000);
});
