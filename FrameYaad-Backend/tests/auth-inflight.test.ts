import {it,expect,vi,beforeEach} from 'vitest';
import type {Request,Response,NextFunction} from 'express';
const m=vi.hoisted(()=>({auth:vi.fn(),user:vi.fn()}));
vi.mock('../src/config/supabase',()=>({supabaseAdmin:{auth:{getUser:m.auth}}}));
vi.mock('../src/prisma/client',()=>({prisma:{user:{findUnique:m.user}}}));
import {authenticate} from '../src/middleware/auth.middleware';
const profile={id:'dummy',role:'ADMIN',isActive:true,isEmailVerified:true,isPhoneNumberVerified:false};
const req=(token:string)=>({header:(name:string)=>name==='authorization'?'Bearer '+token:undefined,cookies:{}} as Request);
beforeEach(()=>{vi.clearAllMocks();m.user.mockResolvedValue(profile);});
it('coalesces only overlapping token verification and reads current database role per request',async()=>{
 let finish!:(value:unknown)=>void;m.auth.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const first=req('dummy-parallel'),second=req('dummy-parallel'),next=vi.fn();
 const a=authenticate(first,{} as Response,next as NextFunction),b=authenticate(second,{} as Response,next as NextFunction);
 await Promise.resolve();expect(m.auth).toHaveBeenCalledTimes(1);finish({data:{user:{id:'dummy',email_confirmed_at:'verified'}},error:null});await Promise.all([a,b]);expect(m.user).toHaveBeenCalledTimes(2);expect(next).toHaveBeenCalledTimes(2);
 m.auth.mockResolvedValue({data:{user:{id:'dummy',email_confirmed_at:'verified'}},error:null});m.user.mockResolvedValue({...profile,isActive:false});
 await expect(authenticate(req('dummy-parallel'),{} as Response,vi.fn())).rejects.toMatchObject({code:'ACCOUNT_DEACTIVATED'});expect(m.auth).toHaveBeenCalledTimes(2);
});
it('does not retain failed authentication or share different tokens',async()=>{
 m.auth.mockResolvedValue({data:{user:null},error:new Error('invalid')});const next=vi.fn();
 await Promise.all([authenticate(req('bad-a'),{} as Response,next),authenticate(req('bad-b'),{} as Response,next)]);await authenticate(req('bad-a'),{} as Response,next);
 expect(m.auth).toHaveBeenCalledTimes(3);expect(m.user).not.toHaveBeenCalled();expect(next.mock.calls.every(([error])=>(error as {code?:string}).code==='AUTHENTICATION_REQUIRED')).toBe(true);
});
