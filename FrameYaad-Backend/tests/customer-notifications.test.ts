import {beforeEach,expect,it,vi} from "vitest";
vi.mock("../src/modules/customer-notifications/legacy-customer-notifications",()=>({importLegacyCustomerOrderNotifications:vi.fn().mockResolvedValue(undefined)}));
const m=vi.hoisted(()=>({list:vi.fn(),count:vi.fn(),update:vi.fn(),find:vi.fn(),upsert:vi.fn(),remove:vi.fn()}));
vi.mock("../src/prisma/client",()=>({prisma:{customerNotification:{findMany:m.list,count:m.count,updateMany:m.update,findFirst:m.find,upsert:m.upsert,deleteMany:m.remove}}}));
import {listCustomerNotifications,customerUnreadCount,readCustomerNotification,notifyCustomer,cleanupCustomerNotifications} from "../src/modules/customer-notifications/customer-notifications.service";
beforeEach(()=>{vi.clearAllMocks();m.list.mockResolvedValue([]);m.count.mockResolvedValue(0);m.update.mockResolvedValue({count:1});m.find.mockResolvedValue(null);m.upsert.mockResolvedValue({id:"event"});});
it("scopes paginated lists and counts to the verified customer with bounded payloads",async()=>{
 const result=await listCustomerNotifications("owner",{page:2,limit:20});
 expect(result.pagination.page).toBe(2);
 expect(m.list).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({userId:"owner"}) as unknown,skip:20,take:20}));
 await customerUnreadCount("owner");expect(m.count).toHaveBeenLastCalledWith({where:expect.objectContaining({userId:"owner",isRead:false}) as unknown});
 await expect(listCustomerNotifications("owner",{limit:1000})).rejects.toThrow();
});
it("uses one scoped update for mark-all and returns an authoritative unread count",async()=>{
 m.count.mockResolvedValue(3);expect(await readCustomerNotification("owner")).toEqual({unreadCount:3});
 expect(m.update).toHaveBeenCalledTimes(1);expect(m.update).toHaveBeenCalledWith({where:{userId:"owner",isRead:false},data:{isRead:true}});
});
it("cannot mark another customer's notification and is idempotent for an owned read record",async()=>{
 m.update.mockResolvedValue({count:0});
 await expect(readCustomerNotification("owner","foreign")).rejects.toMatchObject({statusCode:404});
 expect(m.update).toHaveBeenCalledWith({where:{userId:"owner",id:"foreign",isRead:false},data:{isRead:true}});
 m.find.mockResolvedValue({id:"owned"});await expect(readCustomerNotification("owner","owned")).resolves.toEqual({unreadCount:0});
});
it("uses the stable event ID to deduplicate events and stores a safe order link",async()=>{
 await notifyCustomer("owner","ORDER_PLACED",{eventId:"event",orderId:"order",orderNumber:"FY-1234"});
 expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({where:{id:"event"},update:{},create:expect.objectContaining({userId:"owner",orderId:"order",message:"Your order FY-1234 has been placed."}) as unknown}));
 await notifyCustomer("owner","ORDER_STATUS",{eventId:"cancel",orderId:"order",orderNumber:"FY-1234",status:"Cancelled"});
 expect(m.upsert).toHaveBeenLastCalledWith(expect.objectContaining({create:expect.objectContaining({type:"ORDER_CANCELLED",title:"Order cancelled"}) as unknown}));
});
it("limits retention cleanup to the customer-notification model and the 90-day cutoff",async()=>{
 await cleanupCustomerNotifications();expect(m.remove).toHaveBeenCalledWith({where:{createdAt:{lt:expect.any(Date) as unknown}}});
 const cutoff=(m.remove.mock.calls[0]?.[0] as {where:{createdAt:{lt:Date}}}).where.createdAt.lt;
 expect(Math.abs(Date.now()-cutoff.getTime()-90*86400000)).toBeLessThan(1000);
});
