import {z} from 'zod';
export const REFUND_LIMITS={eligibilityHours:48,photoCount:5,photoBytes:5*1024*1024,videoCount:1,videoBytes:30*1024*1024,totalBytes:55*1024*1024,signedReadSeconds:120} as const;
export const REFUND_PRIVACY='For your privacy, evidence is private and can be removed manually by our team once your request is approved or closed.';
export const REFUND_EVIDENCE_HELP='A short unboxing video and clear photos help us verify faster, but they are optional. If we need more details, our team may call you.';
export const reasonCategories=['Damaged','Wrong item/size/variant','Print quality issue','Defective','Other'] as const;
export const requestStatuses=['REQUESTED','UNDER_REVIEW','APPROVED','REJECTED','COMPLETED','WITHDRAWN'] as const;
export const evidenceCleanupAllowed=(request:{status:string;requestedAt:Date|null})=>['WITHDRAWN','REJECTED','COMPLETED'].includes(request.status)||(request.status==='APPROVED'&&request.requestedAt!==null);
const plain=(min:number,max:number)=>z.string().trim().min(min).max(max).refine(value=>!/[<>]/.test(value)&&!Array.from(value).some(char=>{const code=char.charCodeAt(0);return code===127||(code<32&&![9,10,13].includes(code));}),'Use plain text without HTML.');
export const requestInput=z.object({reasonCategory:z.enum(reasonCategories),reasonDetails:plain(20,500),preferredResolution:z.enum(['REFUND','REPLACEMENT']),affectedItemIds:z.array(z.string().uuid()).max(100).default([])}).strict();
export const actionInput=z.object({version:z.number().int().min(1),mutationKey:z.string().uuid(),action:z.enum(['UNDER_REVIEW','APPROVE','REJECT','INITIATED','COMPLETED','REPLACEMENT_DISPATCHED','WITHDRAW','NOTES']),resolution:z.enum(['REFUND','REPLACEMENT']).optional(),approvedAmount:z.number().finite().positive().optional(),adminMessage:plain(0,500).optional(),internalNotes:plain(0,2000).optional()}).strict();
export function evidenceType(name:string,mime:string){
 const ext=name.split('.').at(-1)?.toLowerCase()??'';
 const types:Record<string,string[]>={jpg:['image/jpeg'],jpeg:['image/jpeg'],png:['image/png'],webp:['image/webp'],heic:['image/heic','image/heif'],mp4:['video/mp4'],mov:['video/quicktime'],webm:['video/webm']};
 if(!types[ext]?.includes(mime))return null;
 const kind:'photo'|'video'=mime.startsWith('image/')?'photo':'video';return {ext:ext==='jpeg'?'jpg':ext,kind};
}
export function refundEligibility(order:{status:string;deliveredAt:Date|null},now=new Date()){
 const until=order.deliveredAt?new Date(order.deliveredAt.getTime()+REFUND_LIMITS.eligibilityHours*3600000):null;
 return {eligible:order.status==='DELIVERED'&&Boolean(until&&order.deliveredAt!<=now&&now<=until),eligibleUntil:until,message:order.status!=='DELIVERED'?'Refund requests are available after delivery.':!until?'Please contact our team to verify the delivery date.':now>until?'The 48-hour request window has ended. Please contact our team.':''};
}
