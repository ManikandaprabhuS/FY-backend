import { Prisma,type Offer } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { ApiError } from "../../utils/api-error";
import type { z } from "zod";
import type { updateOfferSchema } from "./offers.schemas";
export const offerDescription=(offer:Pick<Offer,"code"|"percentage"|"minOrderAmount">)=>offer.code==="FIRST_ORDER"
 ? Number(offer.percentage)+"% off on your first order"
 : Number(offer.percentage)+"% off on orders above Rs. "+Number(offer.minOrderAmount).toLocaleString("en-IN");
const select={code:true,title:true,description:true,percentage:true,minOrderAmount:true,enabled:true,updatedBy:true,updatedAt:true,version:true} satisfies Prisma.OfferSelect;
type Setting=Prisma.OfferGetPayload<{select:typeof select}>;
let cached:{expires:number;signature:string;rows:Setting[]}|undefined;
let generation=0;
export const invalidateOffers=()=>{cached=undefined;generation++;};
export const runtimeOffers=async(db:Prisma.TransactionClient=prisma,fresh=false)=>{
 if(fresh)return db.offer.findMany({select,orderBy:{code:"asc"}});
 // A tiny version probe also invalidates other process caches immediately after commit.
 const versions=await db.offer.findMany({select:{code:true,version:true},orderBy:{code:"asc"}});
 const signature=versions.map(o=>o.code+":"+o.version).join("|"),now=Date.now();
 if(cached&&cached.expires>now&&cached.signature===signature)return cached.rows;
 const epoch=generation;
 const rows=await db.offer.findMany({select,orderBy:{code:"asc"}});
 if(epoch===generation)cached={expires:now+30000,signature:rows.map(o=>o.code+":"+o.version).join("|"),rows};
 return rows;
};
export const lockOfferSettings=async(db:Prisma.TransactionClient,code:string)=>{
 // Hold the current settings stable until the order commits; an overlapping edit forces a serializable retry.
 await db.$queryRaw(Prisma.sql`SELECT code FROM public.offers WHERE code=${code} FOR SHARE`);
};
const serialize=(offer:Setting)=>({...offer,description:offerDescription(offer),percentage:Number(offer.percentage),minOrderAmount:offer.minOrderAmount==null?null:Number(offer.minOrderAmount)});
export const listAdminOffers=async()=>{
 const [offers,usage]=await Promise.all([runtimeOffers(prisma,true),prisma.order.groupBy({by:["couponCode"],where:{couponCode:{in:["FIRST_ORDER","BIG_ORDER"]}},_count:{_all:true},_sum:{discountAmount:true}})]);
 const ids=[...new Set(offers.flatMap(o=>o.updatedBy?[o.updatedBy]:[]))];
 const users=ids.length?await prisma.user.findMany({where:{id:{in:ids}},select:{id:true,name:true}}):[];
 return offers.map(o=>({...serialize(o),updatedBy:o.updatedBy?{id:o.updatedBy,name:users.find(u=>u.id===o.updatedBy)?.name??"Former staff"}:null,
 usage:{orders:usage.find(u=>u.couponCode===o.code)?._count._all??0,totalDiscount:Number(usage.find(u=>u.couponCode===o.code)?._sum.discountAmount??0)}}));
};
export const updateOffer=async(code:string,input:z.infer<typeof updateOfferSchema>,actor:{id:string;name:string})=>{
 if(code==="FIRST_ORDER"&&input.minOrderAmount!==undefined)throw new ApiError(400,"Minimum order amount applies only to Big Order Offer","INVALID_OFFER_FIELD");
 await prisma.$transaction(async tx=>{
  const old=await tx.offer.findUniqueOrThrow({where:{code}});
  if(old.version!==input.version)throw new ApiError(409,"This offer was updated by another staff member. Latest values have been loaded.","OFFER_CONFLICT");
  const data:{percentage?:number;minOrderAmount?:number;enabled?:boolean}={};
  if(input.percentage!==undefined&&Number(old.percentage)!==input.percentage)data.percentage=input.percentage;
  if(input.minOrderAmount!==undefined&&Number(old.minOrderAmount)!==input.minOrderAmount)data.minOrderAmount=input.minOrderAmount;
  if(input.enabled!==undefined&&old.enabled!==input.enabled)data.enabled=input.enabled;
  if(!Object.keys(data).length)return;
  const changed=await tx.offer.updateMany({where:{code,version:input.version},data:{...data,updatedBy:actor.id,updatedAt:new Date(),version:{increment:1}}});
  if(!changed.count)throw new ApiError(409,"This offer was updated by another staff member. Latest values have been loaded.","OFFER_CONFLICT");
  await tx.offerAudit.createMany({data:Object.entries(data).map(([field,newValue])=>({
   offerCode:code,field,oldValue:field==="enabled"?old.enabled:Number(field==="percentage"?old.percentage:old.minOrderAmount),
   newValue,actorId:actor.id,actorName:actor.name,
  }))});
 },{timeout:15000});
 invalidateOffers();
 return (await listAdminOffers()).find(o=>o.code===code)!;
};
export const offerHistory=(code:string)=>prisma.offerAudit.findMany({where:{offerCode:code},orderBy:[{createdAt:"desc"},{id:"desc"}],take:20,select:{id:true,field:true,oldValue:true,newValue:true,actorName:true,createdAt:true}});
