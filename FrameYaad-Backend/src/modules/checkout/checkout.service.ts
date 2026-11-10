import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { ApiError } from "../../utils/api-error";
import { assertAvailableStock } from "../../utils/stock";
import type { OfferCode } from "./coupons.config";
import { runtimeOffers,offerDescription } from "../offers/offers.service";
import { normalizeOfferEmail, normalizeOfferPhone, offerTotals } from "./offer-pricing";
import { checkoutItemsSchema } from "./checkout.schemas";
import type { z } from "zod";
type DB = Prisma.TransactionClient;
export type CheckoutItem = z.infer<typeof checkoutItemsSchema>[number];
export const priceCheckoutItems = async (db: DB, items: CheckoutItem[],capture?: (items:Array<{productIdentifier:string;productName:string;variantId:string;frameSize:string;quantity:number;unitPrice:number;imageUrl:string|null}>)=>void) => {
  const products = await db.product.findMany({ where: { productIdentifier: { in: items.map(i=>i.productIdentifier) } },
    select: { id:true, productIdentifier:true, productName:true, images:{select:{imageUrl:true},orderBy:{isPrimary:"desc"},take:1},material:{select:{name:true,isActive:true}},
      variant:{select:{id:true,isActive:true,price:true,stockQuantity:true,frameSize:true,color:true}}, variants:{where:{id:{in:items.map(item=>item.variantId)}},select:{id:true,isActive:true,price:true,stockQuantity:true,frameSize:true,color:true}} } });
  capture?.(items.map(item=>{
    const product=products.find(p=>p.productIdentifier===item.productIdentifier);
    const variant=product?.variants.find(v=>v.id===item.variantId)??product?.variant;
    return {productIdentifier:item.productIdentifier,productName:product?.productName??"",variantId:item.variantId,frameSize:variant?.frameSize??"",quantity:item.quantity,unitPrice:Number(variant?.price??0),imageUrl:product?.images[0]?.imageUrl??null};
  }));
  const requested = new Map<string,number>();
  return items.map(item=>{
    const product=products.find(p=>p.productIdentifier===item.productIdentifier);
    const variant=product?.variants.find(v=>v.id===item.variantId && v.isActive) ?? (product?.variant?.id===item.variantId && product.variant.isActive?product.variant:undefined);
    if(!product?.material.isActive || !variant) throw new ApiError(409,"Cart contains an unavailable product or variant","CART_PRODUCT_UNAVAILABLE");
    const count=(requested.get(variant.id)??0)+item.quantity; requested.set(variant.id,count); assertAvailableStock(count,variant.stockQuantity);
    return { productIdentifier:item.productIdentifier,snapshotProductId:product.id,snapshotProductName:product.productName,
      snapshotVariantId:variant.id,snapshotFrameSize:variant.frameSize,snapshotMaterial:product.material.name,
      snapshotColorName:item.colorName??variant.color,snapshotColorHex:item.colorHex??null,
      quantity:item.quantity,price:variant.price,subtotal:variant.price.mul(item.quantity) };
  });
};
export const offerIdentity = async (db: DB,userId:string) => {
  const user=await db.user.findUniqueOrThrow({where:{id:userId},select:{email:true,phoneNumber:true}});
  return {email:normalizeOfferEmail(user.email),phone:normalizeOfferPhone(user.phoneNumber)};
};
export const hasOrderHistory = async (db: DB,email:string,phone:string) => {
  const rows=await db.$queryRaw<Array<{found:boolean}>>(Prisma.sql`
    SELECT EXISTS(
      SELECT 1 FROM public."Order" o JOIN public.users u ON u.id=o."userId"
      JOIN public.user_address a ON a.id=o."userAddressId"
      WHERE o."offerEmail"=${email} OR lower(trim(u.email))=${email}
      OR (${phone}<>'' AND (o."offerPhone"=${phone}
        OR regexp_replace(regexp_replace(COALESCE(u."phoneNumber",''),'[^0-9]','','g'),'^91(?=[0-9]{10}$)','')=${phone}
        OR regexp_replace(regexp_replace(COALESCE(a."contactNumber",''),'[^0-9]','','g'),'^91(?=[0-9]{10}$)','')=${phone}))
    ) AS found`);
  return rows[0]?.found??false;
};
export const eligibleOffers = async (db:DB,userId:string,subtotal:Prisma.Decimal.Value|Promise<Prisma.Decimal.Value>,fresh=false) => {
  const [context,settings,resolvedSubtotal]=await Promise.all([
    offerIdentity(db,userId).then(async identity=>({identity,history:await hasOrderHistory(db,identity.email,identity.phone)})),
    runtimeOffers(db,fresh),subtotal
  ]);
  const {identity,history}=context;
  const amount=new Prisma.Decimal(resolvedSubtotal);
  const offers=settings.filter(offer=>offer.enabled&&(offer.code==="FIRST_ORDER"
    ? identity.email.length>0&&!history : amount.gt(offer.minOrderAmount??0)))
    .map(offer=>({code:offer.code as OfferCode,title:offer.title,description:offerDescription(offer),percent:Number(offer.percentage),version:offer.version,
      discountAmount:offerTotals(amount,Number(offer.percentage)).discountAmount.toNumber(),total:offerTotals(amount,Number(offer.percentage)).total.toNumber(),bestOffer:false}));
  const best=Math.max(0,...offers.map(o=>o.discountAmount));
  const big=settings.find(o=>o.code==="BIG_ORDER");
  const bigOrderRemovalMessage=big?.enabled&&amount.lte(big.minOrderAmount??0)
    ? "Offer removed. Order total is below Rs. "+Number(big.minOrderAmount).toLocaleString("en-IN")+"."
    : "This offer is no longer available";
  // Advertise the enabled Big Order rule without making it eligible.
  const unavailableOffers=big?.enabled&&amount.lte(big.minOrderAmount??0)?[{
    code:big.code as OfferCode,title:big.title,description:offerDescription(big),
    percent:Number(big.percentage),version:big.version,discountAmount:0,total:amount.toNumber(),bestOffer:false,
    unavailableReason:"Available on orders above Rs. "+Number(big.minOrderAmount).toLocaleString("en-IN")+"."
  }]:[];
  return {identity,offers:offers.map(o=>({...o,bestOffer:offers.length>1&&o.discountAmount===best})),unavailableOffers,bigOrderRemovalMessage};
};
export const lockOfferIdentity = async(db:DB,email:string,phone:string)=>{
  // Sorted transaction-scoped locks serialize either shared identity across accounts.
  for(const key of [...new Set(["email:"+email,...(phone?["phone:"+phone]:[])])].sort())
    await db.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))::text`);
};
export const getCheckoutOffers=async(userId:string,items?:CheckoutItem[],includeItems=false)=>{
  let selections=items;
  if(!selections){
    const cart=await prisma.cart.findUnique({where:{userId},select:{items:{select:{productIdentifier:true,selectedVariantId:true,quantity:true,product:{select:{variantId:true}}}}}});
    selections=cart?.items.flatMap(i=>{const variantId=i.selectedVariantId??i.product.variantId;return variantId?[{productIdentifier:i.productIdentifier,variantId,quantity:i.quantity}]:[];})??[];
  }
  let summaryItems:Parameters<NonNullable<Parameters<typeof priceCheckoutItems>[2]>>[0]=[];
  const rowsPromise=selections.length?priceCheckoutItems(prisma,selections,includeItems?value=>{summaryItems=value;}:undefined):Promise.resolve([]);
  const totalsPromise=rowsPromise.then(rows=>offerTotals(rows.reduce((sum,i)=>sum.add(i.subtotal),new Prisma.Decimal(0))));
  const [totals,eligibility,addresses]=await Promise.all([
    totalsPromise,eligibleOffers(prisma,userId,totalsPromise.then(value=>value.subtotal)),
    prisma.userAddress.findMany({where:{userId},select:{id:true,addressLine:true,city:true,state:true,country:true,postalCode:true,contactPerson:true,contactNumber:true}})
  ]);
  return {...(includeItems?{items:summaryItems,defaultAddress:addresses[0]??null}:{}),offers:totals.subtotal.gt(0)?eligibility.offers:[],unavailableOffers:totals.subtotal.gt(0)?eligibility.unavailableOffers:[],subtotal:totals.subtotal.toNumber(),addresses,bigOrderRemovalMessage:eligibility.bigOrderRemovalMessage};
};
export const validateOffer=async(db:DB,userId:string,subtotal:Prisma.Decimal.Value,code?:OfferCode,version?:number)=>{
  const eligibility=await eligibleOffers(db,userId,subtotal,true);
  const offer=code?eligibility.offers.find(o=>o.code===code):undefined;
  if(code&&(!offer||version!==offer.version))throw new ApiError(409,offer?"This offer was updated. Please review your total.":"This offer is no longer available","OFFER_UNAVAILABLE",{...offerTotals(subtotal),offers:eligibility.offers});
  const totals=offerTotals(subtotal,offer?.percent??0);
  return {...totals,couponCode:offer?.code??null,couponTitle:offer?.title??null,discountPercent:offer?.percent??0,offerEmail:eligibility.identity.email,offerPhone:eligibility.identity.phone||null};
};
