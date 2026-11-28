import {expect,it} from 'vitest';
import {refundEligibility,requestInput,actionInput,evidenceType,REFUND_LIMITS,evidenceCleanupAllowed} from '../src/modules/refund-requests/refund-policy';
import {publicBusinessFacts} from '../src/config/business-facts';
it('allows manual evidence cleanup for submitted approved refunds/replacements without closing the request',()=>{
 for(const status of ['APPROVED','WITHDRAWN','REJECTED','COMPLETED'])expect(evidenceCleanupAllowed({status,requestedAt:new Date()})).toBe(true);
 for(const status of ['REQUESTED','UNDER_REVIEW'])expect(evidenceCleanupAllowed({status,requestedAt:new Date()})).toBe(false);
 expect(evidenceCleanupAllowed({status:'APPROVED',requestedAt:null})).toBe(false);
});
it('requires delivery, a reliable timestamp and a 48 hour window',()=>{
 const now=new Date('2026-11-28T10:00:00Z');
 expect(refundEligibility({status:'DELIVERED',deliveredAt:new Date(now.getTime()-48*3600000)},now).eligible).toBe(true);
 expect(refundEligibility({status:'DELIVERED',deliveredAt:new Date(now.getTime()-48*3600000-1)},now).eligible).toBe(false);
 expect(refundEligibility({status:'DELIVERED',deliveredAt:null},now).eligible).toBe(false);
 expect(refundEligibility({status:'PROCESSING',deliveredAt:now},now).eligible).toBe(false);
 expect(refundEligibility({status:'DELIVERED',deliveredAt:new Date(now.getTime()+1000)},now).eligible).toBe(false);
});
it('validates request text and trusted evidence extension/MIME pairs',()=>{
 const input={reasonCategory:'Damaged',reasonDetails:'A clearly described damaged frame.',preferredResolution:'REFUND'};
 expect(requestInput.safeParse(input).success).toBe(true);
 for(const reasonDetails of ['too short','<script>alert(1)</script>','x'.repeat(501)])expect(requestInput.safeParse({...input,reasonDetails}).success).toBe(false);
 expect(evidenceType('photo.HEIC','image/heic')?.kind).toBe('photo');expect(evidenceType('video.mov','video/quicktime')?.kind).toBe('video');
 expect(evidenceType('image.jpg.exe','image/jpeg')).toBeNull();expect(evidenceType('image.jpg','text/html')).toBeNull();expect(evidenceType('video.webm','video/mp4')).toBeNull();
 expect(REFUND_LIMITS.photoBytes).toBe(5*1048576);expect(REFUND_LIMITS.videoBytes).toBe(30*1048576);
 expect(actionInput.safeParse({version:0,mutationKey:'bad',action:'COMPLETED'}).success).toBe(false);
});
it('exposes only allowlisted public business facts with approved defaults',()=>{
 const facts=publicBusinessFacts({secret:'never',details:{email:'owner@example.test',phone:'9000000000',address:'Verified address',internalNotes:'private',businessFacts:{gstin:'verified-gstin',workshops:[],jurisdiction:''}}});
 expect(facts).toMatchObject({brandName:'FrameYaad',siteUrl:'https://frameyaad.com',email:'owner@example.test',gstin:'verified-gstin',grievanceOfficer:'',jurisdiction:'',deliveryDaysMin:3,deliveryDaysMax:6,payments:{cod:true,online:false},workshops:[]});
 expect(JSON.stringify(facts)).not.toMatch(/secret|never|internalNotes|private/);
});
