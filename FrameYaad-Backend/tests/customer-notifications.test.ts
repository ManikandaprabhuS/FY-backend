import {beforeEach,expect,it,vi} from "vitest";
import {Prisma} from '@prisma/client';
const m=vi.hoisted(()=>({raw:vi.fn(),upsert:vi.fn(),remove:vi.fn()}));
vi.mock("../src/prisma/client",()=>({prisma:{$queryRaw:m.raw,customerNotification:{upsert:m.upsert,deleteMany:m.remove}}}));
import {listCustomerNotifications,customerUnreadCount,readCustomerNotification,notifyCustomer,cleanupCustomerNotifications,startCustomerNotificationCleanup} from "../src/modules/customer-notifications/customer-notifications.service";
beforeEach(()=>{vi.clearAllMocks();m.raw.mockResolvedValue([{notifications:[],total:5,unread:3}]);m.upsert.mockResolvedValue({id:"event"});});
it("uses one parameterized merged query for a scoped page and its full-history counts",async()=>{
 const result=await listCustomerNotifications("owner",{page:2,limit:20,userId:'foreign'});
 expect(result.pagination.page).toBe(2);expect(result.summary).toEqual({totalCount:5,unreadCount:3,readCount:2});
 expect(m.raw).toHaveBeenCalledTimes(1);
 const sql=m.raw.mock.calls[0]![0] as Prisma.Sql;
 expect(sql.sql).toContain('UNION ALL');expect(sql.sql).toContain('public.notifications');expect(sql.sql).toContain('public.customer_notifications');
 expect(sql.sql).not.toContain('90');expect(sql.values).toContain('owner');expect(sql.values).not.toContain('foreign');
 expect(sql.values).toContain(20);
 await customerUnreadCount("owner");expect(m.raw).toHaveBeenCalledTimes(2);
 await expect(listCustomerNotifications("owner",{limit:1000})).rejects.toThrow();
});
it("uses shared full-history counts for filtered pagination",async()=>{
 const unread=await listCustomerNotifications('owner',{read:'false'});
 expect(unread.pagination.total).toBe(3);expect(unread.summary.readCount).toBe(2);
 const read=await listCustomerNotifications('owner',{read:'true'});
 expect(read.pagination.total).toBe(2);expect(read.summary.unreadCount).toBe(3);
});
it("marks both customer sources in one atomic batched statement, then returns shared counts",async()=>{
 m.raw.mockResolvedValueOnce([{owned:true}]);
 expect(await readCustomerNotification("owner")).toEqual({unreadCount:3,summary:{totalCount:5,unreadCount:3,readCount:2}});
 expect(m.raw).toHaveBeenCalledTimes(2);
 const sql=m.raw.mock.calls[0]![0] as Prisma.Sql;
 expect(sql.sql).toContain('modern_update');expect(sql.sql).toContain('legacy_update');expect(sql.values).toContain('owner');
 expect(sql.sql).toContain('NOT read');expect(sql.sql).toContain('NOT "isRead"');
});
it("cannot mark another customer's event and accepts an already-read owned record",async()=>{
 m.raw.mockResolvedValueOnce([{owned:false}]);
 await expect(readCustomerNotification("owner","foreign")).rejects.toMatchObject({statusCode:404});
 const sql=m.raw.mock.calls[0]![0] as Prisma.Sql;expect(sql.values).toContain('owner');expect(sql.values).toContain('foreign');
 m.raw.mockResolvedValueOnce([{owned:true}]);
 await expect(readCustomerNotification("owner","owned")).resolves.toMatchObject({unreadCount:3});
});
it("keeps notification creation text and stable event IDs unchanged",async()=>{
 await notifyCustomer("owner","ORDER_PLACED",{eventId:"event",orderId:"order",orderNumber:"FY-1234"});
 expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({where:{id:"event"},update:{},create:expect.objectContaining({userId:"owner",orderId:"order",message:"Your order FY-1234 has been placed."}) as unknown}));
 await notifyCustomer("owner","ORDER_STATUS",{eventId:"cancel",orderId:"order",orderNumber:"FY-1234",status:"Cancelled"});
 expect(m.upsert).toHaveBeenLastCalledWith(expect.objectContaining({create:expect.objectContaining({type:"ORDER_CANCELLED",title:"Order cancelled"}) as unknown}));
});
it("retains full customer history without a pruning timer or delete query",async()=>{
 vi.useFakeTimers();try{expect(await cleanupCustomerNotifications()).toEqual({count:0});const stop=startCustomerNotificationCleanup();expect(vi.getTimerCount()).toBe(0);stop();expect(m.remove).not.toHaveBeenCalled();}finally{vi.useRealTimers();}
});
