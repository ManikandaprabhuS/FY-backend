import {randomUUID} from "node:crypto";
import {beforeEach,expect,it,vi} from "vitest";
import request from "supertest";
const m=vi.hoisted(()=>({find:vi.fn(),update:vi.fn(),audit:vi.fn(),remove:vi.fn(),copy:vi.fn(),signed:vi.fn(),tx:vi.fn(),query:vi.fn(),raw:vi.fn(),aggregate:vi.fn(),order:vi.fn(),auth:vi.fn(),user:vi.fn()}));
vi.mock("../src/prisma/client",()=>({prisma:{orderPhoto:{findUnique:m.find,aggregate:m.aggregate},photoCleanupAudit:{create:m.audit},order:{findUnique:m.order},user:{findUnique:m.user},$transaction:m.tx,$queryRaw:m.query,$queryRawUnsafe:m.raw}}));
vi.mock("../src/config/supabase",()=>({supabaseAdmin:{auth:{getUser:m.auth},storage:{from:()=>({remove:m.remove,copy:m.copy,createSignedUrl:m.signed})}},createUserSupabaseClient:vi.fn()}));
import {app} from "../src/app";
import {cleanupQuery,cleanupDelete,listCleanup,deleteCleanup} from "../src/modules/photo-cleanup/photo-cleanup.service";
import {storageMetrics,invalidateStorageMetrics} from "../src/modules/photo-cleanup/storage-metrics";
import {downloadPhoto,finishPhotoAttachment} from "../src/modules/order-photos/order-photos.service";
const actor={id:randomUUID(),name:"Cleanup Admin",role:"ADMIN"},owner=randomUUID();
type Photo={id:string;userId:string;orderId:string;status:string;storagePath:string;fileName:string;sizeBytes:number;deletedAt?:Date;deletedBy?:string;deletedByName?:string;order:{id:string;status:string}};
let rows:Photo[],files:Set<string>,audit:unknown[];
const photo=(status="DELIVERED"):Photo=>{const id=randomUUID(),orderId=randomUUID();return{id,userId:owner,orderId,status:"ATTACHED",storagePath:owner+"/"+orderId+"/FY-Customer-photo.jpg",fileName:"FY-Customer-photo.jpg",sizeBytes:1024,order:{id:orderId,status}};};
beforeEach(()=>{
 vi.clearAllMocks();invalidateStorageMetrics();rows=[photo()];files=new Set(rows.map(r=>r.storagePath));audit=[];
 m.find.mockImplementation(({where}:{where:{id?:string;orderId?:string}})=>Promise.resolve(rows.find(r=>where.id?r.id===where.id:r.orderId===where.orderId)??null));
 m.update.mockImplementation(({where,data}:{where:{id:string};data:Partial<Photo>})=>{const p=rows.find(r=>r.id===where.id)!;Object.assign(p,data);return Promise.resolve(p);});
 m.audit.mockImplementation((args:unknown)=>{audit.push(args);return Promise.resolve({});});
 m.remove.mockImplementation((paths:string[])=>{paths.forEach(p=>files.delete(p));return Promise.resolve({data:[],error:null});});
 m.tx.mockImplementation(async(fn:(tx:unknown)=>Promise<unknown>)=>{
  const backup=structuredClone(rows),oldAudit=[...audit];
  try{return await fn({orderPhoto:{findUnique:m.find,findFirst:m.find,update:m.update},photoCleanupAudit:{create:m.audit},$queryRawUnsafe:m.raw});}
  catch(e){rows=backup;audit=oldAudit;throw e;}
 });
 m.raw.mockResolvedValue([{bytes:10485760n}]);
 m.query.mockResolvedValue([]);
 m.aggregate.mockImplementation(({where}:{where:{status?:string|{not:string}}})=>{
  const available=rows.filter(r=>typeof where.status==="string"?r.status===where.status&&["DELIVERED","CANCELLED"].includes(r.order.status):r.status!=="DELETED");
  return Promise.resolve({_sum:{sizeBytes:available.reduce((n,r)=>n+r.sizeBytes,0)},_count:{_all:available.length}});
 });
 m.order.mockImplementation(()=>Promise.resolve({userId:owner,customerPhoto:rows[0]}));
 m.auth.mockResolvedValue({data:{user:{id:actor.id,email_confirmed_at:"2026-01-01"}},error:null});
 m.user.mockResolvedValue({...actor,isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
});
it.each(["DELIVERED","CANCELLED"])("deletes %s file first, retains a tombstone and audits actor/count/bytes",async status=>{
 rows[0]!.order.status=status;const id=rows[0]!.id;
 const result=await deleteCleanup({ids:[id],confirm:true},actor);
 expect(result).toMatchObject({deletedCount:1,bytesFreed:1024});expect(files.size).toBe(0);
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({status:"DELETED",storagePath:"",deletedBy:actor.id,deletedByName:actor.name});
 expect(rows[0]!.deletedAt).toBeInstanceOf(Date);expect(audit).toHaveLength(1);
 const entry=(audit[0] as {data:{count:number;bytesFreed:number;orderIds:string[]}}).data;
 expect(entry).toMatchObject({count:1,bytesFreed:1024,orderIds:[rows[0]!.orderId]});
 expect(m.remove.mock.invocationCallOrder[0]).toBeLessThan(m.update.mock.invocationCallOrder[0]!);
});
it.each(["PLACED","PROCESSING","READY_TO_SHIP","SHIPPED"])("rejects %s server-side without removing a file",async status=>{
 rows[0]!.order.status=status;
 const result=await deleteCleanup({ids:[rows[0]!.id],confirm:true},actor);
 expect(result.results[0]?.ok).toBe(false);expect(m.remove).not.toHaveBeenCalled();expect(rows[0]!.status).toBe("ATTACHED");
});
it("handles a mixed batch and a missing storage file independently",async()=>{
 rows.push(photo("PROCESSING"),photo("CANCELLED"));
 m.remove.mockResolvedValueOnce({data:null,error:{statusCode:"404"}});
 const result=await deleteCleanup({ids:rows.map(r=>r.id),confirm:true},actor);
 expect(result.results.map(r=>r.ok)).toEqual([true,false,true]);expect(result.deletedCount).toBe(2);expect(audit).toHaveLength(2);
});
it("repeats are idempotent with no extra deletion/audit/freed bytes",async()=>{
 const ids=[rows[0]!.id];await deleteCleanup({ids,confirm:true},actor);
 const result=await deleteCleanup({ids,confirm:true},actor);
 expect(result).toMatchObject({deletedCount:0,bytesFreed:0});expect(result.results[0]?.alreadyDeleted).toBe(true);
 expect(m.remove).toHaveBeenCalledTimes(1);expect(audit).toHaveLength(1);
});
it("storage failure keeps the record active and does not stop the next item",async()=>{
 rows.push(photo());m.remove.mockRejectedValueOnce(new Error("Storage unavailable"));
 const result=await deleteCleanup({ids:rows.map(r=>r.id),confirm:true},actor);
 expect(result.results.map(r=>r.ok)).toEqual([false,true]);expect(rows[0]!.status).toBe("ATTACHED");expect(audit).toHaveLength(1);
});
it("a failed DB write after removal can be safely retried with the missing file",async()=>{
 const ids=[rows[0]!.id];m.update.mockRejectedValueOnce(new Error("DB failed"));
 expect((await deleteCleanup({ids,confirm:true},actor)).results[0]?.ok).toBe(false);
 expect(rows[0]!.status).toBe("ATTACHED");expect(files.size).toBe(0);expect(audit).toHaveLength(0);
 expect((await deleteCleanup({ids,confirm:true},actor)).results[0]?.ok).toBe(true);expect(audit).toHaveLength(1);
});
it("caps batches at 50, requires explicit confirmation and never trusts actor fields",()=>{
 expect(cleanupDelete.safeParse({ids:Array.from({length:51},()=>randomUUID()),confirm:true}).success).toBe(false);
 expect(cleanupDelete.safeParse({ids:[randomUUID()]}).success).toBe(false);
 expect(cleanupDelete.safeParse({ids:[randomUUID()],confirm:true,userId:owner}).success).toBe(false);
});
it("lists only eligible attachments and uses parameterized filters, total size and pagination",async()=>{
 m.query.mockResolvedValueOnce([{id:rows[0]!.id}]).mockResolvedValueOnce([{total:25n,bytes:2048n}]);
 const result=await listCleanup({page:2,limit:20,status:"DELIVERED",search:"';DROP TABLE users--",from:"2026-11-01",to:"2026-11-14"},actor);
 const sql=m.query.mock.calls[0]?.[0] as {sql:string;values:unknown[]};
 expect(sql.sql).toContain("p.status='ATTACHED'");expect(sql.sql).toContain("'DELIVERED','CANCELLED'");
 expect(sql.sql).not.toContain("DROP TABLE");expect(sql.values.some(v=>typeof v==="string"&&v.includes("DROP TABLE"))).toBe(true);
 expect(result.pagination).toMatchObject({page:2,total:25});expect(result.totalBytes).toBe(2048);
 expect(cleanupQuery.safeParse({from:"2026-12-01",to:"2026-11-01"}).success).toBe(false);
});
it("returns 410 only to the owner or staff and never signs a deleted photo",async()=>{
 rows[0]!.status="DELETED";rows[0]!.storagePath="";
 await expect(downloadPhoto(rows[0]!.orderId,{id:owner,role:"CUSTOMER"})).rejects.toMatchObject({statusCode:410});
 await expect(downloadPhoto(rows[0]!.orderId,actor)).rejects.toMatchObject({statusCode:410});
 await expect(downloadPhoto(rows[0]!.orderId,{id:randomUUID(),role:"CUSTOMER"})).rejects.toMatchObject({statusCode:404});
 expect(m.signed).not.toHaveBeenCalled();await finishPhotoAttachment(rows[0]!.orderId);expect(m.copy).not.toHaveBeenCalled();
});
it("metrics cache coalesces reads, tolerates unavailable DB size and invalidates after deletion",async()=>{
 const before=await storageMetrics();await storageMetrics();expect(m.aggregate).toHaveBeenCalledTimes(2);expect(before.photos.bytes).toBe(1024);
 await deleteCleanup({ids:[rows[0]!.id],confirm:true},actor);
 const after=await storageMetrics();expect(after.photos.bytes).toBe(0);expect(after.pending.count).toBe(0);
 m.raw.mockRejectedValue(new Error("Private DB connection error"));
 const unavailable=await storageMetrics(true);expect(unavailable.database.bytes).toBeNull();expect(unavailable.photos.bytes).toBe(0);
 expect(JSON.stringify(unavailable)).not.toContain("connection error");
});
it.each(["CUSTOMER","guest"])("rejects %s callers for cleanup and storage APIs",async role=>{
 if(role==="CUSTOMER")m.user.mockResolvedValue({...actor,role,isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 const headers=role==="guest"?{}:{Authorization:"Bearer test"};
 for(const path of ["/admin/photo-cleanup","/admin/storage-usage"])expect((await request(app).get("/api/v1"+path).set(headers)).status).toBe(role==="guest"?401:403);
 expect((await request(app).post("/api/v1/admin/photo-cleanup/delete").set(headers).send({ids:[rows[0]!.id],confirm:true})).status).toBe(role==="guest"?401:403);
 expect(m.remove).not.toHaveBeenCalled();
});
it.each(["ADMIN","EMPLOYEE"])("allows %s to list cleanup photos",async role=>{
 m.user.mockResolvedValue({...actor,role,isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 m.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{total:0n,bytes:0n}]);
 expect((await request(app).get("/api/v1/admin/photo-cleanup").set("Authorization","Bearer test")).status).toBe(200);
});
