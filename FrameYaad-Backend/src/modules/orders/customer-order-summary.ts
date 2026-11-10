import {prisma} from "../../prisma/client";
import {paginationMeta} from "../../utils/pagination";
import {z} from "zod";
export const listCustomerOrderSummaries=async(userId:string,raw:unknown)=>{
 const {page,limit}=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(20).default(10)}).parse(raw);
 const where={userId};
 const [rows,total]=await Promise.all([
  prisma.order.findMany({where,orderBy:[{createdAt:"desc"},{id:"desc"}],skip:(page-1)*limit,take:limit,
   select:{id:true,orderNumber:true,createdAt:true,status:true,totalPrice:true,_count:{select:{items:true}},
    items:{take:3,orderBy:{id:"asc"},select:{id:true,snapshotProductName:true,snapshotProductId:true,quantity:true,product:{select:{id:true,productName:true,images:{take:1,orderBy:{isPrimary:"desc"},select:{imageUrl:true}}}}}}}}),
  prisma.order.count({where})
 ]);
 return {orders:rows.map(order=>({id:order.id,orderNumber:order.orderNumber,createdAt:order.createdAt,status:order.status,total:Number(order.totalPrice),itemCount:order._count.items,
  items:order.items.map(item=>({id:item.id,productId:item.snapshotProductId??item.product?.id??null,name:item.snapshotProductName??item.product?.productName??"Frame",quantity:item.quantity,imageUrl:item.product?.images[0]?.imageUrl??null}))})),pagination:paginationMeta(page,limit,total)};
};
