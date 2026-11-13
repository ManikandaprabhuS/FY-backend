import {Prisma} from "@prisma/client";
import {prisma} from "../../prisma/client";
import {z} from "zod";
export const revenueWhere={status:{not:"CANCELLED"}} satisfies Prisma.OrderWhereInput;
export function revenueSummary(orders:readonly {status:string;totalPrice:Prisma.Decimal}[]){
 const active=orders.filter(o=>o.status!=="CANCELLED"),total=active.reduce((sum,o)=>sum.add(o.totalPrice),new Prisma.Decimal(0));
 return {totalRevenue:total.toNumber(),orderCount:active.length,averageOrderValue:active.length?total.div(active.length).toDecimalPlaces(2).toNumber():0};
}
export async function revenueReport(raw:unknown){
 const q=z.object({from:z.coerce.date(),to:z.coerce.date()}).refine(q=>q.from<=q.to,{message:"Invalid revenue date range"}).parse(raw);
 const [all,orders]=await Promise.all([
  prisma.order.aggregate({where:revenueWhere,_sum:{totalPrice:true},_count:{_all:true}}),
  prisma.order.findMany({where:{...revenueWhere,createdAt:{gte:q.from,lte:q.to}},orderBy:{createdAt:"asc"},
   select:{id:true,orderNumber:true,createdAt:true,status:true,totalPrice:true,user:{select:{name:true}}}})
 ]);
 return {summary:revenueSummary(orders),totalRevenue:Number(all._sum.totalPrice??0),totalOrders:all._count._all,
  orders:orders.map(o=>({id:o.id,createdAt:o.createdAt,orderNumber:o.orderNumber,orderStatus:o.status,totalAmount:Number(o.totalPrice),user:o.user}))};
}
