import {randomUUID} from "node:crypto";
import {Prisma,UserRole} from "@prisma/client";
import {prisma} from "../../prisma/client";
import {supabaseAdmin} from "../../config/supabase";
import {env} from "../../config/env";
import {logger} from "../../config/logger";
import {ApiError} from "../../utils/api-error";
import {getHeroVideo} from "../site-media/site-media.service";
import {validateContactFile,type MediaKind} from "./contact-media.validation";

export type ContactDetails={phone:string|null;email:string|null;studioName:string|null;address:string|null};
type Asset={url:string;path:string;fileName:string;sizeBytes:number};
type Payload={video?:Asset|null;poster?:Asset|null;banner?:Asset|null;details?:ContactDetails};
type Setting={key:string;data:Payload;updatedBy:string|null;updatedAt:Date};
type Actor={id:string;name:string;role:UserRole};
const keyFor=(kind:MediaKind)=>kind==="banner"?"custom_framing_banner":"storyboard_video";
const bucket=()=>supabaseAdmin.storage.from(env.SUPABASE_SITE_MEDIA_BUCKET);
const fail=()=>new ApiError(503,"Contact settings are temporarily unavailable. Please try again.","CONTACT_SETTINGS_UNAVAILABLE");
const read=()=>prisma.$queryRawUnsafe<Setting[]>('SELECT key,data,"updatedBy","updatedAt" FROM public.site_contact_settings');
const safeAsset=(asset?:Asset|null)=>asset?{url:asset.url,fileName:asset.fileName,sizeBytes:asset.sizeBytes}:null;
const emptyDetails:ContactDetails={phone:null,email:null,studioName:null,address:null};
let cache:{until:number;value:Awaited<ReturnType<typeof loadPublic>>}|undefined;
let pending:Promise<Awaited<ReturnType<typeof loadPublic>>>|undefined,generation=0;
export function invalidateContactMedia(){generation++;cache=undefined;pending=undefined;}
async function loadPublic(){
 const [rows,hero]=await Promise.all([read(),getHeroVideo().catch(()=>null)]);
 const story=rows.find(r=>r.key==="storyboard_video")?.data,framing=rows.find(r=>r.key==="custom_framing_banner")?.data;
 return {videoUrl:story?.video?.url??null,posterUrl:story?.poster?.url??null,bannerImageUrl:framing?.banner?.url??null,defaultVideoUrl:hero?.url??null,contactDetails:rows.find(r=>r.key==="contact_details")?.data.details??emptyDetails};
}
type PublicContent=Awaited<ReturnType<typeof loadPublic>>;
export async function publicContactMedia():Promise<PublicContent>{
 if(cache&&cache.until>Date.now())return cache.value;
 if(pending)return pending;
 const epoch=generation;
 const request=loadPublic().then(async value=>{if(epoch!==generation)return publicContactMedia();cache={until:Date.now()+60000,value};return value;});
 pending=request;
 try{return await request;}catch{throw fail();}finally{if(pending===request)pending=undefined;}
}
export async function adminContactSettings(){
 const [rows,hero]=await Promise.all([read(),getHeroVideo().catch(()=>null)]).catch(()=>{throw fail();});
 const story=rows.find(r=>r.key==="storyboard_video"),framing=rows.find(r=>r.key==="custom_framing_banner"),details=rows.find(r=>r.key==="contact_details");
 return {video:safeAsset(story?.data.video),poster:safeAsset(story?.data.poster),banner:safeAsset(framing?.data.banner),defaultVideoUrl:hero?.url??null,contactDetails:details?.data.details??emptyDetails,updatedAt:{storyboard:story?.updatedAt??null,banner:framing?.updatedAt??null,details:details?.updatedAt??null}};
}
function requireStaff(actor:Actor){
 if(actor.role!==UserRole.ADMIN&&actor.role!==UserRole.EMPLOYEE)throw new ApiError(403,"Staff access is required.","FORBIDDEN");
}
async function removeObject(path:string){
 for(let attempt=0;attempt<3;attempt++){
  try{const result=await bucket().remove([path]);if(!result.error||("statusCode"in result.error&&Number(result.error.statusCode)===404))return true;}catch{/* Retry transient storage errors without exposing object paths. */}
 }
 logger.warn({event:"contact_media_cleanup_pending"},"Old contact media cleanup requires retry");return false;
}
async function updateAsset(kind:MediaKind,asset:Asset|null,actor:Actor){
 const key=keyFor(kind);
 return prisma.$transaction(async tx=>{
  const rows=await tx.$queryRawUnsafe<Setting[]>('SELECT key,data,"updatedBy","updatedAt" FROM public.site_contact_settings WHERE key=$1 FOR UPDATE',key);
  const row=rows[0];if(!row)throw fail();
  const previous=row.data[kind];
  const data={...row.data,[kind]:asset};
  await tx.$executeRawUnsafe('UPDATE public.site_contact_settings SET data=$1::jsonb,"updatedBy"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE key=$3',JSON.stringify(data),actor.id,key);
  await tx.offerAudit.create({data:{offerCode:"BIG_ORDER",field:"contact."+kind,oldValue:previous?.url??Prisma.JsonNull,newValue:asset?.url??Prisma.JsonNull,actorId:actor.id,actorName:actor.name}});
  return previous?.path??null;
 },{timeout:15000});
}
export async function replaceContactMedia(kind:MediaKind,file:Express.Multer.File|undefined,actor:Actor){
 requireStaff(actor);const type=validateContactFile(kind,file);
 const path="contact/"+kind+"/"+Date.now()+"-"+randomUUID()+"."+type.ext;
 try{
  const uploaded=await bucket().upload(path,file!.buffer,{contentType:type.mimeType,upsert:false,cacheControl:"31536000"});
  if(uploaded.error)throw fail();
 }catch{await removeObject(path);throw fail();}
 const asset:Asset={url:bucket().getPublicUrl(path).data.publicUrl,path,fileName:file!.originalname.replace(/[<>/\\]/g,"").split("").filter(c=>c.charCodeAt(0)>=32&&c.charCodeAt(0)!==127).join("").slice(0,120)||"contact."+type.ext,sizeBytes:file!.buffer.length};
 let old:string|null;
 try{old=await updateAsset(kind,asset,actor);}catch{
  // An ambiguous commit must not delete a newly committed active file.
  const rows=await read().catch(()=>undefined);
  if(rows&&rows.find(r=>r.key===keyFor(kind))?.data[kind]?.path!==path)await removeObject(path);
  throw fail();
 }
 invalidateContactMedia();if(old)await removeObject(old);
 return adminContactSettings();
}
export async function removeContactMedia(kind:MediaKind,actor:Actor){
 requireStaff(actor);const old=await updateAsset(kind,null,actor).catch(()=>{throw fail();});invalidateContactMedia();if(old)await removeObject(old);
 return adminContactSettings();
}
export async function updateContactDetails(details:ContactDetails,actor:Actor){
 requireStaff(actor);
 await prisma.$transaction(async tx=>{
  const rows=await tx.$queryRawUnsafe<Setting[]>('SELECT key,data,"updatedBy","updatedAt" FROM public.site_contact_settings WHERE key=$1 FOR UPDATE',"contact_details");
  if(!rows[0])throw fail();
  await tx.$executeRawUnsafe('UPDATE public.site_contact_settings SET data=$1::jsonb,"updatedBy"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE key=$3',JSON.stringify({details}),actor.id,"contact_details");
  await tx.offerAudit.create({data:{offerCode:"BIG_ORDER",field:"contact.details",oldValue:JSON.parse(JSON.stringify(rows[0].data.details??{})) as Prisma.InputJsonValue,newValue:JSON.parse(JSON.stringify(details)) as Prisma.InputJsonValue,actorId:actor.id,actorName:actor.name}});
 },{timeout:15000}).catch(()=>{throw fail();});invalidateContactMedia();return adminContactSettings();
}

let sweeping=false,maintenanceStarted=false;
export async function cleanupContactMedia(){
 if(sweeping)return;sweeping=true;let removed=0;
 try{
  const rows=await read(),activePaths=new Set(rows.flatMap(row=>["video","poster","banner"].flatMap(kind=>{const asset=row.data[kind as MediaKind];return asset?.path?[asset.path]:[];})));
  for(const kind of ["video","poster","banner"] as const){
   const folder="contact/"+kind;
   const listed=await bucket().list(folder,{limit:1000,sortBy:{column:"created_at",order:"asc"}});
   if(listed.error)throw fail();
   for(const object of listed.data??[]){
    const path=folder+"/"+object.name;
    const created=Date.parse(object.created_at??"");
    if(!/^\d+-[a-f0-9-]+\.(mp4|webm|jpg|png|webp)$/.test(object.name)||activePaths.has(path)||!Number.isFinite(created)||created>Date.now()-3600000)continue;
    const current=await read();
    const stillUsed=current.some(row=>["video","poster","banner"].some(key=>row.data[key as MediaKind]?.path===path));
    if(!stillUsed&&await removeObject(path))removed++;
   }
  }
  if(removed)logger.info({event:"contact_media_cleanup",count:removed},"Unreferenced Contact media removed");
 }catch{logger.warn({event:"contact_media_cleanup_unavailable"},"Contact media cleanup will retry");}
 finally{sweeping=false;}
}
export function startContactMediaCleanup(){
 if(maintenanceStarted)return;maintenanceStarted=true;
 void cleanupContactMedia();setInterval(()=>{void cleanupContactMedia();},86400000).unref();
}
