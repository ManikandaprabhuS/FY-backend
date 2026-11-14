import {randomUUID} from "node:crypto";
import {Prisma} from "@prisma/client";
import {prisma} from "../../prisma/client";
import {supabaseAdmin} from "../../config/supabase";
import {env} from "../../config/env";
import {ApiError} from "../../utils/api-error";
import {paginationMeta} from "../../utils/pagination";
import {lockCustomerPhotos} from "../order-photos/order-photos.service";
import {invalidateStorageMetrics} from "./storage-metrics";
import {z} from "zod";
type Actor={id:string;name:string;role:string};
const staff=(a:Actor)=>{if(!["ADMIN","EMPLOYEE"].includes(a.role))throw new ApiError(403,"You do not have permission for this action","FORBIDDEN");};
export const cleanupQuery=z.object({
 page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(50).default(20),
 status:z.enum(["DELIVERED","CANCELLED"]).optional(),search:z.string().trim().max(120).default(""),
 from:z.iso.date().optional(),to:z.iso.date().optional()
}).refine(q=>!q.from||!q.to||q.from<=q.to,{message:"Start date must not be after end date."});
export const cleanupDelete=z.object({ids:z.array(z.string().uuid()).min(1).max(50),confirm:z.literal(true)}).strict();
export type CleanupRow={id:string;orderId:string;orderNumber:string;customerName:string;orderStatus:"DELIVERED"|"CANCELLED";fileName:string;sizeBytes:number;completedAt:Date|null};
export async function listCleanup(raw:unknown,actor:Actor){
 staff(actor);const q=cleanupQuery.parse(raw),clauses:Prisma.Sql[]=[
 Prisma.sql(["p.status='ATTACHED' AND o.\"orderStatus\" IN ('DELIVERED','CANCELLED')"])];
 if(q.status)clauses.push(Prisma.sql(['o."orderStatus"::text=',''],q.status));
 if(q.search){const search="%"+q.search.replace(/[\\%_]/g,"\\$&")+"%";clauses.push(Prisma.sql(['(o."orderNumber" ILIKE ',' OR u.name ILIKE ',')'],search,search));}
 if(q.from)clauses.push(Prisma.sql(["terminal.at>=",""],new Date(q.from+"T00:00:00+05:30")));
 if(q.to)clauses.push(Prisma.sql(["terminal.at<",""],new Date(new Date(q.to+"T00:00:00+05:30").getTime()+86400000)));
 const base=Prisma.sql(['FROM public.order_photos p JOIN public."Order" o ON o.id=p."orderId" JOIN public.users u ON u.id=o."userId" CROSS JOIN LATERAL (SELECT public.frameyaad_photo_completed_at(o."statusHistory",o."orderStatus"::text,o."cancelledAt") AS at) terminal WHERE ',""],Prisma.join(clauses," AND "));
 const [rows,summary]=await Promise.all([
  prisma.$queryRaw<CleanupRow[]>(Prisma.sql(['SELECT p.id,p."orderId",o."orderNumber",u.name AS "customerName",o."orderStatus",p."fileName",p."sizeBytes",terminal.at AS "completedAt" '," ORDER BY terminal.at DESC NULLS LAST,p.id LIMIT "," OFFSET ",""],base,q.limit,(q.page-1)*q.limit)),
  prisma.$queryRaw<Array<{total:bigint;bytes:bigint}>>(Prisma.sql(['SELECT count(*) AS total,coalesce(sum(p."sizeBytes"),0)::bigint AS bytes ',""],base))
 ]);
 return {photos:rows,pagination:paginationMeta(q.page,q.limit,Number(summary[0]?.total??0)),totalBytes:Number(summary[0]?.bytes??0)};
}
export type DeleteResult={id:string;ok:boolean;alreadyDeleted?:boolean;bytesFreed:number;error?:string};
export async function deleteCleanup(raw:unknown,actor:Actor){
 staff(actor);const input=cleanupDelete.parse(raw),batchId=randomUUID(),results:DeleteResult[]=[];
 for(const id of new Set(input.ids)){
  try{
   const found=await prisma.orderPhoto.findUnique({where:{id},select:{userId:true}});
   if(!found)throw new ApiError(404,"Photo was not found.","PHOTO_NOT_FOUND");
   const result=await prisma.$transaction(async tx=>{
    await lockCustomerPhotos(tx,found.userId);
    const photo=await tx.orderPhoto.findUnique({where:{id},include:{order:{select:{id:true,status:true}}}});
    if(!photo)throw new ApiError(404,"Photo was not found.","PHOTO_NOT_FOUND");
    if(!photo.order||!["DELIVERED","CANCELLED"].includes(photo.order.status))
     throw new ApiError(400,"Only photos from Delivered or Cancelled orders can be deleted.","PHOTO_CLEANUP_NOT_ALLOWED");
    if(photo.status==="DELETED")return {id,ok:true,alreadyDeleted:true,bytesFreed:0};
    if(photo.status!=="ATTACHED")throw new ApiError(400,"Only attached order photos can be deleted.","PHOTO_CLEANUP_NOT_ALLOWED");
    if(photo.storagePath){
     const removed=await supabaseAdmin.storage.from(env.SUPABASE_PHOTO_BUCKET).remove([photo.storagePath]);
     if(removed.error&&!("statusCode" in removed.error&&Number(removed.error.statusCode)===404))
      throw new ApiError(503,"Photo storage could not be updated. Please retry.","PHOTO_STORAGE_UNAVAILABLE");
    }
    const deletedAt=new Date();
    await tx.orderPhoto.update({where:{id},data:{status:"DELETED",storagePath:"",deletedAt,deletedBy:actor.id,deletedByName:actor.name}});
    await tx.photoCleanupAudit.create({data:{id:randomUUID(),batchId,actorId:actor.id,actorName:actor.name,orderIds:[photo.order.id],photoId:id,count:1,bytesFreed:photo.sizeBytes,createdAt:deletedAt}});
    return {id,ok:true,bytesFreed:photo.sizeBytes};
   },{timeout:30000,maxWait:10000});
   results.push(result);
  }catch(error){results.push({id,ok:false,bytesFreed:0,error:error instanceof ApiError?error.message:"Photo deletion could not be completed. Please retry."});}
 }
 invalidateStorageMetrics();
 return {results,deletedCount:results.filter(r=>r.ok&&!r.alreadyDeleted).length,bytesFreed:results.reduce((n,r)=>n+r.bytesFreed,0)};
}
