import {z} from 'zod';
import {prisma} from '../prisma/client';

export const businessFactsFields=z.object({
 brandName:z.string().trim().max(120).optional(),siteUrl:z.url().refine(value=>/^https?:\/\//i.test(value),'Use an HTTP or HTTPS site URL.').optional(),
 gstin:z.string().trim().max(30).optional(),workshops:z.array(z.string().trim().max(120)).max(20).optional(),
 grievanceOfficer:z.string().trim().max(300).optional(),jurisdiction:z.string().trim().max(200).optional(),
 deliveryDaysMin:z.number().int().min(0).max(365).optional(),deliveryDaysMax:z.number().int().min(0).max(365).optional(),
 payments:z.object({cod:z.boolean(),online:z.boolean()}).optional(),
}).strict();
export type BusinessFacts={brandName:string;siteUrl:string;email:string;phone:string;address:string;gstin:string;workshops:string[];grievanceOfficer:string;jurisdiction:string;deliveryDaysMin:number;deliveryDaysMax:number;payments:{cod:boolean;online:boolean}};
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
export function publicBusinessFacts(value:unknown):BusinessFacts{
 const details=record(record(value).details),parsed=businessFactsFields.safeParse(details.businessFacts),extra=parsed.success?parsed.data:{};
 const text=(key:string)=>typeof details[key]==='string'?String(details[key]):'';
 return {brandName:extra.brandName||'FrameYaad',siteUrl:extra.siteUrl||'https://frameyaad.com',email:text('email'),phone:text('phone'),address:text('address'),gstin:extra.gstin||'',workshops:extra.workshops??['Oddanchatram','Tirupur'],grievanceOfficer:extra.grievanceOfficer||'',jurisdiction:extra.jurisdiction||'',deliveryDaysMin:extra.deliveryDaysMin??3,deliveryDaysMax:extra.deliveryDaysMax??6,payments:extra.payments??{cod:true,online:false}};
}
let cache:{until:number;value:BusinessFacts}|undefined,pending:Promise<BusinessFacts>|undefined,generation=0;
export function invalidateBusinessFacts(){generation++;cache=undefined;pending=undefined;}
export async function getBusinessFacts(){if(cache&&cache.until>Date.now())return cache.value;if(pending)return pending;const current=generation;const request=prisma.siteContactSetting.findUnique({where:{key:'contact_details'},select:{data:true}}).then(row=>{const value=publicBusinessFacts(row?.data);if(current===generation)cache={until:Date.now()+30000,value};return value;});pending=request;try{return await request;}finally{if(pending===request)pending=undefined;}}
