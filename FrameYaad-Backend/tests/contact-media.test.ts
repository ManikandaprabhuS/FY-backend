import {randomUUID} from "node:crypto";
import request from "supertest";
import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({auth:vi.fn(),user:vi.fn(),raw:vi.fn(),exec:vi.fn(),tx:vi.fn(),audit:vi.fn(),upload:vi.fn(),remove:vi.fn(),list:vi.fn(),hero:vi.fn()}));
vi.mock("../src/config/supabase",()=>({supabaseAdmin:{auth:{getUser:m.auth},storage:{from:()=>({upload:m.upload,remove:m.remove,list:m.list,getPublicUrl:(path:string)=>({data:{publicUrl:"https://public.test/"+path}})})}},createUserSupabaseClient:vi.fn()}));
vi.mock("../src/prisma/client",()=>({prisma:{user:{findUnique:m.user,update:vi.fn()},$queryRawUnsafe:m.raw,$executeRawUnsafe:m.exec,$transaction:m.tx}}));
vi.mock("../src/modules/site-media/site-media.service",()=>({getHeroVideo:m.hero,replaceHeroVideo:vi.fn(),removeHeroVideo:vi.fn(),clearHeroVideoCache:vi.fn()}));
import {app} from "../src/app";
import {validateContactFile,contactDetailsSchema,CONTACT_VIDEO_MAX,CONTACT_IMAGE_MAX} from "../src/modules/contact-media/contact-media.validation";
import {replaceContactMedia,removeContactMedia,publicContactMedia,invalidateContactMedia,cleanupContactMedia} from "../src/modules/contact-media/contact-media.service";
type Row={key:string;data:Record<string,unknown>;updatedBy:string|null;updatedAt:Date};
let state:Row[],objects:Set<string>;
const id=randomUUID(),actor={id,name:"Staff",role:"ADMIN" as const},headers={Authorization:"Bearer test"};
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS2sAAAAASUVORK5CYII=","base64");
const jpg=Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,218,0,8,1,1,0,0,63,0,0,255,217]);
const webp=Buffer.concat([Buffer.from("RIFF"),Buffer.from([18,0,0,0]),Buffer.from("WEBPVP8L"),Buffer.from([5,0,0,0]),Buffer.from([47,0,0,0,0,0])]);
const box=(type:string,payload:Buffer)=>{const h=Buffer.alloc(8);h.writeUInt32BE(payload.length+8);h.write(type,4,"ascii");return Buffer.concat([h,payload]);};
const mp4=Buffer.concat([box("ftyp",Buffer.from("isom0000mp42")),box("moov",Buffer.from("metadata")),box("mdat",Buffer.from("video-data"))]);
const webm=Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3,0x42,0x82,0x84]),Buffer.from("webm"),Buffer.from([0x18,0x53,0x80,0x67,0x16,0x54,0xae,0x6b]),Buffer.from("V_VP8"),Buffer.from([0x1f,0x43,0xb6,0x75,0,1])]);
const file=(buffer:Buffer)=>({buffer,size:buffer.length,originalname:"../../client.exe",mimetype:"application/octet-stream"} as Express.Multer.File);
beforeEach(()=>{
 vi.clearAllMocks();invalidateContactMedia();objects=new Set();
 state=["storyboard_video","custom_framing_banner","contact_details"].map(key=>({key,data:{},updatedBy:null,updatedAt:new Date()}));
 m.raw.mockImplementation((_sql:string,key?:string)=>Promise.resolve(structuredClone(key?state.filter(row=>row.key===key):state)));
 m.exec.mockImplementation((_sql:string,data:string,by:string,key:string)=>{const row=state.find(r=>r.key===key)!;row.data=JSON.parse(data) as Record<string,unknown>;row.updatedBy=by;return Promise.resolve(1);});
 m.tx.mockImplementation(async(callback:(tx:unknown)=>Promise<unknown>)=>{const before=structuredClone(state);try{return await callback({$queryRawUnsafe:m.raw,$executeRawUnsafe:m.exec,offerAudit:{create:m.audit}});}catch(error){state=before;throw error;}});
 m.audit.mockResolvedValue({});m.hero.mockResolvedValue({url:"https://public.test/home.mp4",updatedAt:null});
 m.upload.mockImplementation((path:string)=>{objects.add(path);return Promise.resolve({error:null});});
 m.remove.mockImplementation((paths:string[])=>{paths.forEach(path=>objects.delete(path));return Promise.resolve({error:null});});
 m.auth.mockResolvedValue({data:{user:{id,email_confirmed_at:"2026-01-01"}},error:null});
 m.user.mockResolvedValue({id,name:"Staff",role:"ADMIN",isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
});
it.each([[mp4,"mp4"],[webm,"webm"]])("verifies %s video by bytes, not a claimed MIME or filename",(bytes,ext)=>expect(validateContactFile("video",file(bytes)).ext).toBe(ext));
it.each([[png,"png"],[jpg,"jpg"],[webp,"webp"]])("verifies supported image bytes",(bytes,ext)=>expect(validateContactFile("banner",file(bytes)).ext).toBe(ext));
it.each([undefined,Buffer.alloc(0),Buffer.from("%PDF-1.7"),Buffer.from("MZ executable"),Buffer.from("<svg/>"),Buffer.from("GIF89a")])("rejects missing, empty and disallowed image uploads",bytes=>expect(()=>validateContactFile("banner",bytes?file(bytes):undefined)).toThrow());
it.each([Buffer.from("%PDF"),Buffer.from("MZ"),png,Buffer.from("RIFFxxxxAVI ")])("rejects non-MP4/WebM video bytes",bytes=>expect(()=>validateContactFile("video",file(bytes))).toThrow());
it("accepts exactly 2 MB, rejects 2 MB plus one",()=>{
 expect(validateContactFile("banner",file(Buffer.concat([jpg,Buffer.alloc(CONTACT_IMAGE_MAX-jpg.length)]))).ext).toBe("jpg");
 expect(()=>validateContactFile("banner",file(Buffer.alloc(CONTACT_IMAGE_MAX+1)))).toThrowError(expect.objectContaining({statusCode:413}));
});
it("accepts exactly 50 MB, rejects 50 MB plus one",()=>{
 const pad=box("free",Buffer.alloc(CONTACT_VIDEO_MAX-mp4.length-8));
 expect(validateContactFile("video",file(Buffer.concat([mp4,pad]))).ext).toBe("mp4");
 expect(()=>validateContactFile("video",file(Buffer.alloc(CONTACT_VIDEO_MAX+1)))).toThrowError(expect.objectContaining({statusCode:413}));
});
it("public guests and token-bearing visitors see identical cached safe content",async()=>{
 const guest=await request(app).get("/api/v1/site/contact-media");
 const logged=await request(app).get("/api/v1/site/contact-media").set("Authorization","Bearer expired");
 expect(guest.status).toBe(200);expect(logged.body).toEqual(guest.body);
 expect(guest.headers["cache-control"]).toContain("max-age=60");expect(m.auth).not.toHaveBeenCalled();expect(m.raw).toHaveBeenCalledTimes(1);
 expect(guest.body).toMatchObject({data:{videoUrl:null,defaultVideoUrl:"https://public.test/home.mp4"}});
 expect(JSON.stringify(guest.body)).not.toContain("updatedBy");
});
it.each(["ADMIN","EMPLOYEE"])("allows verified %s uploads",async role=>{
 m.user.mockResolvedValue({id,name:"Staff",role,isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 const result=await request(app).put("/api/v1/admin/contact-settings/media/banner").set(headers).attach("file",png,"image.png");
 expect(result.status).toBe(201);expect(objects.size).toBe(1);
 expect(JSON.stringify(result.body)).not.toContain('"path"');expect(m.audit).toHaveBeenCalled();
});
it("rejects guest/customer mutations before reading file contents",async()=>{
 expect((await request(app).put("/api/v1/admin/contact-settings/media/video").attach("file",mp4,"video.mp4")).status).toBe(401);
 m.user.mockResolvedValue({id,name:"Customer",role:"CUSTOMER",isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 expect((await request(app).put("/api/v1/admin/contact-settings/media/banner").set(headers).attach("file",png,"a.png")).status).toBe(403);
 expect(m.upload).not.toHaveBeenCalled();
});
it("replacement removes the previous object; removal restores null/defaults and invalidates cache",async()=>{
 await replaceContactMedia("video",file(mp4),actor);const first=[...objects][0]!;
 expect((await publicContactMedia()).videoUrl).not.toBeNull();
 await replaceContactMedia("video",file(webm),actor);expect(objects.has(first)).toBe(false);expect(objects.size).toBe(1);
 await removeContactMedia("video",actor);expect(objects.size).toBe(0);expect((await publicContactMedia()).videoUrl).toBeNull();
 expect((await publicContactMedia()).defaultVideoUrl).toBe("https://public.test/home.mp4");
});
it("rolls back a new object when the settings transaction fails",async()=>{
 m.audit.mockRejectedValueOnce(new Error("database failed"));
 await expect(replaceContactMedia("banner",file(png),actor)).rejects.toMatchObject({statusCode:503});
 expect(objects.size).toBe(0);expect(state.find(row=>row.key==="custom_framing_banner")?.data).toEqual({});
});
it("returns clear 400/413/415 errors for invalid multipart",async()=>{
 expect((await request(app).put("/api/v1/admin/contact-settings/media/banner").set(headers)).status).toBe(400);
 expect((await request(app).put("/api/v1/admin/contact-settings/media/banner").set(headers).attach("file",Buffer.from("<svg/>"),"a.jpg")).status).toBe(415);
 expect((await request(app).put("/api/v1/admin/contact-settings/media/banner").set(headers).attach("file",Buffer.alloc(CONTACT_IMAGE_MAX+1),"a.jpg")).status).toBe(413);
});
it("whitelists and validates public contact details, including intentional empty values",()=>{
 expect(contactDetailsSchema.safeParse({phone:"",email:"",studioName:"",address:""}).success).toBe(true);
 expect(contactDetailsSchema.safeParse({phone:"+91 98765 43210",email:"support@example.com",studioName:"FrameYaad",address:"A real studio address"}).success).toBe(true);
 for(const value of [{phone:"abc",email:"",studioName:"",address:""},{phone:"",email:"bad",studioName:"",address:""},{phone:"",email:"",studioName:"<script>",address:""},{phone:"",email:"",studioName:"",address:"",role:"ADMIN"}])expect(contactDetailsSchema.safeParse(value).success).toBe(false);
});

it("orphan cleanup removes only stale unreferenced generated Contact files",async()=>{
 await replaceContactMedia("banner",file(png),actor);
 const active=[...objects][0]!,orphan="contact/banner/"+(Date.now()-7200000)+"-"+randomUUID()+".png";objects.add(orphan);
 m.list.mockImplementation((folder:string)=>Promise.resolve({error:null,data:[...objects].filter(path=>path.startsWith(folder+"/")).map(path=>({name:path.slice(folder.length+1),created_at:new Date(Date.now()-7200000).toISOString()}))}));
 await cleanupContactMedia();expect(objects.has(active)).toBe(true);expect(objects.has(orphan)).toBe(false);
});
