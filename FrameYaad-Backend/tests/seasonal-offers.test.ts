import {it,expect,vi} from "vitest";
import {Prisma} from "@prisma/client";
import {OFFER_CODES,OFFER_SEED_DEFAULTS,isThresholdOffer} from "../src/modules/checkout/coupons.config";
import {thresholdOfferEligible} from "../src/modules/checkout/offer-pricing";
import {eligibleOffers,validateOffer} from "../src/modules/checkout/checkout.service";
import {offerCodeSchema} from "../src/modules/checkout/checkout.schemas";
import {fixedOfferCode,updateOfferSchema} from "../src/modules/offers/offers.schemas";
import {updateBannerSchema} from "../src/modules/home-banner/home-banner.service";
import {seedOffers} from "../src/modules/offers/offers.seed";
const seasonal=["NEW_YEAR","CHRISTMAS","PONGAL"] as const;
function fixture(code:typeof seasonal[number]){
 const rows=Object.values(OFFER_SEED_DEFAULTS).map(o=>({...o,enabled:o.code===code||o.code==="FIRST_ORDER",percentage:new Prisma.Decimal(o.code===code?12:o.percentage),minOrderAmount:o.minOrderAmount===null?null:new Prisma.Decimal(o.code===code?2000:o.minOrderAmount),version:1,updatedBy:null,updatedAt:new Date()}));
 const tx={offer:{findMany:vi.fn().mockImplementation(()=>Promise.resolve(rows))},user:{findUniqueOrThrow:vi.fn().mockResolvedValue({email:"season@example.invalid",phoneNumber:""})},$queryRaw:vi.fn().mockResolvedValue([{found:false}])};
 return {rows,tx:tx as unknown as Prisma.TransactionClient};
}
it.each(seasonal)("%s has safe disabled placeholders and fixed whitelists",code=>{
 expect(OFFER_SEED_DEFAULTS[code]).toMatchObject({code,percentage:10,minOrderAmount:1000,enabled:false});
 for(const schema of [offerCodeSchema,fixedOfferCode])expect(schema.safeParse(code).success).toBe(true);
 expect(updateBannerSchema.safeParse({featuredOfferCode:code}).success).toBe(true);
 expect(updateOfferSchema.safeParse({version:1,code,percentage:10}).success).toBe(false);
});
it.each(seasonal)("%s uses live values, strict > minimum, best discount and immutable snapshots",async code=>{
 const {tx,rows}=fixture(code);
 for(const amount of [1999,2000])expect((await eligibleOffers(tx,"u",amount,true)).offers.some(o=>o.code===code)).toBe(false);
 const quote=await eligibleOffers(tx,"u",2500,true);
 expect(quote.offers.find(o=>o.code===code)).toMatchObject({percent:12,discountAmount:300,total:2200,bestOffer:true});
 const saved=await validateOffer(tx,"u",2500,code,1);expect(saved.couponCode).toBe(code);expect(saved.couponTitle).toBe(OFFER_SEED_DEFAULTS[code].title);expect(saved.total.toNumber()).toBe(2200);
 expect((await validateOffer(tx,"u",2500,"FIRST_ORDER",1)).total.toNumber()).toBe(2375);
 const row=rows.find(o=>o.code===code)!;row.enabled=false;
 await expect(validateOffer(tx,"u",2500,code,1)).rejects.toMatchObject({code:"OFFER_UNAVAILABLE",statusCode:409});
 row.enabled=true;row.version=2;row.percentage=new Prisma.Decimal(15);
  await expect(validateOffer(tx,"u",2500,code,1)).rejects.toMatchObject({code:"OFFER_UNAVAILABLE",details:{offers:expect.arrayContaining([expect.objectContaining({code,version:2,total:2125})]) as unknown}});
 expect(saved.discountPercent).toBe(12);expect(saved.total.toNumber()).toBe(2200);
});
it("all four threshold codes use the same rule; unknown and first-order codes cannot use it",()=>{
 for(const code of OFFER_CODES.filter(isThresholdOffer)){expect(thresholdOfferEligible({code,minOrderAmount:2000},2000)).toBe(false);expect(thresholdOfferEligible({code,minOrderAmount:2000},2500)).toBe(true);}
 for(const code of ["FIRST_ORDER","OTHER"])expect(thresholdOfferEligible({code,minOrderAmount:1},2500)).toBe(false);
});
it("idempotent insert-only seed cannot overwrite edited seasonal settings",async()=>{
 const stored=new Map<string,Record<string,unknown>>();const createMany=vi.fn(({data}:{data:Record<string,unknown>[];skipDuplicates:boolean})=>{for(const row of data)if(!stored.has(row.code as string))stored.set(row.code as string,{...row});return Promise.resolve({count:stored.size});});
 const tx={offer:{createMany}} as unknown as Prisma.TransactionClient;
 await seedOffers(tx);stored.get("NEW_YEAR")!.percentage=12;stored.get("NEW_YEAR")!.enabled=true;await seedOffers(tx);
 expect(stored.size).toBe(5);expect(stored.get("NEW_YEAR")).toMatchObject({percentage:12,enabled:true});expect(createMany.mock.calls.every(call=>call[0].skipDuplicates)).toBe(true);
});
