import {prisma} from "../../prisma/client";
import {env} from "../../config/env";
type Usage={bytes:number|null;limitBytes:number|null};
export type StorageMetrics={database:Usage;photos:Usage;pending:{count:number|null;bytes:number|null};generatedAt:string;includesBanners:false};
let revision=0,cache:{until:number;value:StorageMetrics}|undefined,inflight:{revision:number;promise:Promise<StorageMetrics>}|undefined;
export function invalidateStorageMetrics(){revision++;cache=undefined;inflight=undefined;}
const safe=async<T>(fn:()=>Promise<T>):Promise<T|null>=>{try{return await fn();}catch{return null;}};
export async function storageMetrics(refresh=false):Promise<StorageMetrics>{
 if(!refresh&&cache&&cache.until>Date.now())return cache.value;
 if(inflight?.revision===revision)return inflight.promise;
 const current=revision;
 const promise=(async()=>{
  const [database,photos,pending]=await Promise.all([
   safe(()=>prisma.$queryRawUnsafe<Array<{bytes:bigint}>>("SELECT public.frameyaad_database_size() AS bytes")),
   safe(()=>prisma.orderPhoto.aggregate({where:{status:{not:"DELETED"}},_sum:{sizeBytes:true}})),
   safe(()=>prisma.orderPhoto.aggregate({where:{status:"ATTACHED",order:{status:{in:["DELIVERED","CANCELLED"]}}},_sum:{sizeBytes:true},_count:{_all:true}}))
  ]);
  const value:StorageMetrics={
   database:{bytes:database?Number(database[0]?.bytes??0):null,limitBytes:env.DB_SIZE_LIMIT_MB?env.DB_SIZE_LIMIT_MB*1048576:null},
   photos:{bytes:photos?Number(photos._sum.sizeBytes??0):null,limitBytes:env.STORAGE_LIMIT_MB?env.STORAGE_LIMIT_MB*1048576:null},
   pending:{count:pending?pending._count._all:null,bytes:pending?Number(pending._sum.sizeBytes??0):null},
   generatedAt:new Date().toISOString(),includesBanners:false
  };
  if(current===revision)cache={until:Date.now()+300000,value};return value;
 })();
 inflight={revision:current,promise};
 try{return await promise;}finally{if(inflight?.promise===promise)inflight=undefined;}
}
