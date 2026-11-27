import {z} from 'zod';
import {photoLimitValidation} from '../../utils/photo-limits';
export const productPolicyFields={allowCustomerPhoto:z.boolean().optional(),maxPhotoMb:z.number().nullable().optional(),isFrameyaadArt:z.boolean().optional()};
export function validateProductPolicy(value:{allowCustomerPhoto?:boolean;maxPhotoMb?:number|null},context:z.RefinementCtx){
 if(value.allowCustomerPhoto===false)return;
 if(value.allowCustomerPhoto===true&&value.maxPhotoMb==null){context.addIssue({code:'custom',path:['maxPhotoMb'],message:'Max photo upload size is required when customer photo upload is enabled.'});return;}
 if(value.maxPhotoMb!==undefined){const issue=value.maxPhotoMb===null?'Max photo upload size is required.':photoLimitValidation(value.maxPhotoMb);if(issue)context.addIssue({code:'custom',path:['maxPhotoMb'],message:issue});}
}
export function normalizeProductPolicy<T extends {allowCustomerPhoto?:boolean;maxPhotoMb?:number|null}>(value:T):T{return value.allowCustomerPhoto===false?{...value,maxPhotoMb:null}:value;}
