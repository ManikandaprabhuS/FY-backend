import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prisma} from '../src/prisma/client';
import {createAdminProductPreview} from '../src/modules/products/products.service';
import {createAdminProductPreviewSchema} from '../src/modules/products/products.schemas';
import {listPublicCatalog} from '../src/modules/products/public-catalog.service';
import {resolvePhotoContext} from '../src/modules/order-photos/photo-context';
import {uploadPhoto} from '../src/modules/order-photos/order-photos.service';
import {checkout} from '../src/modules/orders/orders.service';

if(process.env.CONFIRM_DEV_DATABASE!=='true')throw new Error('Confirm the dedicated dev database explicitly.');
const userId=randomUUID(),addressId=randomUUID(),prefix='Dummy Arts '+randomUUID().slice(0,8);
const products:Awaited<ReturnType<typeof createAdminProductPreview>>[]=[],orders:string[]=[];
async function snapshot(){return {products:await prisma.product.count(),orders:await prisma.order.count(),stock:(await prisma.variant.aggregate({_sum:{stockQuantity:true}}))._sum.stockQuantity,revenue:String((await prisma.order.aggregate({where:{status:{not:'CANCELLED'}},_sum:{totalPrice:true}}))._sum.totalPrice)}}
async function main(){
const before=await snapshot();
try{
 await prisma.user.create({data:{id:userId,name:'Dummy Test Order',email:`arts-${userId}@example.invalid`,role:'CUSTOMER',isEmailVerified:false}});
 await prisma.userAddress.create({data:{id:addressId,userId,addressLine:'12 Dummy Test Road',city:'Chennai',state:'Tamil Nadu',country:'India',postalCode:'600040',contactPerson:'Dummy Test Order',contactNumber:'9000000000'}});
 const image=await prisma.productImage.findFirstOrThrow({select:{imageUrl:true}});
 for(const art of [false,true])for(const upload of [false,true]){
  const input=createAdminProductPreviewSchema.parse({name:`${prefix} ${art}-${upload}`,description:'Dummy product policy test; safe to remove.',brandName:'FrameYaad',material:'Test material',availableColors:['#000000'],isActive:true,images:[{imageUrl:image.imageUrl,displayOrder:1}],allowCustomerPhoto:upload,maxPhotoMb:3,isFrameyaadArt:art,variants:[{frameSize:'8x10',mountType:'NONE',glassType:'NONE',price:100,stockQuantity:5,maxPhotoSizeMB:upload?null:1}]});
  products.push(await createAdminProductPreview(input,userId));
 }
 const frames=await listPublicCatalog({catalog:'frames',search:prefix}),arts=await listPublicCatalog({catalog:'arts',search:prefix}),search=await listPublicCatalog({search:prefix});
 assert.equal(frames.products.length,2);assert.equal(arts.products.length,2);assert.equal(search.products.length,4);
 assert(frames.products.every(p=>!p.isFrameyaadArt));assert(arts.products.every(p=>p.isFrameyaadArt));
 const selected=(rows:typeof products)=>rows.map(p=>({productIdentifier:p.productIdentifier,variantId:p.variantId!,quantity:1}));
 const artOff=products.find(p=>p.isFrameyaadArt&&!p.allowCustomerPhoto)!,normalOn=products.find(p=>!p.isFrameyaadArt&&p.allowCustomerPhoto)!;
 assert.equal((await resolvePhotoContext(prisma,userId,selected([artOff]))).allowCustomerPhoto,false);
 assert.equal((await resolvePhotoContext(prisma,userId,selected([artOff,normalOn]))).maxAllowedMB,3);
 await assert.rejects(uploadPhoto(userId,{buffer:Buffer.from('test'),originalname:'test.jpg'} as Express.Multer.File,selected([artOff])),(error:unknown)=>(error as {code:string}).code==='PHOTO_NOT_ALLOWED');
 await assert.rejects(checkout(userId,{items:selected([artOff]),userAddressId:addressId,paymentMethod:'COD',checkoutKey:randomUUID(),photoId:randomUUID()}),(error:unknown)=>(error as {code:string}).code==='PHOTO_NOT_ALLOWED');
 for(const rows of [[artOff],[normalOn],[artOff,normalOn]]){
  const order=await checkout(userId,{items:selected(rows),userAddressId:addressId,paymentMethod:'COD',checkoutKey:randomUUID()});orders.push(order.id);
  assert.equal(order.customerPhotoAllowed,rows.some(p=>p.allowCustomerPhoto));assert.equal(order.customerPhoto,null);
 }
 console.log(JSON.stringify({combinations:4,regularCatalog:2,artsCatalog:2,searchCatalog:4,mixedLimitMB:3,artUploadRejected:true,artOrderPhotoRejected:true,noPhotoOrdersSucceeded:3,realEmailsSent:0}));
}finally{
 const ownedOrders=await prisma.order.findMany({where:{userId},select:{id:true}});orders.push(...ownedOrders.map(o=>o.id));
 await prisma.deliveryJob.deleteMany({where:{OR:[{idempotencyKey:{contains:userId}},...orders.map(id=>({idempotencyKey:{contains:id}}))]}});
 await prisma.notification.deleteMany({where:{id:{in:orders}}});await prisma.customerNotification.deleteMany({where:{userId}});
 await prisma.orderItem.deleteMany({where:{orderId:{in:orders}}});await prisma.order.deleteMany({where:{userId}});
 await prisma.cart.deleteMany({where:{userId}});await prisma.userAddress.deleteMany({where:{userId}});
 for(const p of products){await prisma.product.update({where:{id:p.id},data:{variantId:null}});await prisma.product.delete({where:{id:p.id}});await prisma.material.delete({where:{id:p.materialId}});}
 await prisma.user.deleteMany({where:{id:userId}});
 const after=await snapshot();assert.deepEqual(after,before);console.log(JSON.stringify({cleanupVerified:true,before,after}));await prisma.$disconnect();
}}
void main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
