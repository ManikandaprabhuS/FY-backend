import {randomUUID} from "node:crypto";
import request from "supertest";
import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({auth:vi.fn(),user:vi.fn(),cart:vi.fn(),variants:vi.fn(),first:vi.fn(),create:vi.fn(),remove:vi.fn(),tx:vi.fn(),upload:vi.fn()}));
vi.mock("../src/config/supabase",()=>({supabaseAdmin:{auth:{getUser:m.auth},storage:{from:()=>({upload:m.upload,remove:vi.fn().mockResolvedValue({error:null})})}},createUserSupabaseClient:vi.fn()}));
vi.mock("../src/prisma/client",()=>({prisma:{user:{findUnique:m.user,findUniqueOrThrow:m.user},cart:{findUnique:m.cart},variant:{findMany:m.variants},orderPhoto:{findFirst:m.first,delete:m.remove},$transaction:m.tx}}));
import {getPhotoMaxBytes,PHOTO_MB_BYTES,photoLimitValidation,photoSizeError} from "../src/utils/photo-limits";
import {createAdminVariantSchema,updateAdminVariantSchema} from "../src/modules/products/products.schemas";
import {resolvePhotoContext} from "../src/modules/order-photos/photo-context";
import {uploadPhoto,reserveOrderPhoto,clearTempPhoto} from "../src/modules/order-photos/order-photos.service";
import {app} from "../src/app";
const userId=randomUUID(),variantId=randomUUID(),secondId=randomUUID();
let stored:{id:string;userId:string;sizeBytes:number;status:string;orderId:null;storagePath:string;maxAllowedMB:number}|null;
const jpeg=Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,218,0,8,1,1,0,0,63,0,0,255,217]);
const file=(bytes:number)=>({buffer:Buffer.concat([jpeg,Buffer.alloc(bytes-jpeg.length)]),size:bytes,originalname:"photo.jpg"} as Express.Multer.File);
const row=(id=variantId,limit:number|null=2)=>({id,maxPhotoSizeMB:limit,frameSize:"5x5",product:{productIdentifier:"P",productName:"Test frame"},primaryProducts:[]});
const tx=()=>({$queryRawUnsafe:vi.fn(),orderPhoto:{findFirst:m.first,delete:m.remove,create:m.create}});
beforeEach(()=>{
 vi.clearAllMocks();stored=null;
 const profile={id:userId,name:"Customer",role:"CUSTOMER",isActive:true,isEmailVerified:true,isPhoneNumberVerified:false};
 m.auth.mockResolvedValue({data:{user:{id:userId,email_confirmed_at:"2026-01-01"}},error:null});m.user.mockResolvedValue(profile);
 m.cart.mockResolvedValue({items:[{productIdentifier:"P",selectedVariantId:variantId,product:{variantId}}]});m.variants.mockResolvedValue([row()]);
 m.first.mockImplementation(()=>Promise.resolve(stored));
 m.create.mockImplementation(({data}:{data:NonNullable<typeof stored>})=>{stored={...data,orderId:null};return Promise.resolve(stored);});
 m.remove.mockImplementation(()=>{stored=null;return Promise.resolve({});});
 m.upload.mockResolvedValue({error:null});m.tx.mockImplementation((fn:(value:unknown)=>unknown)=>fn(tx()));
});
it.each([[null,true], [undefined,true],["",true],[1,true],[10,true],[2.5,true],[0,false],[-1,false],[11,false],["abc",false],[2.55,false],[NaN,false]])("validates optional admin limits %s", (value,valid)=>{
 expect(!photoLimitValidation(value)).toBe(valid);
 expect(updateAdminVariantSchema.safeParse({maxPhotoSizeMB:value}).success).toBe(valid);
});
it("keeps empty/null optional and shares the strictest/default rule",()=>{
 expect(photoLimitValidation("")).toBeNull();
 expect(getPhotoMaxBytes([{maxPhotoSizeMB:null}])).toBe(4*PHOTO_MB_BYTES);
 expect(getPhotoMaxBytes([{maxPhotoSizeMB:2},{maxPhotoSizeMB:5}])).toBe(2*PHOTO_MB_BYTES);
 expect(getPhotoMaxBytes([])).toBe(4*PHOTO_MB_BYTES);
 expect(createAdminVariantSchema.safeParse({frameSize:"5x5",mountType:"NONE",glassType:"NONE",price:100,stockQuantity:1,maxPhotoSizeMB:null}).success).toBe(true);
});
it.each([Math.floor(1.9*PHOTO_MB_BYTES),2*PHOTO_MB_BYTES])("accepts %s bytes under a 2 MB server cart",async bytes=>{
 const photo=await uploadPhoto(userId,file(bytes));expect(photo.sizeBytes).toBe(bytes);expect(stored?.maxAllowedMB).toBe(2);
});
it("rejects exactly 2 MB plus one byte through the authenticated API",async()=>{
 const response=await request(app).post("/api/v1/order-photos").set("Authorization","Bearer test").attach("photo",file(2*PHOTO_MB_BYTES+1).buffer,"photo.jpg");
 expect(response.status).toBe(413);expect(JSON.stringify(response.body)).toContain("up to 2 MB");expect(m.upload).not.toHaveBeenCalled();
});
it("resolves trusted DB limits from local selection IDs and rejects unrelated IDs or client limits",async()=>{
 const db={cart:{findUnique:m.cart},variant:{findMany:m.variants}};
 const result=await resolvePhotoContext(db as never,userId,[{productIdentifier:"P",variantId,quantity:1}]);
 expect(result.maxAllowedMB).toBe(2);expect(result.limitingItem).toEqual({name:"Test frame",variant:"5x5"});
 await expect(resolvePhotoContext(db as never,userId,[{productIdentifier:"other",variantId,quantity:1}])).rejects.toMatchObject({statusCode:400});
 await expect(resolvePhotoContext(db as never,userId,[{productIdentifier:"P",variantId,quantity:1,maxPhotoSizeMB:10}])).rejects.toThrow();
});
it("rejects a previously uploaded 3 MB photo after a 2 MB item is added, and permits replacement",async()=>{
 m.variants.mockResolvedValue([row(variantId,5)]);const saved=await uploadPhoto(userId,file(3*PHOTO_MB_BYTES));
 await expect(reserveOrderPhoto(tx() as never,userId,saved.imageId,[{maxPhotoSizeMB:5},{maxPhotoSizeMB:2}])).rejects.toMatchObject({statusCode:400,code:"PHOTO_LIMIT_CHANGED",details:{maxAllowedMB:2}});
 expect(stored?.status).toBe("TEMP");
 await clearTempPhoto(userId,saved.imageId);expect(stored).toBeNull();
 m.variants.mockResolvedValue([row(variantId,2)]);const replaced=await uploadPhoto(userId,file(2*PHOTO_MB_BYTES));
 const reserved=await reserveOrderPhoto(tx() as never,userId,replaced.imageId,[{maxPhotoSizeMB:2}]);expect(reserved?.maxAllowedMB).toBe(2);
});
it("uses the lowest DB limit in a multi-variant cart",async()=>{
 m.cart.mockResolvedValue({items:[{productIdentifier:"P",selectedVariantId:variantId,product:{variantId}},{productIdentifier:"P",selectedVariantId:secondId,product:{variantId:secondId}}]});
 m.variants.mockResolvedValue([row(variantId,5),row(secondId,2)]);
 expect((await resolvePhotoContext({cart:{findUnique:m.cart},variant:{findMany:m.variants}} as never,userId)).maxAllowedMB).toBe(2);
});
it("rejects customer calls to the variant update API",async()=>expect((await request(app).patch("/api/v1/products/variants/"+variantId).set("Authorization","Bearer test").send({maxPhotoSizeMB:10})).status).toBe(403));
it("formats validation with the actual and permitted sizes",()=>expect(photoSizeError(3.4*PHOTO_MB_BYTES,2*PHOTO_MB_BYTES)).toBe("Photo is 3.4 MB. This frame allows up to 2 MB."));
