import {Prisma} from "@prisma/client";
import {prisma} from "../../prisma/client";
import {z} from "zod";
export const revenueWhere={status:{not:"CANCELLED"}} satisfies Prisma.OrderWhereInput;
export function revenueSummary(orders:readonly {status:string;totalPrice:Prisma.Decimal;completedReturnRefund?:Prisma.Decimal|null}[]){
 const active=orders.filter(o=>o.status!=="CANCELLED"),total=active.reduce((sum,o)=>sum.add(o.totalPrice.sub(o.completedReturnRefund??0)),new Prisma.Decimal(0));
 return {totalRevenue:total.toNumber(),orderCount:active.length,averageOrderValue:active.length?total.div(active.length).toDecimalPlaces(2).toNumber():0};
}
export async function revenueReport(raw:unknown){
 const q=z.object({from:z.coerce.date(),to:z.coerce.date()}).refine(q=>q.from<=q.to,{message:"Invalid revenue date range"}).parse(raw);
 const [all,orders]=await Promise.all([
  prisma.order.aggregate({where:revenueWhere,_sum:{totalPrice:true,completedReturnRefund:true},_count:{_all:true}}),
  prisma.order.findMany({where:{...revenueWhere,createdAt:{gte:q.from,lte:q.to}},orderBy:{createdAt:"asc"},
   select:{id:true,orderNumber:true,createdAt:true,status:true,totalPrice:true,completedReturnRefund:true,couponCode:true,couponTitle:true,discountPercent:true,discountAmount:true,subtotal:true,user:{select:{name:true}}}})
 ]);
 return {summary:revenueSummary(orders),totalRevenue:Number(all._sum.totalPrice??0)-Number(all._sum.completedReturnRefund??0),totalOrders:all._count._all,
  orders:orders.map(o=>({id:o.id,createdAt:o.createdAt,orderNumber:o.orderNumber,orderStatus:o.status,totalAmount:Number(o.totalPrice)-Number(o.completedReturnRefund??0),grossAmount:Number(o.totalPrice),refundedAmount:Number(o.completedReturnRefund??0),user:o.user,
   couponCode:o.couponCode,couponTitle:o.couponTitle,discountPercent:Number(o.discountPercent??0),subtotal:Number(o.subtotal??o.totalPrice),discount:Number(o.discountAmount??0),
   exportCoupon:o.couponTitle?o.couponTitle+" ("+Number(o.discountPercent??0)+"%)":o.couponCode??"-"}))};
}
