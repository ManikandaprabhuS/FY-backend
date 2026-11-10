import { describe,expect,it,vi } from "vitest";
import { Prisma } from "@prisma/client";
import { OFFER_SEED_DEFAULTS as CHECKOUT_OFFERS } from "../src/modules/checkout/coupons.config";
import { normalizeOfferEmail,normalizeOfferPhone,offerTotals } from "../src/modules/checkout/offer-pricing";
import { eligibleOffers,validateOffer,lockOfferIdentity,priceCheckoutItems,hasOrderHistory } from "../src/modules/checkout/checkout.service";
import { checkoutSchema } from "../src/modules/orders/orders.schemas";
const fixture=(history=false)=>({offer:{findMany:vi.fn().mockResolvedValue(Object.values(CHECKOUT_OFFERS).map(o=>({...o,percentage:new Prisma.Decimal(o.percentage),minOrderAmount:o.minOrderAmount==null?null:new Prisma.Decimal(o.minOrderAmount),version:1,updatedBy:null,updatedAt:new Date()})))},user:{findUniqueOrThrow:vi.fn().mockResolvedValue({email:" NEW@EXAMPLE.COM ",phoneNumber:"+91 98765-43210"})},$queryRaw:vi.fn().mockResolvedValue([{found:history}])});
const db=(value:unknown)=>value as Prisma.TransactionClient;
describe("two checkout offers",()=>{
 it("has exactly two codes in one config",()=>expect(Object.keys(CHECKOUT_OFFERS)).toEqual(["FIRST_ORDER","BIG_ORDER"]));
 it("normalizes email and Indian phone without corrupting other lengths",()=>{
  expect(normalizeOfferEmail(" A@Example.COM ")).toBe("a@example.com");
  expect(normalizeOfferPhone("+91 98765-43210")).toBe("9876543210");
  expect(normalizeOfferPhone("9198765")).toBe("9198765");
 });
 it.each([[2000,["FIRST_ORDER"]],[5000,["FIRST_ORDER"]],[5001,["FIRST_ORDER","BIG_ORDER"]],[6000,["FIRST_ORDER","BIG_ORDER"]]])("eligible offers at %s",async(amount,codes)=>{
  const result=await eligibleOffers(db(fixture()),"customer",amount);
  expect(result.offers.map(o=>o.code)).toEqual(codes);
  if(amount===6000){expect(result.offers.find(o=>o.code==="BIG_ORDER")).toMatchObject({bestOffer:true,discountAmount:600,total:5400});}
 });
 it.each([2000,5000])("advertises Big Order as unavailable at %s without making it applicable",async(amount)=>{
  const result=await eligibleOffers(db(fixture()),"customer",amount,true);
  expect(result.unavailableOffers).toEqual([expect.objectContaining({code:"BIG_ORDER",percent:10,discountAmount:0,unavailableReason:"Available on orders above Rs. 5,000."})]);
  expect(result.offers.some(o=>o.code==="BIG_ORDER")).toBe(false);
  await expect(validateOffer(db(fixture()),"customer",amount,"BIG_ORDER",1)).rejects.toMatchObject({code:"OFFER_UNAVAILABLE"});
 });
 it("unlocks Big Order above the minimum and never advertises a disabled offer",async()=>{
  expect((await eligibleOffers(db(fixture()),"customer",5001,true)).unavailableOffers).toEqual([]);
  const tx=fixture();
  tx.offer.findMany.mockResolvedValueOnce(Object.values(CHECKOUT_OFFERS).map(o=>({...o,enabled:o.code!=="BIG_ORDER",percentage:new Prisma.Decimal(o.percentage),minOrderAmount:o.minOrderAmount==null?null:new Prisma.Decimal(o.minOrderAmount),version:1,updatedBy:null,updatedAt:new Date()})));
  expect((await eligibleOffers(db(tx),"customer",2000,true)).unavailableOffers).toEqual([]);
 });
 it("hides first-order for any email OR phone history without revealing a reason",async()=>{
  const result=await eligibleOffers(db(fixture(true)),"customer",2000);
  expect(result.offers).toEqual([]);
  const raw=fixture();await hasOrderHistory(db(raw),"test@example.invalid","9876543210");
  const sql=raw.$queryRaw.mock.calls[0]?.[0] as Prisma.Sql;
  expect(sql.sql).toContain('o."offerEmail"');expect(sql.sql).toContain('o."offerPhone"');expect(sql.sql).toContain(" OR ");
 });
 it("replaces rather than stacks offers and rounds money once",async()=>{
  const tx=db(fixture());
  expect((await validateOffer(tx,"customer",6000,"FIRST_ORDER",1)).total.toNumber()).toBe(5700);
  expect((await validateOffer(tx,"customer",6000,"BIG_ORDER",1)).total.toNumber()).toBe(5400);
  expect(offerTotals("5001.01",10).discountAmount.toFixed(2)).toBe("500.10");
  expect(offerTotals(-20,10).total.toNumber()).toBe(0);
 });
 it("rejects an invalidated offer with updated totals",async()=>{
  await expect(validateOffer(db(fixture(true)),"customer",2000,"FIRST_ORDER")).rejects.toMatchObject({code:"OFFER_UNAVAILABLE",statusCode:409,details:{offers:[]}});
  await expect(validateOffer(db(fixture()),"customer",5000,"BIG_ORDER")).rejects.toMatchObject({code:"OFFER_UNAVAILABLE"});
 });
 it("accepts only a code, rejects tampered totals and arbitrary codes",()=>{
  const valid={userAddressId:"99999999-9999-4999-8999-999999999999",paymentMethod:"COD",checkoutKey:"99999999-9999-4999-8999-999999999998"};
  expect(checkoutSchema.safeParse({...valid,couponCode:"BIG_ORDER"}).success).toBe(true);
  for(const patch of [{couponCode:"FREE"},{discountAmount:2000},{total:1},{couponId:"old"}])expect(checkoutSchema.safeParse({...valid,...patch}).success).toBe(false);
 });
 it("takes deterministic transaction-scoped locks for both identity keys",async()=>{
  const tx=fixture();await lockOfferIdentity(db(tx),"email@example.invalid","9876543210");
  expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  const queries=tx.$queryRaw.mock.calls.map(call=>call[0] as Prisma.Sql);
  expect(queries.map(q=>q.values[0])).toEqual(["email:email@example.invalid","phone:9876543210"]);
  expect(queries[0]?.sql).toContain("pg_advisory_xact_lock");
 });
 it("ignores prices supplied by the browser and resolves the selected variant on the server",async()=>{
  const tx={product:{findMany:vi.fn().mockResolvedValue([{id:"p",productIdentifier:"P",productName:"Frame",material:{name:"Wood",isActive:true},variant:null,variants:[{id:"v",isActive:true,price:new Prisma.Decimal(500),stockQuantity:5,frameSize:"5x5",color:"Black"}]}])}};
  const rows=await priceCheckoutItems(db(tx),[{productIdentifier:"P",variantId:"v",quantity:2}]);
  expect(rows[0]?.subtotal.toNumber()).toBe(1000);
  await expect(priceCheckoutItems(db(tx),[{productIdentifier:"P",variantId:"v",quantity:6}])).rejects.toMatchObject({code:"INSUFFICIENT_STOCK"});
 });
});
