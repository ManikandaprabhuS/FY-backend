import {prisma} from "../../prisma/client";
const checks=new Map<string,{expires:number;promise:Promise<void>}>();
export const importLegacyCustomerOrderNotifications=(userId:string):Promise<void>=>{
 const previous=checks.get(userId);
 if(previous&&previous.expires>Date.now())return previous.promise;
 const promise=(async()=>{
  let cursor:string|undefined;
  const since=new Date(Date.now()-90*86400000);
  while(true){
   const legacy=await prisma.notification.findMany({where:{userId,createdAt:{gte:since},OR:[{type:"ORDER_PLACED"},{title:"Order status updated"}]},
    select:{id:true,title:true,message:true,type:true,read:true,createdAt:true},orderBy:{id:"asc"},take:200,...(cursor?{cursor:{id:cursor},skip:1}:{})});
   if(!legacy.length)break;
   const numbers=[...new Set(legacy.flatMap(n=>{const match=n.message.match(/\b(FY-[A-Za-z0-9_-]+)\b/);return match?.[1]?[match[1]]:[];}))];
   const orders=numbers.length?await prisma.order.findMany({where:{userId,orderNumber:{in:numbers}},select:{id:true,orderNumber:true}}):[];
   const byNumber=new Map(orders.map(order=>[order.orderNumber,order.id]));
   const records=legacy.flatMap(n=>{
    const number=n.message.match(/\b(FY-[A-Za-z0-9_-]+)\b/)?.[1],orderId=number?byNumber.get(number):undefined;
    if(!orderId)return [];
    const placed=n.type==="ORDER_PLACED",cancelled=/\bcancelled\b/i.test(n.message);
    return [{id:placed?orderId:n.id,userId,orderId,type:placed?"ORDER_PLACED":cancelled?"ORDER_CANCELLED":"ORDER_STATUS",title:n.title,message:n.message,isRead:n.read,createdAt:n.createdAt}];
   });
   if(records.length)await prisma.customerNotification.createMany({data:records,skipDuplicates:true});
   if(legacy.length<200)break;
   cursor=legacy.at(-1)!.id;
  }
 })();
 const entry={expires:Date.now()+300000,promise};checks.set(userId,entry);
 if(checks.size>1000)checks.delete(checks.keys().next().value!);
 void promise.catch(()=>{if(checks.get(userId)===entry)checks.delete(userId);});
 return promise;
};
