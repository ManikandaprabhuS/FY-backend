import {randomUUID} from "node:crypto";
import request from "supertest";
import {beforeEach,afterAll,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({auth:vi.fn(),user:vi.fn(),find:vi.fn(),offer:vi.fn(),update:vi.fn(),audit:vi.fn(),tx:vi.fn(),upload:vi.fn(),remove:vi.fn(),list:vi.fn()}));
vi.mock("../src/config/supabase",()=>({supabaseAdmin:{auth:{getUser:m.auth},storage:{from:()=>({upload:m.upload,remove:m.remove,list:m.list,getPublicUrl:(path:string)=>({data:{publicUrl:"https://public.test/"+path}})})}},createUserSupabaseClient:vi.fn()}));
vi.mock("../src/prisma/client",()=>({prisma:{user:{findUnique:m.user},homepageBanner:{findUnique:m.find,findUniqueOrThrow:m.find},offer:{findUnique:m.offer},$transaction:m.tx}}));
import {app} from "../src/app";
import {replaceBannerImage,removeBannerImage,validateBannerImage} from "../src/modules/home-banner/banner-image.service";
import {getAdminBanner,publicHomepageBanner} from "../src/modules/home-banner/home-banner.service";
import {invalidateHomepageBanner} from "../src/modules/home-banner/banner-cache";
let state:{enabled:boolean;featuredOfferCode:string;bannerImageUrl:string|null;bannerImagePath:string|null;updatedBy:string|null};
let objects:Set<string>,clock=Date.now();
const id=randomUUID(),actor={id,name:"Staff",role:"ADMIN" as const};
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS2sAAAAASUVORK5CYII=","base64");
const jpg=Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,218,0,8,1,1,0,0,63,0,0,255,217]);
const webp=Buffer.concat([Buffer.from("RIFF"),Buffer.from([18,0,0,0]),Buffer.from("WEBPVP8L"),Buffer.from([5,0,0,0]),Buffer.from([47,0,0,0,0,0])]);
const file=(buffer=png)=>({buffer,size:buffer.length,originalname:"../../client-name.exe",mimetype:"application/octet-stream"} as Express.Multer.File);
const headers={Authorization:"Bearer test"};
beforeEach(()=>{
 vi.clearAllMocks();clock+=61000;vi.spyOn(Date,"now").mockImplementation(()=>clock);
 state={enabled:true,featuredOfferCode:"BIG_ORDER",bannerImageUrl:null,bannerImagePath:null,updatedBy:null};objects=new Set();invalidateHomepageBanner();
 m.auth.mockResolvedValue({data:{user:{id,email_confirmed_at:"2026-01-01"}},error:null});

 m.user.mockResolvedValue({id,name:"Staff",role:"ADMIN",isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 m.find.mockImplementation(()=>Promise.resolve({...state}));
 m.offer.mockResolvedValue({enabled:true,code:"BIG_ORDER",title:"Big Order Offer",percentage:10,minOrderAmount:5000});
 m.update.mockImplementation(({data}:{data:Partial<typeof state>})=>{Object.assign(state,data);return Promise.resolve({...state});});
 m.audit.mockResolvedValue({});
 m.tx.mockImplementation(async(fn:(tx:unknown)=>Promise<unknown>)=>{const before={...state};try{return await fn({$queryRawUnsafe:vi.fn(),homepageBanner:{findUniqueOrThrow:m.find,update:m.update},offerAudit:{create:m.audit}});}catch(error){state=before;throw error;}});
 m.upload.mockImplementation((path:string)=>{objects.add(path);return Promise.resolve({error:null});});
 m.remove.mockImplementation((paths:string[])=>{paths.forEach(path=>objects.delete(path));return Promise.resolve({error:null});});
});
afterAll(()=>vi.restoreAllMocks());
it.each([[jpg,"a.jpg"],[png,"a.png"],[webp,"a.webp"]])("uploads a supported image with a server-only filename",async(buffer,name)=>{
 const response=await request(app).post("/api/v1/admin/homepage-banner/image").set(headers).attach("image",buffer,name);
 expect(response.status).toBe(201);expect(state.bannerImagePath).toMatch(/^banner-\d+\.(jpg|png|webp)$/);
 expect(JSON.stringify(response.body)).not.toContain("bannerImagePath");expect(JSON.stringify(response.body)).not.toContain("client-name");
});
it("accepts exactly 2 MB through multipart",async()=>{
 const buffer=Buffer.concat([jpg,Buffer.alloc(2097152-jpg.length)]);
 expect((await request(app).post("/api/v1/admin/homepage-banner/image").set(headers).attach("image",buffer,"exact.jpg")).status).toBe(201);
});
it("rejects 2 MB plus one byte",async()=>expect((await request(app).post("/api/v1/admin/homepage-banner/image").set(headers).attach("image",Buffer.alloc(2097153),"big.jpg")).status).toBe(413));
it("rejects no file and a zero-byte file",async()=>{
 expect((await request(app).post("/api/v1/admin/homepage-banner/image").set(headers)).status).toBe(400);
 expect(()=>validateBannerImage(file(Buffer.alloc(0)))).toThrow(expect.objectContaining({statusCode:400}));
});
it.each([Buffer.from("<svg/>"),Buffer.from("GIF89a"),Buffer.from("%PDF"),Buffer.from("MZ executable")])("rejects unsupported real bytes despite a JPG filename",async bytes=>{
 expect((await request(app).post("/api/v1/admin/homepage-banner/image").set(headers).attach("image",bytes,"renamed.jpg")).status).toBe(415);
});
it("denies unauthenticated upload/remove",async()=>{
 expect((await request(app).post("/api/v1/admin/homepage-banner/image").attach("image",png,"test.png")).status).toBe(401);
 expect((await request(app).delete("/api/v1/admin/homepage-banner/image")).status).toBe(401);
});
it("denies customers",async()=>{
 m.user.mockResolvedValue({id,role:"CUSTOMER",isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 expect((await request(app).post("/api/v1/admin/homepage-banner/image").set(headers).attach("image",png,"x.png")).status).toBe(403);
 expect((await request(app).delete("/api/v1/admin/homepage-banner/image").set(headers)).status).toBe(403);
});
it("allows employees",async()=>{
 m.user.mockResolvedValue({id,name:"Employee",role:"EMPLOYEE",isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 expect((await request(app).post("/api/v1/admin/homepage-banner/image").set(headers).attach("image",png,"x.png")).status).toBe(201);
});
it("replaces the old object after saving and records actor audit",async()=>{
 await replaceBannerImage(file(),actor);const previous=state.bannerImagePath;
 await replaceBannerImage(file(),actor);expect(objects.size).toBe(1);expect(objects.has(previous!)).toBe(false);
 expect(m.audit).toHaveBeenCalledWith({data:expect.objectContaining({field:"banner.image",actorId:id,actorName:"Staff"}) as unknown});
});
it("cleans the new object if the database write fails",async()=>{
 await replaceBannerImage(file(),actor);const previous=state.bannerImagePath;
 m.update.mockRejectedValueOnce(new Error("db"));
 await expect(replaceBannerImage(file(),actor)).rejects.toMatchObject({statusCode:503});
 expect(objects.size).toBe(1);expect(objects.has(previous!)).toBe(true);expect(state.bannerImagePath).toBe(previous);
});
it("removes the object and returns the default null image",async()=>{
 await replaceBannerImage(file(),actor);await expect(removeBannerImage(actor)).resolves.toEqual({imageUrl:null});
 expect(state.bannerImagePath).toBeNull();expect(state.bannerImageUrl).toBeNull();expect(objects.size).toBe(0);
});
it("never returns the storage path through settings, and preserves the OFF behavior",async()=>{
 await replaceBannerImage(file(),actor);const settings=await getAdminBanner();expect("bannerImagePath" in settings).toBe(false);
 state.enabled=false;invalidateHomepageBanner();expect(await publicHomepageBanner()).toBeNull();
});
it("returns the live safe image URL immediately after cache invalidation",async()=>{
 const before=await publicHomepageBanner();expect(before?.bannerImageUrl).toBeNull();
 const uploaded=await replaceBannerImage(file(),actor);
 const after=await publicHomepageBanner();expect(after?.bannerImageUrl).toBe(uploaded.imageUrl);
 expect(after).not.toHaveProperty("bannerImagePath");
 await removeBannerImage(actor);expect((await publicHomepageBanner())?.bannerImageUrl).toBeNull();
});
