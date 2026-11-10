import {expect,it,vi} from "vitest";
import type {Request,Response,NextFunction} from "express";
import {randomUUID} from "node:crypto";
import {checkoutSchema} from "../src/modules/orders/orders.schemas";
import {createAddressSchema} from "../src/modules/addresses/addresses.schemas";
import {checkoutRateLimit} from "../src/modules/orders/checkout-rate-limit";
const valid={userAddressId:randomUUID(),paymentMethod:"COD",checkoutKey:randomUUID(),items:[{productIdentifier:"FRAME-1",variantId:randomUUID(),quantity:1}]};
it("requires explicit COD and a valid retry key, and rejects empty/tampered carts",()=>{
 expect(checkoutSchema.safeParse(valid).success).toBe(true);
 for(const patch of [{paymentMethod:undefined},{paymentMethod:"CARD"},{checkoutKey:undefined},{checkoutKey:"bad"},{items:[]},{items:[{...valid.items[0],quantity:0}]},{items:[{...valid.items[0],quantity:-1}]},{items:[{...valid.items[0],quantity:1.5}]},{items:[{...valid.items[0],quantity:"1"}]},{totalPrice:1},{discountAmount:999}])
  expect(checkoutSchema.safeParse({...valid,...patch}).success).toBe(false);
});
it("rejects incomplete delivery addresses and invalid contact details",()=>{
 const address={addressLine:"12 Test Road",city:"Chennai",state:"Tamil Nadu",country:"India",postalCode:"600040",contactPerson:"Test customer",contactNumber:"9876543210"};
 expect(createAddressSchema.safeParse(address).success).toBe(true);
 for(const key of Object.keys(address))for(const value of ["",null,"   "])
  expect(createAddressSchema.safeParse({...address,[key]:value}).success).toBe(false);
 expect(createAddressSchema.safeParse({...address,contactNumber:"not a phone"}).success).toBe(false);
 expect(createAddressSchema.safeParse({...address,addressLine:"<script>alert(1)</script>"}).success).toBe(false);
});
it("limits rapid checkout attempts per authenticated customer and separately per IP",()=>{
 const invoke=(id:string,ip:string)=>{
  const next=vi.fn(),setHeader=vi.fn();
  checkoutRateLimit({auth:{user:{id}},ip} as unknown as Request,{setHeader} as unknown as Response,next as NextFunction);
  return {next,setHeader};
 };
 const id=randomUUID(),ip=randomUUID();
 for(let i=0;i<10;i++)expect(invoke(id,ip).next).toHaveBeenCalledWith();
 const blocked=invoke(id,ip);expect(blocked.next).toHaveBeenCalledWith(expect.objectContaining({statusCode:429,code:"CHECKOUT_RATE_LIMIT"}));
 expect(blocked.setHeader).toHaveBeenCalledWith("Retry-After",expect.any(Number));
 const shared=randomUUID();
 for(let i=0;i<30;i++)expect(invoke(randomUUID(),shared).next).toHaveBeenCalledWith();
 expect(invoke(randomUUID(),shared).next).toHaveBeenCalledWith(expect.objectContaining({statusCode:429}));
});
