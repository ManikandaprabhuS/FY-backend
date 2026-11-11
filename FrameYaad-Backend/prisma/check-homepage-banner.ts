import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {PrismaClient,type Prisma} from "@prisma/client";
import {env} from "../src/config/env";
const database=new PrismaClient({datasourceUrl:env.NODE_ENV==="development"?env.DIRECT_URL:env.DATABASE_URL});
const rollback=new Error("BANNER_TEST_ROLLBACK");
async function main(){
 if(env.NODE_ENV==="production"||!process.argv.includes("--run"))throw new Error("Use --run on the test DB.");
 const originalSettings=await database.homepageBanner.findMany();
 const originalOffers=await database.offer.findMany({orderBy:{code:"asc"}});
 const originalAudit=await database.offerAudit.count();
 const originalOrders=await database.order.aggregate({_count:true,_sum:{totalPrice:true}});
 try{await database.$transaction(async tx=>{
  (globalThis as unknown as {prisma:PrismaClient}).prisma=new Proxy(database,{get(_target,key):unknown{
   if(key==="$transaction")return(callback:(client:Prisma.TransactionClient)=>Promise<unknown>)=>callback(tx);
   return Reflect.get(tx,key) as unknown;
  }});
  const banner=await import("../src/modules/home-banner/home-banner.service.js");
  const offers=await import("../src/modules/offers/offers.service.js");
  const actor=await tx.user.findFirst({where:{role:{in:["ADMIN","EMPLOYEE"]}},select:{id:true,name:true}});assert(actor);
  await banner.updateHomepageBanner({enabled:true,featuredOfferCode:"BIG_ORDER"},actor);
  const big=await tx.offer.findUniqueOrThrow({where:{code:"BIG_ORDER"}});
  await offers.updateOffer("BIG_ORDER",{version:big.version,percentage:12,minOrderAmount:3000,enabled:true},actor);
  assert.deepEqual(await banner.publicHomepageBanner(),{code:"BIG_ORDER",title:big.title,percentage:12,minOrderAmount:3000});
  await banner.updateHomepageBanner({enabled:false},actor);assert.equal(await banner.publicHomepageBanner(),null);
  const edited=await tx.homepageBanner.findMany();await banner.seedHomepageBanner(tx);await banner.seedHomepageBanner(tx);
  assert.deepEqual(await tx.homepageBanner.findMany(),edited);
  await banner.updateHomepageBanner({enabled:true},actor);
  const updatedBig=await tx.offer.findUniqueOrThrow({where:{code:"BIG_ORDER"}});
  await offers.updateOffer("BIG_ORDER",{version:updatedBig.version,enabled:false},actor);
  assert.equal(await banner.publicHomepageBanner(),null);
  const first=await tx.offer.findUniqueOrThrow({where:{code:"FIRST_ORDER"}});
  await offers.updateOffer("FIRST_ORDER",{version:first.version,enabled:true},actor);
  await banner.updateHomepageBanner({featuredOfferCode:"FIRST_ORDER"},actor);
  assert.equal((await banner.publicHomepageBanner())?.code,"FIRST_ORDER");
  const phone="8"+Date.now().toString().slice(-9);
  const owner=await tx.user.create({data:{name:"Banner test owner",email:randomUUID()+"@example.invalid",phoneNumber:phone,role:"CUSTOMER"}});
  const byEmail=await tx.user.create({data:{name:"Banner test email",email:randomUUID()+"@example.invalid",role:"CUSTOMER"}});
  const byPhone=await tx.user.create({data:{name:"Banner test phone",email:randomUUID()+"@example.invalid",phoneNumber:"+91 "+phone,role:"CUSTOMER"}});
  assert.equal((await banner.publicHomepageBanner({id:byEmail.id,role:"CUSTOMER"}))?.code,"FIRST_ORDER");
  const address=await tx.userAddress.create({data:{userId:owner.id,addressLine:"Temporary banner test",postalCode:"600040",city:"Chennai",state:"Tamil Nadu",country:"India",contactPerson:"Banner test",contactNumber:phone}});
  await tx.order.create({data:{userId:owner.id,userAddressId:address.id,orderNumber:"B-"+randomUUID(),totalPrice:100,offerEmail:byEmail.email,offerPhone:phone}});
  assert.equal(await banner.publicHomepageBanner({id:byEmail.id,role:"CUSTOMER"}),null);
  assert.equal(await banner.publicHomepageBanner({id:byPhone.id,role:"CUSTOMER"}),null);
  assert.equal((await banner.publicHomepageBanner())?.code,"FIRST_ORDER");
  assert((await tx.offerAudit.count({where:{field:{startsWith:"banner."},actorId:actor.id}}))>0);
  console.info(JSON.stringify({livePercentage:12,liveMinimum:3000,bannerOffHidden:true,offerOffHidden:true,seedPreservedEdits:true,guestsVisible:true,newCustomerVisible:true,emailHistoryHidden:true,phoneHistoryHidden:true,audit:true}));
  throw rollback;
 },{timeout:120000});}catch(error){if(error!==rollback)throw error;}
 assert.deepEqual(await database.homepageBanner.findMany(),originalSettings);
 assert.deepEqual(await database.offer.findMany({orderBy:{code:"asc"}}),originalOffers);
 assert.equal(await database.offerAudit.count(),originalAudit);
 assert.deepEqual(await database.order.aggregate({_count:true,_sum:{totalPrice:true}}),originalOrders);
 console.info("Rollback verified: original banner settings, offers, audit and orders unchanged.");
}
void main().catch(error=>{console.error(error instanceof Error?error.message:"Banner verification failed");process.exitCode=1;}).finally(()=>database.$disconnect());
