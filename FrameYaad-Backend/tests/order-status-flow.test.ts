import {Prisma,UserRole} from "@prisma/client";
import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({find:vi.fn(),update:vi.fn(),get:vi.fn(),transaction:vi.fn()}));
vi.mock("../src/prisma/client",()=>({prisma:{$transaction:mocks.transaction}}));
import {updateOrderStatus} from "../src/modules/orders/orders.service";
import {ORDER_STATUS_FLOW,parseStatusHistory} from "../src/modules/orders/order-status-flow";
let current:{id:string;userId:string;status:string;statusHistory:unknown};
beforeEach(()=>{
 vi.clearAllMocks();current={id:"order",userId:"owner",status:"PLACED",statusHistory:null};
 mocks.find.mockImplementation(({where}:{where:{userId?:string}})=>Promise.resolve(where.userId&&where.userId!==current.userId?null:{...current}));
 mocks.update.mockImplementation(({where,data}:{where:{status:string};data:{status:string;statusHistory:unknown}})=>{
  if(where.status!==current.status)return Promise.resolve({count:0});current={...current,...data};return Promise.resolve({count:1});
 });
 mocks.get.mockImplementation(()=>Promise.resolve({...current,totalPrice:new Prisma.Decimal(1000),createdAt:new Date("2026-01-01")}));
 mocks.transaction.mockImplementation((fn:(tx:unknown)=>unknown)=>fn({order:{findFirst:mocks.find,updateMany:mocks.update,findUniqueOrThrow:mocks.get}}));
});
const actor={id:"staff",role:UserRole.ADMIN};
it("defines exactly the five forward steps in one server config",()=>expect(ORDER_STATUS_FLOW.steps.map(s=>s.status)).toEqual(["PLACED","PROCESSING","READY_TO_SHIP","SHIPPED","DELIVERED"]));
it("moves one step at a time and captures server actor, timestamp and note",async()=>{
 for(const status of ["PROCESSING","READY_TO_SHIP","SHIPPED","DELIVERED"] as const)await updateOrderStatus("order",{status,note:"Packed carefully"},actor);
 expect(parseStatusHistory(current.statusHistory).map(e=>e.status)).toEqual(["PROCESSING","READY_TO_SHIP","SHIPPED","DELIVERED"]);
 expect(parseStatusHistory(current.statusHistory)[0]).toMatchObject({changedBy:{id:"staff",role:"ADMIN"},note:"Packed carefully",previousStatus:"PLACED"});
 expect(Number.isFinite(Date.parse(parseStatusHistory(current.statusHistory)[0]!.changedAt))).toBe(true);
});
it.each([["PLACED","SHIPPED"],["PROCESSING","PLACED"],["DELIVERED","PROCESSING"],["CANCELLED","PROCESSING"]])("rejects %s to %s with 400",async(from,to)=>{
 current.status=from!;
 await expect(updateOrderStatus("order",{status:to as "PROCESSING"},actor)).rejects.toMatchObject({statusCode:400,code:"INVALID_ORDER_STATUS_TRANSITION"});
 expect(mocks.update).not.toHaveBeenCalled();
});
it.each(["PLACED","PROCESSING"])("allows owner cancellation from %s only",async status=>{
 current.status=status;const result=await updateOrderStatus("order",{status:"CANCELLED",note:"Changed my mind"},{id:"owner",role:UserRole.CUSTOMER});
 expect(result.status).toBe("CANCELLED");expect(parseStatusHistory(current.statusHistory)[0]?.changedBy).toEqual({id:"owner",role:"CUSTOMER"});
});
it.each(["READY_TO_SHIP","SHIPPED"])("returns the polite cancellation message for %s",async status=>{
 current.status=status;
 await expect(updateOrderStatus("order",{status:"CANCELLED"},{id:"owner",role:UserRole.CUSTOMER})).rejects.toMatchObject({statusCode:400,message:ORDER_STATUS_FLOW.cancellationMessage});
});
it("rejects another customer's order without leaking its status",async()=>{
 await expect(updateOrderStatus("order",{status:"CANCELLED"},{id:"other",role:UserRole.CUSTOMER})).rejects.toMatchObject({statusCode:404});
 expect(mocks.update).not.toHaveBeenCalled();
});
it("does not permit customer advancement",async()=>{
 await expect(updateOrderStatus("order",{status:"PROCESSING"},{id:"owner",role:UserRole.CUSTOMER})).rejects.toMatchObject({statusCode:403});
});
it("only one simultaneous compare-and-set wins",async()=>{
 const result=await Promise.allSettled([updateOrderStatus("order",{status:"PROCESSING",expectedStatus:"PLACED"},actor),updateOrderStatus("order",{status:"CANCELLED",expectedStatus:"PLACED"},{id:"other-staff",role:UserRole.EMPLOYEE})]);
 expect(result.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 expect(parseStatusHistory(current.statusHistory)).toHaveLength(1);
});
it("preserves legacy CONFIRMED without offering it as a new step",async()=>{
 current.status="CONFIRMED";await updateOrderStatus("order",{status:"PROCESSING"},actor);expect(current.status).toBe("PROCESSING");
});
it("ignores malformed history safely",()=>expect(parseStatusHistory([null,"bad",{}, {status:"PLACED",changedAt:"2026-01-01",changedBy:null}])).toEqual([]));
