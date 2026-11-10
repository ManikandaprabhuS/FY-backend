import {expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({legacy:vi.fn(),orders:vi.fn(),insert:vi.fn()}));
vi.mock("../src/prisma/client",()=>({prisma:{notification:{findMany:m.legacy},order:{findMany:m.orders},customerNotification:{createMany:m.insert}}}));
import {importLegacyCustomerOrderNotifications} from "../src/modules/customer-notifications/legacy-customer-notifications";
it("restores read and unread order updates with original timestamps and owner-verified links",async()=>{
 const createdAt=new Date("2026-11-10T11:49:32Z"),updatedAt=new Date("2026-11-10T11:51:33Z");
 m.legacy.mockResolvedValue([{id:"old-placement",title:"Order placed",message:"Your order FY-8257 has been placed successfully.",type:"ORDER_PLACED",read:true,createdAt},{id:"status-event",title:"Order status updated",message:"Your order FY-8257 is now Processing",type:"INFO",read:false,createdAt:updatedAt},{id:"foreign",title:"Order placed",message:"Your order FY-9999 has been placed.",type:"ORDER_PLACED",read:false,createdAt}]);
 m.orders.mockResolvedValue([{id:"owned-order",orderNumber:"FY-8257"}]);m.insert.mockResolvedValue({count:2});
 const first=importLegacyCustomerOrderNotifications("owner"),second=importLegacyCustomerOrderNotifications("owner");
 expect(first).toBe(second);await first;
 expect(m.orders).toHaveBeenCalledWith({where:{userId:"owner",orderNumber:{in:["FY-8257","FY-9999"]}},select:{id:true,orderNumber:true}});
 const write=m.insert.mock.calls[0]?.[0] as {data:Array<{id:string;userId:string;orderId:string;isRead:boolean;createdAt:Date}>;skipDuplicates:boolean};
 expect(write.skipDuplicates).toBe(true);expect(write.data).toHaveLength(2);
 expect(write.data[0]).toMatchObject({id:"owned-order",userId:"owner",orderId:"owned-order",isRead:true,createdAt});
 expect(write.data[1]).toMatchObject({id:"status-event",isRead:false,createdAt:updatedAt});
 await importLegacyCustomerOrderNotifications("owner");expect(m.legacy).toHaveBeenCalledTimes(1);
});
