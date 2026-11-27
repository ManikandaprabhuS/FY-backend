import {describe,it,expect} from 'vitest';
import {updateAdminProductPreviewSchema} from '../src/modules/products/products.schemas';
import {getPhotoMaxBytes,PHOTO_MB_BYTES} from '../src/utils/photo-limits';

describe('product photo policy',()=>{
 it.each([undefined,null,0,11,-1])('rejects enabled uploads with invalid limit %s',maxPhotoMb=>{
  expect(updateAdminProductPreviewSchema.safeParse({allowCustomerPhoto:true,maxPhotoMb}).success).toBe(false);
 });
 it.each([1,4,10,2.5])('accepts valid enabled limit %s',maxPhotoMb=>{
  expect(updateAdminProductPreviewSchema.safeParse({allowCustomerPhoto:true,maxPhotoMb,isFrameyaadArt:true}).success).toBe(true);
 });
 it('clears an irrelevant disabled limit and preserves legacy partial updates',()=>{
  expect(updateAdminProductPreviewSchema.parse({allowCustomerPhoto:false,maxPhotoMb:11}).maxPhotoMb).toBeNull();
  expect(updateAdminProductPreviewSchema.parse({isActive:false})).toEqual({isActive:false});
 });
 it('honors explicit variant overrides and uses product defaults only when unset',()=>{
  expect(getPhotoMaxBytes([{maxPhotoSizeMB:8,maxPhotoMb:4}])).toBe(8*PHOTO_MB_BYTES);
  expect(getPhotoMaxBytes([{maxPhotoSizeMB:null,maxPhotoMb:3}])).toBe(3*PHOTO_MB_BYTES);
 });
 it('excludes upload-disabled items from a mixed cart limit',()=>{
  expect(getPhotoMaxBytes([{allowCustomerPhoto:false,maxPhotoSizeMB:1},{allowCustomerPhoto:true,maxPhotoSizeMB:7},{allowCustomerPhoto:true,maxPhotoSizeMB:null,maxPhotoMb:5}])).toBe(5*PHOTO_MB_BYTES);
 });
});
