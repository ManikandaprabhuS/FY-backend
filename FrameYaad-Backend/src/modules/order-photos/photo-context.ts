import type {Prisma} from "@prisma/client";
import {ApiError} from "../../utils/api-error";
import {getPhotoMaxBytes,PHOTO_MB_BYTES} from "../../utils/photo-limits";
import {checkoutItemsSchema} from "../checkout/checkout.schemas";
import {createHash} from 'node:crypto';
type DB=Pick<Prisma.TransactionClient,"cart"|"variant">;
export async function resolvePhotoContext(db:DB,userId:string,context?:unknown){
 const provided=context===undefined?undefined:checkoutItemsSchema.parse(context);
 const cartRequest=provided?Promise.resolve(null):db.cart.findUnique({where:{userId},select:{items:{select:{productIdentifier:true,selectedVariantId:true,product:{select:{variantId:true}}}}}});
 const items=provided??((await cartRequest)?.items??[]).map(item=>({productIdentifier:item.productIdentifier,variantId:item.selectedVariantId??item.product.variantId}));
 const ids=[...new Set(items.flatMap(item=>item.variantId?[item.variantId]:[]))];
 const [,variants]=await Promise.all([cartRequest,ids.length?db.variant.findMany({where:{id:{in:ids}},select:{id:true,maxPhotoSizeMB:true,frameSize:true,product:{select:{productIdentifier:true,productName:true,allowCustomerPhoto:true,maxPhotoMb:true}},primaryProducts:{select:{productIdentifier:true,productName:true,allowCustomerPhoto:true,maxPhotoMb:true}}}}):Promise.resolve([])]);
 const resolved=items.map(item=>{
  const variant=variants.find(row=>row.id===item.variantId);
  const product=variant?.product?.productIdentifier===item.productIdentifier?variant.product:variant?.primaryProducts.find(p=>p.productIdentifier===item.productIdentifier);
  if(!variant||!product)throw new ApiError(400,"A selected frame is no longer available. Please review your cart.","INVALID_PHOTO_CONTEXT");
  return {...variant,name:product.productName,allowCustomerPhoto:product.allowCustomerPhoto,maxPhotoMb:product.maxPhotoMb==null?null:Number(product.maxPhotoMb)};
 });
 const maxBytes=getPhotoMaxBytes(resolved);
 const matches=resolved.filter(item=>item.allowCustomerPhoto!==false&&getPhotoMaxBytes([item])===maxBytes);
 const limiting=matches.length===1?matches[0]:undefined;
 const allowCustomerPhoto=resolved.some(item=>item.allowCustomerPhoto!==false);
 const policyVersion=createHash('sha256').update(JSON.stringify(resolved.map(item=>[item.id,item.allowCustomerPhoto!==false,getPhotoMaxBytes([item])]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))))).digest('hex');
 return {allowCustomerPhoto,policyVersion,maxBytes,maxAllowedMB:Number((maxBytes/PHOTO_MB_BYTES).toFixed(1)),limitingItem:limiting?{name:limiting.name,variant:limiting.frameSize}:null};
}
