import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {prisma} from "../src/prisma/client";
import {env} from "../src/config/env";
import {listCustomerOrderSummaries} from "../src/modules/orders/customer-order-summary";
import {notifyCustomer,listCustomerNotifications,readCustomerNotification,customerUnreadCount} from "../src/modules/customer-notifications/customer-notifications.service";
import {processOrderPlacedEffects} from "../src/modules/orders/order-placed-effects";
import {processOrderStatusEffects} from "../src/modules/orders/order-status-effects";
import {updateOrderStatus} from "../src/modules/orders/orders.service";
import {parseStatusHistory} from "../src/modules/orders/order-status-flow";
async function main(){
 if(env.NODE_ENV==="production"||!process.argv.includes("--run"))throw new Error("Use --run on the configured test DB.");
 const before=await prisma.order.findMany({orderBy:{id:"asc"}}),ids:string[]=[],marker="Customer performance "+randomUUID();
 try{
  for(let i=0;i<2;i++){const user=await prisma.user.create({data:{name:marker,email:randomUUID()+"@example.invalid",role:"CUSTOMER"}});ids.push(user.id);}
  const owner=ids[0]!,other=ids[1]!;
  const address=await prisma.userAddress.create({data:{userId:owner,addressLine:"Temporary test address",postalCode:"600040",city:"Chennai",state:"Tamil Nadu",country:"India",contactPerson:marker,contactNumber:"9876543210"}});
  assert.equal((await listCustomerOrderSummaries(owner,{})).pagination.total,0);
  const orders=Array.from({length:105},()=>({id:randomUUID(),userId:owner,userAddressId:address.id,orderNumber:"T-"+randomUUID(),totalPrice:10,paymentMethod:"COD"}));
  await prisma.order.createMany({data:orders.slice(0,5)});
  assert.equal((await listCustomerOrderSummaries(owner,{})).pagination.total,5);
  await prisma.order.createMany({data:orders.slice(5)});
  const started=performance.now(),page=await listCustomerOrderSummaries(owner,{page:1});
  assert.equal(page.orders.length,10);assert.equal(page.pagination.total,105);
  assert.equal((await listCustomerOrderSummaries(owner,{page:11})).orders.length,5);
  assert.equal((await listCustomerOrderSummaries(other,{})).pagination.total,0);
  const first=orders[0]!;
  await processOrderPlacedEffects(first.id);await processOrderPlacedEffects(first.id);
  assert.equal(await customerUnreadCount(owner),1);
  const staff=await prisma.user.findFirst({where:{role:{in:["ADMIN","EMPLOYEE"]}},select:{id:true,role:true}});assert(staff);
  const changed=await updateOrderStatus(first.id,{status:"PROCESSING"},staff);
  const event=parseStatusHistory(changed.statusHistory).at(-1)!;assert(event.eventId);
  await processOrderStatusEffects(first.id,event.eventId);await processOrderStatusEffects(first.id,event.eventId);
  assert.equal(await customerUnreadCount(owner),2);
  const cancel=await updateOrderStatus(first.id,{status:"CANCELLED"},{id:owner,role:"CUSTOMER"});
  const cancelled=parseStatusHistory(cancel.statusHistory).at(-1)!;assert(cancelled.eventId);
  await processOrderStatusEffects(first.id,cancelled.eventId);
  assert.equal(await customerUnreadCount(owner),3);
  assert.equal((await listCustomerNotifications(other,{})).notifications.length,0);
  await assert.rejects(readCustomerNotification(other,first.id),{statusCode:404});
  await readCustomerNotification(owner,first.id);assert.equal(await customerUnreadCount(owner),2);
  await readCustomerNotification(owner);assert.equal(await customerUnreadCount(owner),0);
  await readCustomerNotification(owner,first.id);
  await Promise.all(Array.from({length:22},(_,i)=>notifyCustomer(owner,"ORDER_STATUS",{eventId:randomUUID(),orderId:first.id,orderNumber:first.orderNumber,status:"Processing",createdAt:new Date(Date.now()+i)})));
  assert.equal((await listCustomerNotifications(owner,{page:1})).notifications.length,20);
  assert.equal((await listCustomerNotifications(owner,{page:2})).notifications.length,5);
  console.info(JSON.stringify({ordersTested:[0,5,105],ownerScoping:true,notificationPagination:true,placedStatusCancelExactlyOnce:true,markOneAndAll:true,noEmail:true,verificationMilliseconds:Math.round(performance.now()-started)}));
 }finally{
  await prisma.notification.deleteMany({where:{message:{contains:marker}}});
  const temporary=await prisma.order.findMany({where:{userId:{in:ids}},select:{id:true}});
  await prisma.notification.deleteMany({where:{id:{in:temporary.map(o=>o.id)}}});
  await prisma.orderItem.deleteMany({where:{orderId:{in:temporary.map(o=>o.id)}}});
  await prisma.order.deleteMany({where:{userId:{in:ids}}});
  await prisma.user.deleteMany({where:{id:{in:ids}}});
  assert.deepEqual(await prisma.order.findMany({orderBy:{id:"asc"}}),before);
  console.info("Temporary records removed; existing orders unchanged.");
 }
}
void main().catch(error=>{console.error(error instanceof Error?error.message:"Customer checks failed");process.exitCode=1;}).finally(()=>prisma.$disconnect());
