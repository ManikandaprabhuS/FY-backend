import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({auth:vi.fn(),user:vi.fn(),list:vi.fn(),draft:vi.fn(),read:vi.fn(),remove:vi.fn()}));
vi.mock('../src/config/supabase',()=>({supabaseAdmin:{auth:{getUser:m.auth}},createUserSupabaseClient:vi.fn()}));
vi.mock('../src/prisma/client',()=>({prisma:{user:{findUnique:m.user,update:vi.fn()}}}));
vi.mock('../src/modules/refund-requests/refund-requests.service',()=>({listRefundRequests:m.list,createRefundDraft:m.draft,readRefundEvidence:m.read,deleteRefundEvidence:m.remove}));
import {app} from '../src/app';
const id='RFD-0123456789ABCDEF',order=randomUUID(),file=randomUUID();
beforeEach(()=>{vi.clearAllMocks();const userId=randomUUID();m.auth.mockResolvedValue({data:{user:{id:userId,email_confirmed_at:'2026-01-01'}},error:null});m.user.mockResolvedValue({id:userId,role:'CUSTOMER',name:'Dummy',email:'dummy@example.invalid',isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});m.list.mockResolvedValue({requests:[],summary:{},pagination:{page:1,limit:20,total:0,totalPages:1}});m.draft.mockResolvedValue({id});m.read.mockResolvedValue({url:'https://example.invalid/signed'});});
it('rejects no-token access and forbids customers from staff evidence/list APIs',async()=>{
 expect((await request(app).get('/api/v1/refund-requests')).status).toBe(401);
 for(const path of ['/api/v1/refund-requests',`/api/v1/refund-requests/${id}/files/${file}`])expect((await request(app).get(path).set('Authorization','Bearer '+randomUUID())).status).toBe(403);
 expect((await request(app).post(`/api/v1/refund-requests/${id}/delete-evidence`).set('Authorization','Bearer '+randomUUID()).send({confirm:true})).status).toBe(403);expect(m.list).not.toHaveBeenCalled();expect(m.read).not.toHaveBeenCalled();
});
it.each(['ADMIN','EMPLOYEE'])('allows %s staff listing/read URLs but not customer draft creation',async role=>{
 m.user.mockResolvedValue({id:randomUUID(),role,name:'Dummy staff',email:'staff@example.invalid',isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 expect((await request(app).get('/api/v1/refund-requests').set('Authorization','Bearer '+randomUUID())).status).toBe(200);
 expect((await request(app).get(`/api/v1/refund-requests/${id}/files/${file}`).set('Authorization','Bearer '+randomUUID())).status).toBe(200);
 expect((await request(app).post(`/api/v1/refund-requests/order/${order}/draft`).set('Authorization','Bearer '+randomUUID())).status).toBe(403);
});
