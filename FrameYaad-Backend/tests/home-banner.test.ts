import {Prisma} from "@prisma/client";
import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({setting:vi.fn(),offer:vi.fn(),get:vi.fn(),user:vi.fn(),seed:vi.fn(),transaction:vi.fn(),update:vi.fn(),audit:vi.fn(),identity:vi.fn(),history:vi.fn()}));
vi.mock("../src/prisma/client",()=>({prisma:{homepageBanner:{findUnique:m.setting,findUniqueOrThrow:m.get,createMany:m.seed},offer:{findUnique:m.offer},user:{findUnique:m.user},$transaction:m.transaction}}));
vi.mock("../src/modules/checkout/checkout.service",()=>({offerIdentity:m.identity,hasOrderHistory:m.history}));
import {publicHomepageBanner,updateHomepageBanner,seedHomepageBanner,updateBannerSchema} from "../src/modules/home-banner/home-banner.service";
import {invalidateHomepageBanner} from "../src/modules/home-banner/banner-cache";
beforeEach(()=>{
 vi.clearAllMocks();invalidateHomepageBanner();
 m.setting.mockResolvedValue({enabled:true,featuredOfferCode:"BIG_ORDER"});
 m.offer.mockResolvedValue({code:"BIG_ORDER",title:"Big Order Offer",enabled:true,percentage:new Prisma.Decimal(10),minOrderAmount:new Prisma.Decimal(5000)});
 m.identity.mockResolvedValue({email:"customer@example.invalid",phone:"9876543210"});m.history.mockResolvedValue(false);
});
it("returns only live safe fields and shares only the non-personal configuration cache",async()=>{
 expect(await publicHomepageBanner()).toEqual({code:"BIG_ORDER",title:"Big Order Offer",percentage:10,minOrderAmount:5000});
 await publicHomepageBanner();expect(m.setting).toHaveBeenCalledTimes(1);expect(m.offer).toHaveBeenCalledTimes(1);
});
it.each(["banner-off","offer-off","offer-missing"])("returns no banner for %s",async mode=>{
 if(mode==="banner-off")m.setting.mockResolvedValue({enabled:false,featuredOfferCode:"BIG_ORDER"});
 if(mode==="offer-off")m.offer.mockResolvedValue({code:"BIG_ORDER",enabled:false});
 if(mode==="offer-missing")m.offer.mockResolvedValue(null);
 expect(await publicHomepageBanner()).toBeNull();
});
it("First Order is visible to guests/new customers but eligibility is checked freshly per customer",async()=>{
 m.setting.mockResolvedValue({enabled:true,featuredOfferCode:"FIRST_ORDER"});
 m.offer.mockResolvedValue({code:"FIRST_ORDER",title:"First Order Offer",enabled:true,percentage:new Prisma.Decimal(5),minOrderAmount:null});
 expect((await publicHomepageBanner())?.percentage).toBe(5);expect(m.history).not.toHaveBeenCalled();
 expect((await publicHomepageBanner({id:"new",role:"CUSTOMER"}))?.code).toBe("FIRST_ORDER");
 m.history.mockResolvedValueOnce(true);expect(await publicHomepageBanner({id:"returning",role:"CUSTOMER"})).toBeNull();
 expect((await publicHomepageBanner({id:"another-new",role:"CUSTOMER"}))?.code).toBe("FIRST_ORDER");
 expect(m.identity).toHaveBeenCalledWith(expect.anything(),"returning");
});
it("invalidating after offer changes reads updated percentages/minimums immediately",async()=>{
 await publicHomepageBanner();m.offer.mockResolvedValue({code:"BIG_ORDER",title:"Big Order Offer",enabled:true,percentage:new Prisma.Decimal(12),minOrderAmount:new Prisma.Decimal(3000)});
 invalidateHomepageBanner();expect(await publicHomepageBanner()).toMatchObject({percentage:12,minOrderAmount:3000});
});
it("whitelists only enabled and the two fixed offer codes",()=>{
 for(const value of [{},{enabled:"true"},{featuredOfferCode:"OTHER"},{title:"bad"},{enabled:true,percentage:99}])expect(updateBannerSchema.safeParse(value).success).toBe(false);
 expect(updateBannerSchema.safeParse({enabled:false,featuredOfferCode:"FIRST_ORDER"}).success).toBe(true);
});
it("seeds without overwriting edits and records changes in the existing offers audit",async()=>{
 await seedHomepageBanner();expect(m.seed).toHaveBeenCalledWith({data:[{id:"homepage_banner",enabled:true,featuredOfferCode:"BIG_ORDER"}],skipDuplicates:true});
 const previous={id:"homepage_banner",enabled:true,featuredOfferCode:"BIG_ORDER",updatedBy:null,updatedAt:new Date()};
 m.get.mockResolvedValue(previous);m.user.mockResolvedValue({id:"staff",name:"Staff"});
 m.transaction.mockImplementation((callback:(tx:unknown)=>Promise<unknown>)=>callback({$queryRawUnsafe:vi.fn(),homepageBanner:{findUniqueOrThrow:m.get,update:m.update},offerAudit:{createMany:m.audit}}));
 await updateHomepageBanner({enabled:false,featuredOfferCode:"FIRST_ORDER"},{id:"staff",name:"Staff"});
 expect(m.audit).toHaveBeenCalledWith({data:[{offerCode:"FIRST_ORDER",field:"banner.enabled",oldValue:true,newValue:false,actorId:"staff",actorName:"Staff"},{offerCode:"FIRST_ORDER",field:"banner.featuredOfferCode",oldValue:"BIG_ORDER",newValue:"FIRST_ORDER",actorId:"staff",actorName:"Staff"}]});
});
