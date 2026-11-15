import {z} from "zod";
import {ApiError} from "../../utils/api-error";
import {verifiedPhotoType} from "../order-photos/photo-file";
export const CONTACT_VIDEO_MAX=50*1024*1024,CONTACT_IMAGE_MAX=2*1024*1024;
export const mediaKind=z.enum(["video","poster","banner"]);
export type MediaKind=z.infer<typeof mediaKind>;
const text=(min:number,max:number)=>z.string().trim().min(min).max(max).refine(v=>!/[<>]/.test(v)&&!Array.from(v).some(c=>c.charCodeAt(0)<32),"Use plain text without HTML.");
const optional=(schema:z.ZodType<string>)=>z.union([schema,z.literal(""),z.null()]).transform(v=>v||null);
export const contactDetailsSchema=z.object({
 phone:optional(z.string().trim().max(30).regex(/^\+?[0-9 ()-]+$/,"Enter a valid phone number.").refine(v=>{const n=v.replace(/\D/g,"").length;return n>=7&&n<=15;},"Enter 7–15 phone digits.")),
 email:optional(z.string().trim().toLowerCase().max(254).email("Enter a valid email.")),
 studioName:optional(text(2,120)),address:optional(text(5,500)),
}).strict();
function mp4(bytes:Buffer){
 let offset=0,ftyp=false,moov=false,mdat=false,boxes=0;
 while(offset+8<=bytes.length&&++boxes<10000){
  let size=bytes.readUInt32BE(offset),header=8;
  if(size===1){if(offset+16>bytes.length)return false;const extended=bytes.readBigUInt64BE(offset+8);if(extended>BigInt(bytes.length))return false;size=Number(extended);header=16;}
  if(size===0)size=bytes.length-offset;
  if(size<header||offset+size>bytes.length)return false;
  const type=bytes.toString("ascii",offset+4,offset+8);
  if(type==="ftyp"){
   const brands=bytes.subarray(offset+header,offset+size).toString("ascii");
   ftyp=size>=header+8&&/isom|iso[2-9]|mp4[12]|avc1|dash/.test(brands);
  }
  if(type==="moov")moov=size>header;
  if(type==="mdat")mdat=size>header;
  offset+=size;
 }
 return offset===bytes.length&&ftyp&&moov&&mdat;
}
function webm(bytes:Buffer){
 if(!bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])))return false;
 const header=bytes.subarray(0,Math.min(65536,bytes.length)),tag=header.indexOf(Buffer.from([0x42,0x82]));
 if(tag<0||tag+3>=header.length)return false;
 const first=header[tag+2]!;let width=1,mask=0x80;
 while(width<=8&&(first&mask)===0){width++;mask>>=1;}
 if(width>8||tag+2+width>header.length)return false;
 let length=first&(mask-1);
 for(let i=1;i<width;i++)length=length*256+header[tag+2+i]!;
 const start=tag+2+width;
 if(length>32||start+length>header.length)return false;
 return header.toString("ascii",start,start+length)==="webm"
  &&header.includes(Buffer.from([0x18,0x53,0x80,0x67]))
  &&header.includes(Buffer.from([0x16,0x54,0xae,0x6b]))&&header.includes(Buffer.from("V_"));
}
export function validateContactFile(kind:MediaKind,file?:Express.Multer.File){
 if(!file?.buffer?.length)throw new ApiError(400,"Choose a non-empty file.","CONTACT_MEDIA_REQUIRED");
 const max=kind==="video"?CONTACT_VIDEO_MAX:CONTACT_IMAGE_MAX;
 if(file.buffer.length>max)throw new ApiError(413,kind==="video"?"Video must be 50 MB or smaller.":"Image must be 2 MB or smaller.","CONTACT_MEDIA_TOO_LARGE");
 if(kind!=="video"){
  try{return verifiedPhotoType(file.buffer);}catch(error){
   if(error instanceof ApiError)throw new ApiError(error.statusCode,error.statusCode===415?"Choose a JPG, PNG or WebP image.":"This image is damaged. Choose another image.","CONTACT_IMAGE_INVALID");
   throw error;
  }
 }
 if(mp4(file.buffer))return {mimeType:"video/mp4",ext:"mp4"};
 if(webm(file.buffer))return {mimeType:"video/webm",ext:"webm"};
 throw new ApiError(415,"Choose a valid MP4 or WebM video.","CONTACT_VIDEO_INVALID");
}
