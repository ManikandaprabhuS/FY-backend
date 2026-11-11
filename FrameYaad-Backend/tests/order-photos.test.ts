import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  auth: vi.fn(), user: vi.fn(), transaction: vi.fn(), find: vi.fn(), findFirst: vi.fn(), create: vi.fn(), removeRecord: vi.fn(), update: vi.fn(),
  upload: vi.fn(), remove: vi.fn(), copy: vi.fn(), list: vi.fn(), signed: vi.fn(), order: vi.fn(), raw: vi.fn(),
}));
vi.mock("../src/config/supabase", () => ({
  supabaseAdmin: {auth: {getUser: m.auth}, storage: {from: () => ({upload:m.upload,remove:m.remove,copy:m.copy,list:m.list,createSignedUrl:m.signed})}},
  createUserSupabaseClient: vi.fn(),
}));
vi.mock("../src/prisma/client", () => ({prisma: {
  user:{findUnique:m.user,findUniqueOrThrow:m.user,update:vi.fn()},
  orderPhoto:{findFirst:m.findFirst,findUnique:m.find,create:m.create,delete:m.removeRecord,update:m.update},
  order:{findUnique:m.order},$transaction:m.transaction,
}}));
import {app} from "../src/app";
import {uploadPhoto, reserveOrderPhoto, downloadPhoto, finishPhotoAttachment, enqueuePhotoAttachment} from "../src/modules/order-photos/order-photos.service";
import {PHOTO_MAX_BYTES,photoFileName,sanitizePhotoPart,verifiedPhotoType} from "../src/modules/order-photos/photo-file";
const owner=randomUUID(), other=randomUUID(), orderId=randomUUID();
type Photo={id:string;userId:string;orderId:string|null;status:string;fileName:string;storagePath:string;sizeBytes:number;mimeType:string;attachedAt?:Date};
let rows:Photo[], objects:Set<string>;
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS2sAAAAASUVORK5CYII=","base64");
// A structural JPEG marker fixture: SOI, SOF, SOS, scan bytes, EOI.
const jpg=Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,218,0,8,1,1,0,0,63,0,0,255,217]);
const webp=Buffer.concat([Buffer.from("RIFF"),Buffer.from([18,0,0,0]),Buffer.from("WEBPVP8L"),Buffer.from([5,0,0,0]),Buffer.from([47,0,0,0,0,0])]);
const file=(buffer=png,originalname="wedding photo.JPG")=>({buffer,size:buffer.length,originalname,mimetype:"application/octet-stream"} as Express.Multer.File);
const headers={Authorization:"Bearer test"};
const profile=(role="CUSTOMER",id=owner)=>({id,role,name:"Mani",isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
beforeEach(()=>{
 vi.clearAllMocks();rows=[];objects=new Set();
 m.auth.mockResolvedValue({data:{user:{id:owner,email_confirmed_at:"2026-01-01",phone_confirmed_at:null}},error:null});
 m.user.mockResolvedValue(profile());
 m.findFirst.mockImplementation(({where}:{where:{id?:string;userId?:string;status?:string;orderId?:null}})=>Promise.resolve(rows.find(p=>(!where.id||p.id===where.id)&&(!where.userId||p.userId===where.userId)&&(!where.status||p.status===where.status)&&(where.orderId!==null||p.orderId===null))??null));
 m.find.mockImplementation(({where}:{where:{orderId:string}})=>Promise.resolve(rows.find(p=>p.orderId===where.orderId)??null));
 m.create.mockImplementation(({data}:{data:Photo})=>{const p={...data,orderId:null};rows.push(p);return Promise.resolve(p);});
 m.removeRecord.mockImplementation(({where}:{where:{id:string}})=>{rows=rows.filter(p=>p.id!==where.id);return Promise.resolve({});});
 m.update.mockImplementation(({where,data}:{where:{id:string};data:Partial<Photo>})=>{const row=rows.find(p=>p.id===where.id)!;Object.assign(row,data);return Promise.resolve(row);});
 m.transaction.mockImplementation(async(fn:(tx:unknown)=>Promise<unknown>)=>{const backup=structuredClone(rows);try{return await fn({orderPhoto:{findFirst:m.findFirst,create:m.create,delete:m.removeRecord,update:m.update},$queryRawUnsafe:m.raw});}catch(e){rows=backup;throw e;}});
 m.upload.mockImplementation((path:string)=>{if(objects.has(path))return Promise.resolve({error:{statusCode:409}});objects.add(path);return Promise.resolve({data:{},error:null});});
 m.remove.mockImplementation((paths:string[])=>{paths.forEach(p=>objects.delete(p));return Promise.resolve({data:[],error:null});});
 m.copy.mockImplementation((from:string,to:string)=>{if(!objects.has(from))return Promise.resolve({error:{}});objects.add(to);return Promise.resolve({error:null});});
 m.list.mockResolvedValue({data:[],error:null});
 m.signed.mockResolvedValue({data:{signedUrl:"https://private.test/signed"},error:null});
 m.order.mockImplementation(()=>Promise.resolve({userId:owner,customerPhoto:rows[0]??null}));
});
const body=(response:{body:unknown})=>response.body as {data:{imageId:string;fileName:string;sizeBytes:number};error?:{message:string}};
describe("photo naming and bytes",()=>{
 it.each([[jpg,"image/jpeg","jpg"],[png,"image/png","png"],[webp,"image/webp","webp"]])("verifies the real type rather than the supplied extension", (bytes,mimeType,ext)=>expect(verifiedPhotoType(bytes as Buffer)).toEqual({mimeType,ext}));
 it("uses the verified extension and snapshot naming",()=>expect(photoFileName("Mani","wedding photo.JPG","jpg")).toBe("FY-Mani-wedding-photo.jpg"));
 it.each(["../../etc/passwd.png","a/b\\c.jpg","photo.jpg.exe","\u0000<>& தமிழ்.png"])("prevents traversal and unsafe names: %s",name=>expect(photoFileName(" /<Mani> /",name,"png")).toMatch(/^FY-[A-Za-z0-9_-]+\.png$/));
 it("handles Tamil, whitespace, empty and long profile names",()=>{expect(sanitizePhotoPart(" தமிழ் ",30,"Customer")).toBe("Customer");expect(sanitizePhotoPart(" Mani  Kumar ",30,"Customer")).toBe("Mani-Kumar");expect(sanitizePhotoPart("x".repeat(100),30,"Customer")).toHaveLength(30);expect(photoFileName("","...","jpg")).toBe("FY-Customer-photo.jpg");});
 it.each([Buffer.alloc(0),Buffer.from("MZ executable"),Buffer.from("%PDF"),Buffer.from("<svg/>"),Buffer.from("GIF89a"),png.subarray(0,30)])("rejects empty, non-images and damaged images",bytes=>expect(()=>verifiedPhotoType(bytes)).toThrow());
 it("accepts exactly 4 MB and rejects 4 MB plus one byte",()=>{expect(verifiedPhotoType(Buffer.concat([jpg,Buffer.alloc(PHOTO_MAX_BYTES-jpg.length)])).ext).toBe("jpg");expect(()=>verifiedPhotoType(Buffer.alloc(PHOTO_MAX_BYTES+1))).toThrow(expect.objectContaining({statusCode:413}));});
});
describe("authenticated multipart API",()=>{
 it.each([[jpg,"test.jpg"],[png,"test.png"],[webp,"test.webp"]])("uploads a supported file without disclosing private paths",async(buffer,name)=>{
 const response=await request(app).post("/api/v1/order-photos").set(headers).attach("photo",buffer,name);expect(response.status).toBe(201);
 expect(body(response).data.imageId).toMatch(/^[0-9a-f-]{36}$/);expect(body(response).data.fileName).toMatch(/^FY-Mani-/);expect(body(response).data.sizeBytes).toBe(buffer.length);
 expect(JSON.stringify(response.body)).not.toContain("storagePath");expect(rows).toHaveLength(1);
 });
 it("requires login",async()=>expect((await request(app).post("/api/v1/order-photos").attach("photo",png,"test.png")).status).toBe(401));
 it.each(["ADMIN","EMPLOYEE"])("rejects %s uploads",async role=>{m.user.mockResolvedValue(profile(role));expect((await request(app).post("/api/v1/order-photos").set(headers).attach("photo",png,"x.png")).status).toBe(403);});
 it("rejects missing file",async()=>expect((await request(app).post("/api/v1/order-photos").set(headers)).status).toBe(400));
 it("accepts a multipart photo of exactly 4 MB",async()=>expect((await request(app).post("/api/v1/order-photos").set(headers).attach("photo",Buffer.concat([jpg,Buffer.alloc(PHOTO_MAX_BYTES-jpg.length)]),"exact.jpg")).status).toBe(201));
 it("rejects oversized multipart with 413",async()=>expect((await request(app).post("/api/v1/order-photos").set(headers).attach("photo",Buffer.alloc(PHOTO_MAX_BYTES+1),"big.png")).status).toBe(413));
 it("replaces the previous TEMP file and suffixes the same name",async()=>{const a=await uploadPhoto(owner,file()),b=await uploadPhoto(owner,file());expect(a.imageId).not.toBe(b.imageId);expect(b.fileName).toMatch(/-2\.png$/);expect(rows).toHaveLength(1);expect(objects.size).toBe(1);});
 it("clears only the owner's TEMP record",async()=>{const p=await uploadPhoto(owner,file());expect((await request(app).delete("/api/v1/order-photos/"+p.imageId).set(headers)).status).toBe(200);expect(rows).toHaveLength(0);expect(objects.size).toBe(0);});
 it("rejects clearing another customer's or attached file",async()=>{await uploadPhoto(owner,file());rows[0]!.userId=other;expect((await request(app).delete("/api/v1/order-photos/"+rows[0]!.id).set(headers)).status).toBe(404);rows[0]!.userId=owner;rows[0]!.status="ATTACHED";expect((await request(app).delete("/api/v1/order-photos/"+rows[0]!.id).set(headers)).status).toBe(404);});
 it("compensates a failed DB write without losing the previous TEMP photo",async()=>{await uploadPhoto(owner,file());const old=rows[0]!.id;m.create.mockRejectedValueOnce(new Error("db"));await expect(uploadPhoto(owner,file())).rejects.toThrow();expect(rows[0]!.id).toBe(old);expect(objects.size).toBe(1);});
 it("isolates customers with the same readable name",async()=>{await uploadPhoto(owner,file());await uploadPhoto(other,file());expect(objects.size).toBe(2);expect(rows.map(p=>p.userId)).toEqual([owner,other]);});
});
describe("attachment and download ownership",()=>{
 it("accepts only an owned TEMP image",async()=>{
  const p=await uploadPhoto(owner,file());const tx={orderPhoto:{findFirst:m.findFirst},$queryRawUnsafe:m.raw};
  await expect(reserveOrderPhoto(tx as never,other,p.imageId)).rejects.toMatchObject({statusCode:400});
  expect((await reserveOrderPhoto(tx as never,owner,p.imageId))?.id).toBe(p.imageId);
  rows[0]!.status="ATTACHED";await expect(reserveOrderPhoto(tx as never,owner,p.imageId)).rejects.toMatchObject({statusCode:400});
  expect(await reserveOrderPhoto(tx as never,owner)).toBeNull();
 });
 it("moves an attached photo to its order folder without overwriting",async()=>{await uploadPhoto(owner,file());rows[0]!.status="ATTACHED";rows[0]!.orderId=orderId;await finishPhotoAttachment(orderId);expect(rows[0]!.storagePath).toContain("/"+orderId+"/");expect(objects.size).toBe(1);});
 it.each(["CUSTOMER","ADMIN","EMPLOYEE"])("issues a short-lived forced download for %s",async role=>{await uploadPhoto(owner,file());await downloadPhoto(orderId,{id:owner,role});expect(m.signed).toHaveBeenCalledWith(rows[0]!.storagePath,60,{download:rows[0]!.fileName});});
 it("rejects another customer and an order without photo",async()=>{await uploadPhoto(owner,file());await expect(downloadPhoto(orderId,{id:other,role:"CUSTOMER"})).rejects.toMatchObject({statusCode:404});rows=[];await expect(downloadPhoto(orderId,{id:owner,role:"CUSTOMER"})).rejects.toMatchObject({statusCode:404});});
 it("does not reject the caller when a post-commit move fails",async()=>{await uploadPhoto(owner,file());rows[0]!.orderId=orderId;rows[0]!.status="ATTACHED";m.copy.mockResolvedValue({error:{}});expect(enqueuePhotoAttachment(orderId)).toBeUndefined();await new Promise(resolve=>setImmediate(resolve));expect(rows[0]!.storagePath).toContain("/temp/");});
 it("requires authentication for the download API",async()=>expect((await request(app).get("/api/v1/orders/"+orderId+"/photo/download-url")).status).toBe(401));
});
