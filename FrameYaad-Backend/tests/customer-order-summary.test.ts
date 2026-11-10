import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({find:vi.fn(),count:vi.fn()}));
vi.mock("../src/prisma/client",()=>({prisma:{order:{findMany:m.find,count:m.count}}}));
import {listCustomerOrderSummaries} from "../src/modules/orders/customer-order-summary";
beforeEach(()=>{vi.clearAllMocks();m.find.mockResolvedValue([]);m.count.mockResolvedValue(0);});
it("uses a bounded owner-scoped list and excludes full detail/sensitive fields",async()=>{
 await listCustomerOrderSummaries("owner",{page:2,limit:10,userId:"foreign"});
 expect(m.find).toHaveBeenCalledWith(expect.objectContaining({where:{userId:"owner"},skip:10,take:10}));
 const query=m.find.mock.calls[0]?.[0] as {select:Record<string,unknown>};
 expect(query.select).not.toHaveProperty("statusHistory");expect(query.select).not.toHaveProperty("user");expect(query.select).not.toHaveProperty("userAddress");
 expect(query.select.items).toMatchObject({take:3});expect(m.find).toHaveBeenCalledTimes(1);expect(m.count).toHaveBeenCalledTimes(1);
});
it.each([0,5,105])("returns the correct total for %s orders",async total=>{
 m.count.mockResolvedValue(total);
 const result=await listCustomerOrderSummaries("owner",{});expect(result.pagination.total).toBe(total);expect(result.pagination.limit).toBe(10);
});
it("uses snapshots for names and safely handles products with no image",async()=>{
 m.find.mockResolvedValue([{id:"order",orderNumber:"FY-1",createdAt:new Date(),status:"PLACED",totalPrice:123,_count:{items:5},items:[{id:"item",snapshotProductId:"product",snapshotProductName:"Original",quantity:2,product:null}]}]);
 const result=await listCustomerOrderSummaries("owner",{});expect(result.orders[0]).toMatchObject({total:123,itemCount:5,items:[{name:"Original",productId:"product",imageUrl:null}]});
});
