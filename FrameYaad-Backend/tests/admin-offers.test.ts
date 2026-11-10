import {Prisma} from "@prisma/client";
import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({findMany:vi.fn(),findUnique:vi.fn(),updateMany:vi.fn(),createMany:vi.fn(),audit:vi.fn(),group:vi.fn(),users:vi.fn(),transaction:vi.fn(),query:vi.fn()}));
vi.mock("../src/prisma/client",()=>({prisma:{offer:{findMany:mocks.findMany,findUniqueOrThrow:mocks.findUnique,updateMany:mocks.updateMany,createMany:mocks.createMany},offerAudit:{createMany:mocks.audit},order:{groupBy:mocks.group},user:{findMany:mocks.users},$transaction:mocks.transaction}}));
import {updateOfferSchema} from "../src/modules/offers/offers.schemas";
import {seedOffers} from "../src/modules/offers/offers.seed";
import {invalidateOffers,runtimeOffers,updateOffer,offerDescription} from "../src/modules/offers/offers.service";
import {validateOffer,eligibleOffers} from "../src/modules/checkout/checkout.service";
const settings=()=>[{code:"FIRST_ORDER",title:"First Order Offer",description:"First",percentage:new Prisma.Decimal(5),minOrderAmount:null,enabled:true,version:1,updatedBy:null,updatedAt:new Date()},{code:"BIG_ORDER",title:"Big Order Offer",description:"Big",percentage:new Prisma.Decimal(10),minOrderAmount:new Prisma.Decimal(5000),enabled:true,version:1,updatedBy:null,updatedAt:new Date()}];
let rows= settings();
beforeEach(()=>{
 vi.clearAllMocks();invalidateOffers();rows=settings();
 mocks.findMany.mockImplementation(()=>Promise.resolve(rows.map(o=>({...o}))));
 mocks.findUnique.mockImplementation(({where}:{where:{code:string}})=>Promise.resolve({...rows.find(o=>o.code===where.code)}));
 mocks.updateMany.mockImplementation(({where,data}:{where:{code:string;version:number};data:Record<string,unknown>})=>{
  const row=rows.find(o=>o.code===where.code);if(!row||row.version!==where.version)return Promise.resolve({count:0});
  if(data.percentage!==undefined)row.percentage=new Prisma.Decimal(data.percentage as number);
  if(data.minOrderAmount!==undefined)row.minOrderAmount=new Prisma.Decimal(data.minOrderAmount as number);
  if(data.enabled!==undefined)row.enabled=data.enabled as boolean;
  row.version++;return Promise.resolve({count:1});
 });
 mocks.transaction.mockImplementation((fn:(tx:unknown)=>unknown)=>fn({offer:{findUniqueOrThrow:mocks.findUnique,updateMany:mocks.updateMany},offerAudit:{createMany:mocks.audit}}));
 mocks.group.mockResolvedValue([]);mocks.users.mockResolvedValue([]);mocks.createMany.mockResolvedValue({count:0});
});
it.each([0,-5,101,NaN,Infinity,"", " ","abc","1000%",1.001])("rejects invalid percentage %s",percentage=>expect(updateOfferSchema.safeParse({version:1,percentage}).success).toBe(false));
it.each([0,-1,1.5,"", "abc",NaN])("rejects invalid minimum %s",minOrderAmount=>expect(updateOfferSchema.safeParse({version:1,minOrderAmount}).success).toBe(false));
it("accepts valid precision and rejects code/title/role/creator/version tampering",()=>{
 expect(updateOfferSchema.safeParse({version:1,percentage:8.25}).success).toBe(true);
 for(const data of [{code:"NEW"},{title:"Changed"},{role:"ADMIN"},{updatedBy:"attacker"},{percentage:5,version:0}])expect(updateOfferSchema.safeParse({version:1,...data}).success).toBe(false);
});
it("seeds with skipDuplicates and never supplies update data",async()=>{
 rows[0]!.percentage=new Prisma.Decimal(8);await seedOffers();await seedOffers();
 expect(mocks.createMany).toHaveBeenCalledTimes(2);
 const call=mocks.createMany.mock.calls[0]?.[0] as {data:unknown[];skipDuplicates:boolean};
 expect(call.skipDuplicates).toBe(true);expect(call.data).toHaveLength(2);
 expect(rows[0]!.percentage.toNumber()).toBe(8);
});
it("records exactly the changed fields and prevents stale edits",async()=>{
 await updateOffer("FIRST_ORDER",{version:1,percentage:8},{id:"staff",name:"Staff Name"});
 expect(mocks.audit).toHaveBeenCalledWith({data:[{offerCode:"FIRST_ORDER",field:"percentage",oldValue:5,newValue:8,actorId:"staff",actorName:"Staff Name"}]});
 await expect(updateOffer("FIRST_ORDER",{version:1,percentage:9},{id:"other",name:"Other"})).rejects.toMatchObject({statusCode:409,code:"OFFER_CONFLICT"});
 await expect(updateOffer("FIRST_ORDER",{version:2,minOrderAmount:3000},{id:"staff",name:"Staff"})).rejects.toMatchObject({statusCode:400});
});
it("checks version signatures across cache readers and invalidates after update",async()=>{
 await runtimeOffers();await runtimeOffers();expect(mocks.findMany).toHaveBeenCalledTimes(3);
 rows[0]!.version=2;rows[0]!.percentage=new Prisma.Decimal(8);
 expect(Number((await runtimeOffers())[0]?.percentage)).toBe(8);
 invalidateOffers();await runtimeOffers();expect(mocks.findMany).toHaveBeenCalledTimes(7);
});
const tx=()=>({offer:{findMany:mocks.findMany},user:{findUniqueOrThrow:vi.fn().mockResolvedValue({email:"new@example.invalid",phoneNumber:"9876543210"})},$queryRaw:vi.fn().mockResolvedValue([{found:false}])}) as unknown as Prisma.TransactionClient;
it("uses live percentages/minimums, not seed defaults",async()=>{
 rows[0]!.percentage=new Prisma.Decimal(8);rows[1]!.minOrderAmount=new Prisma.Decimal(3000);
 const quote=await eligibleOffers(tx(),"customer",3500,true);
 expect(quote.offers.find(o=>o.code==="FIRST_ORDER")).toMatchObject({percent:8,discountAmount:280});
 expect(quote.offers.find(o=>o.code==="BIG_ORDER")).toMatchObject({percent:10,discountAmount:350});
 expect((await eligibleOffers(tx(),"customer",2900,true)).offers.some(o=>o.code==="BIG_ORDER")).toBe(false);
 expect(offerDescription(rows[1]!)).toContain("3,000");
});
it("hides disabled settings and rejects stale or missing quote versions",async()=>{
 rows[0]!.enabled=false;expect((await eligibleOffers(tx(),"customer",2000,true)).offers).toEqual([]);
 await expect(validateOffer(tx(),"customer",2000,"FIRST_ORDER",1)).rejects.toMatchObject({code:"OFFER_UNAVAILABLE"});
 rows[0]!.enabled=true;rows[0]!.version=2;
 await expect(validateOffer(tx(),"customer",2000,"FIRST_ORDER",1)).rejects.toMatchObject({code:"OFFER_UNAVAILABLE",message:"This offer was updated. Please review your total."});
 await expect(validateOffer(tx(),"customer",2000,"FIRST_ORDER")).rejects.toMatchObject({code:"OFFER_UNAVAILABLE"});
 expect((await validateOffer(tx(),"customer",2000,"FIRST_ORDER",2)).total.toNumber()).toBe(1900);
 rows[0]!.enabled=false;rows[1]!.enabled=false;
 expect((await eligibleOffers(tx(),"customer",6000,true)).offers).toEqual([]);
});
