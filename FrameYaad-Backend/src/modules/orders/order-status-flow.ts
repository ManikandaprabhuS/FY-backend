export const ORDER_STATUS_FLOW={
 steps:[
  {status:"PLACED",label:"Placed",description:"We have received your order."},
  {status:"PROCESSING",label:"Processing",description:"We are preparing your order."},
  {status:"READY_TO_SHIP",label:"Ready to ship",description:"Your order is packed and waiting for pickup."},
  {status:"SHIPPED",label:"Shipped",description:"Your order is on the way."},
  {status:"DELIVERED",label:"Delivered",description:"Your order has been delivered."},
 ],
 transitions:{
  PLACED:["PROCESSING","CANCELLED"],PROCESSING:["READY_TO_SHIP","CANCELLED"],
  READY_TO_SHIP:["SHIPPED"],SHIPPED:["DELIVERED"],DELIVERED:[],CANCELLED:[],
  CONFIRMED:["PROCESSING"], // Read-only compatibility for pre-existing orders.
 } as Record<string,readonly string[]>,
 cancellable:["PLACED","PROCESSING"],
 cancellationMessageStatuses:["READY_TO_SHIP","SHIPPED"],
 cancellationMessage:"Sorry, your order is ready to ship or already shipped, so it can't be cancelled.",
 legacyDisplay:{CONFIRMED:"PLACED"} as Record<string,string>,
} as const;
export const statusLabel=(status:string)=>ORDER_STATUS_FLOW.steps.find(s=>s.status===status)?.label??(status==="CANCELLED"?"Cancelled":status.replaceAll("_"," "));
export type StatusHistoryEntry={status:string;changedAt:string;changedBy:{id:string;role:string};note?:string;previousStatus?:string;eventId?:string};
export const parseStatusHistory=(value:unknown):StatusHistoryEntry[]=>Array.isArray(value)?value.filter((entry):entry is StatusHistoryEntry=>{
 if(!entry||typeof entry!=="object")return false;
 const e=entry as Record<string,unknown>,by=e.changedBy;
 return typeof e.status==="string"&&typeof e.changedAt==="string"&&by!==null&&typeof by==="object"&&"id" in by&&typeof by.id==="string"&&"role" in by&&typeof by.role==="string";
}):[];
