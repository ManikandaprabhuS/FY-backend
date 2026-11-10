import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {prisma} from "../src/prisma/client";
import {env} from "../src/config/env";
import {checkout,updateOrderStatus,getOrder} from "../src/modules/orders/orders.service";
import {parseStatusHistory} from "../src/modules/orders/order-status-flow";
import {listCustomerNotifications} from "../src/modules/customer-notifications/customer-notifications.service";
import {processOrderStatusEffects} from "../src/modules/orders/order-status-effects";
async function main(){
 if(env.NODE_ENV==="production"||!process.argv.includes("--run"))throw new Error("Use --run on test only.");
 const original=await prisma.order.findMany({select:{id:true,status:true,statusHistory:true,totalPrice:true,updatedAt:true},orderBy:{id:"asc"}});
 const marker="Status check "+randomUUID(),ids:string[]=[];
 const fetchOriginal=globalThis.fetch;let mockedEmails=0;
 globalThis.fetch=async(...args:Parameters<typeof fetchOriginal>)=>{
  const input=args[0],url=typeof input==="string"?input:input instanceof URL?input.href:input.url;
  if(url==="https://api.resend.com/emails"){mockedEmails++;return new Response(JSON.stringify({id:"fixture-email"}),{status:200});}
  return fetchOriginal(...args);
 };
 try{
  const staff=await prisma.user.findFirst({where:{role:{in:["ADMIN","EMPLOYEE"]}},select:{id:true,role:true}});assert(staff);
  const employee=await prisma.user.create({data:{name:marker,email:randomUUID()+"@example.invalid",role:"EMPLOYEE"},select:{id:true,role:true}});ids.push(employee.id);
  const owner=await prisma.user.create({data:{name:marker,email:randomUUID()+"@example.invalid",phoneNumber:"8"+Date.now().toString().slice(-9),role:"CUSTOMER"},select:{id:true,role:true}});ids.push(owner.id);
  const addressId=randomUUID();
  await prisma.$executeRaw`INSERT INTO public.user_address(id,"userId","addressLine","postCode",city,state,country,"contactPerson","contactNumber","updatedAt") VALUES(${addressId},${owner.id},'Temporary status test','600040','Chennai','Tamil Nadu','India',${marker},'9876543210',NOW())`;
  const product=await prisma.product.findFirst({where:{material:{isActive:true},variants:{some:{isActive:true,stockQuantity:{gte:1}}}},select:{productIdentifier:true,variants:{where:{isActive:true,stockQuantity:{gte:1}},take:1,select:{id:true,price:true}}}});assert(product?.variants[0]);
  const items=[{productIdentifier:product.productIdentifier,variantId:product.variants[0].id,quantity:1}];
  const create=()=>checkout(owner.id,{userAddressId:addressId,paymentMethod:"COD",checkoutKey:randomUUID(),remark:randomUUID(),items});
  const order=await create();const total=order.totalPrice.toString();
  assert.equal(parseStatusHistory(order.statusHistory)[0]?.changedAt,order.createdAt.toISOString());
  await assert.rejects(updateOrderStatus(order.id,{status:"SHIPPED"},staff),{statusCode:400});
  for(const status of ["PROCESSING","READY_TO_SHIP","SHIPPED","DELIVERED"] as const){
   const changed=await updateOrderStatus(order.id,{status},staff);
   assert.equal(changed.totalPrice.toString(),total);
   if(status==="READY_TO_SHIP"||status==="SHIPPED")await assert.rejects(updateOrderStatus(order.id,{status:"CANCELLED"},owner),{statusCode:400});
   const event=parseStatusHistory(changed.statusHistory).at(-1)!;assert(event.eventId);
   await processOrderStatusEffects(order.id,event.eventId);
   assert(await prisma.customerNotification.findUnique({where:{id:event.eventId},select:{id:true}}));
  }
  const inbox=await listCustomerNotifications(owner.id,{limit:20});
  assert(inbox.notifications.filter(n=>n.title==="Order status updated").every(n=>n.orderId===order.id));
  const done=await getOrder(order.id,owner.id,owner.role);
  assert.equal(parseStatusHistory(done.statusHistory).length,5);
  await assert.rejects(updateOrderStatus(order.id,{status:"PROCESSING"},staff),{statusCode:400});
  await assert.rejects(getOrder(order.id,employee.id,"CUSTOMER"),{statusCode:404});
  for(const processing of [false,true]){
   let cancel=await create();if(processing)cancel=await updateOrderStatus(cancel.id,{status:"PROCESSING"},staff);
   cancel=await updateOrderStatus(cancel.id,{status:"CANCELLED",note:"Fixture cancellation"},owner);
   assert.equal(parseStatusHistory(cancel.statusHistory).at(-1)?.changedBy.role,"CUSTOMER");
  }
  const race=await create();
  const outcomes=await Promise.allSettled([updateOrderStatus(race.id,{status:"PROCESSING",expectedStatus:"PLACED"},staff),updateOrderStatus(race.id,{status:"CANCELLED",expectedStatus:"PLACED"},employee)]);
  assert.equal(outcomes.filter(o=>o.status==="fulfilled").length,1);
  const saved=await getOrder(race.id,owner.id,owner.role);assert.equal(parseStatusHistory(saved.statusHistory).length,2);
  console.info(JSON.stringify({forwardFlow:true,skipAndTerminalRejected:true,cancelPolicy:true,ownership:true,statusNotifications:4,notificationLinksOwnerScoped:true,emailTransportMocked:true,mockedEmails,atomicRaceOneSuccess:true,totalsUnchanged:true}));
 }finally{
  globalThis.fetch=fetchOriginal;
  await prisma.$transaction(async tx=>{
   await tx.notification.deleteMany({where:{OR:[{userId:{in:ids}},{message:{contains:marker}}]}});
   await tx.orderItem.deleteMany({where:{order:{userId:{in:ids}}}});
   await tx.order.deleteMany({where:{userId:{in:ids}}});
   await tx.user.deleteMany({where:{id:{in:ids}}});
  },{timeout:20000});
  assert.deepEqual(await prisma.order.findMany({select:{id:true,status:true,statusHistory:true,totalPrice:true,updatedAt:true},orderBy:{id:"asc"}}),original);
  console.info(JSON.stringify({fixtureCleanup:true,allPreExistingOrdersUnchanged:true}));
 }
}
void main().catch((e:unknown)=>{console.error(e instanceof Error?e.message:"Status integration failed");process.exitCode=1;}).finally(()=>prisma.$disconnect());
