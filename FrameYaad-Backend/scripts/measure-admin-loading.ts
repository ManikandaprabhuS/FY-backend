import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {app} from '../src/app';
import {prisma} from '../src/prisma/client';
import {supabaseAdmin,createUserSupabaseClient} from '../src/config/supabase';
import {env} from '../src/config/env';

async function main(){
 if(process.env.CONFIRM_DEV_DATABASE!=='true')throw new Error('Dedicated dev database confirmation required');
 const email=`dummy-admin-perf-${randomUUID()}@example.invalid`,password=randomUUID()+'Aa1!';
 let id:string|undefined;const server=app.listen(0,'127.0.0.1');
 const raw=supabaseAdmin.auth.getUser.bind(supabaseAdmin.auth);let authCalls=0,authMs=0;
 supabaseAdmin.auth.getUser=async(...args:Parameters<typeof raw>)=>{authCalls++;const start=performance.now();try{return await raw(...args);}finally{authMs+=performance.now()-start;}};
 try{
  const created=await supabaseAdmin.auth.admin.createUser({email,password,email_confirm:true});if(created.error||!created.data.user)throw new Error('Dummy auth creation failed');id=created.data.user.id;
  await prisma.user.upsert({where:{id},create:{id,email,name:'Dummy Test Admin Performance',role:'ADMIN',isEmailVerified:true},update:{role:'ADMIN',isActive:true,isEmailVerified:true}});
  const login=await createUserSupabaseClient().auth.signInWithPassword({email,password});if(login.error||!login.data.session)throw new Error('Dummy sign-in failed');
  const token=login.data.session.access_token,address=server.address();if(!address||typeof address==='string')throw new Error('No local port');
  const call=async(path:string)=>{const start=performance.now();const response=await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`,{headers:{Authorization:`Bearer ${token}`}});const text=await response.text();return{path,status:response.status,ms:Math.round(performance.now()-start),bytes:Buffer.byteLength(text)};};
  await call('/auth/me');authCalls=0;authMs=0;
  const dbUrl=new URL(env.DATABASE_URL);console.log('ADMIN_PERF_POOL '+JSON.stringify({connectionLimit:dbUrl.searchParams.get('connection_limit'),poolTimeout:dbUrl.searchParams.get('pool_timeout'),pgbouncer:dbUrl.searchParams.get('pgbouncer')}));
  const pages=[];for(const path of ['/orders/revenue?from=2026-01-01&to=2026-12-31','/products?limit=20','/orders?limit=20','/users?limit=20','/reviews/admin?limit=20','/appointments?limit=20','/notifications?limit=20','/employees?limit=10'])pages.push(await call(path));
  const sequential={authCalls,authMs:Math.round(authMs)};authCalls=0;authMs=0;const start=performance.now();const burst=await Promise.all(Array.from({length:6},()=>call('/notifications?limit=20')));
  console.log('ADMIN_PERF_RESULT '+JSON.stringify({label:process.argv[2]??'measurement',pages,sequential,burst:{wallMs:Math.round(performance.now()-start),authCalls,authMs:Math.round(authMs),requests:burst}}));
 }finally{
  if(id){await prisma.deliveryJob.deleteMany({where:{idempotencyKey:{contains:id}}});await prisma.notification.deleteMany({where:{userId:id}});await prisma.customerNotification.deleteMany({where:{userId:id}});await prisma.user.deleteMany({where:{id}});const removed=await supabaseAdmin.auth.admin.deleteUser(id);if(removed.error)throw new Error('Dummy auth cleanup failed');console.log('ADMIN_PERF_CLEANUP verified');}
  server.close();await prisma.$disconnect();
 }
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Measurement failed');process.exitCode=1;});
