import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../src/config/env';
import { supabaseAdmin } from '../src/config/supabase';
import { prisma } from '../src/prisma/client';

// Dedicated dev/test only. No email is sent: admin-created ephemeral Auth accounts
// use reserved .invalid addresses, confirmed locally for this isolation test.
const ids: string[] = [], noticeIds: string[] = [], clients: SupabaseClient[] = [];
const received: Array<{ audience: string; id: string; event: string; at: number }> = [];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function account(role: 'CUSTOMER' | 'EMPLOYEE') {
  const email = `notification-dev-${randomUUID()}@example.invalid`, password = randomBytes(32).toString('base64url');
  const result = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (result.error || !result.data.user) throw new Error('Unable to create ephemeral dev Auth account');
  const id = result.data.user.id; ids.push(id);
  await prisma.user.create({ data: { id, email, name: 'Dummy Notification Test', role, isActive: true, isEmailVerified: true } });
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }); clients.push(client);
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error || !login.data.session) throw new Error('Unable to sign in ephemeral dev account');
  await client.realtime.setAuth(login.data.session.access_token);
  return { id, client };
}
async function subscribe(audience: string, user: Awaited<ReturnType<typeof account>>, staff = false) {
  const channel = user.client.channel(`dev-check-${randomUUID()}`);
  channel.on('system', {}, payload => console.log(JSON.stringify({audience,system:payload})));
  const filter = staff ? 'userId=is.null' : `userId=eq.${user.id}`;
  for (const event of ['INSERT', 'UPDATE'] as const) for (const table of staff ? ['notifications'] : ['notifications', 'customer_notifications']) {
    channel.on('postgres_changes', { event, schema: 'public', table, filter }, payload => received.push({ audience, id: String(payload.new.id), event: payload.eventType, at: performance.now() }));
  }
  await new Promise<void>((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime subscription timed out')), 20000);
    channel.subscribe(status => { if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error(`Realtime ${status}`)); } });
  });
  return channel;
}
async function waitFor(audience: string, id: string, event = 'INSERT') {
  const end = Date.now()+12000;
  while(Date.now()<end) { const found=received.find(e=>e.audience===audience&&e.id===id&&e.event===event); if(found)return found; await sleep(50); }
  throw new Error(`Realtime ${audience} ${event} event missing`);
}
async function main() {
  const a=await account('CUSTOMER'), b=await account('CUSTOMER'), staff=await account('EMPLOYEE');
  await Promise.all([subscribe('a',a),subscribe('b',b),subscribe('staff',staff,true)]);
  await sleep(1500);
  const own=randomUUID(), broadcast=randomUUID(), missed=randomUUID();noticeIds.push(own,broadcast,missed);
  const started=performance.now();
  await prisma.customerNotification.create({data:{id:own,userId:a.id,orderId:'dev-notification-check',type:'TEST',title:'Dummy Notification Test',message:'Dev verification only'}});
  const delivered=await waitFor('a',own);
  await prisma.notification.create({data:{id:broadcast,userId:null,type:'INFO',title:'Dummy Notification Test',message:'Dev verification only'}});
  await waitFor('staff',broadcast);
  await prisma.customerNotification.update({where:{id:own},data:{isRead:true}});await waitFor('a',own,'UPDATE');
  await sleep(500);
  assert(!received.some(e=>e.id===own&&e.audience!=='a'),'Private event leaked');
  assert(!received.some(e=>e.id===broadcast&&e.audience!=='staff'),'Staff event leaked');
  const foreign=await b.client.from('customer_notifications').select('id').eq('id',own);assert.ifError(foreign.error);assert.equal(foreign.data?.length,0);
  const staffPrivate=await staff.client.from('customer_notifications').select('id').eq('id',own);assert.ifError(staffPrivate.error);assert.equal(staffPrivate.data?.length,0);
  await a.client.removeAllChannels();a.client.realtime.disconnect();
  await prisma.customerNotification.create({data:{id:missed,userId:a.id,orderId:'dev-notification-check',type:'TEST',title:'Dummy Notification Test',message:'Missed while disconnected'}});
  await subscribe('a-return',a);
  const history=await a.client.from('customer_notifications').select('id,isRead').in('id',[own,missed]);assert.ifError(history.error);assert.equal(history.data?.length,2);assert(history.data?.find(n=>n.id===own)?.isRead);
  console.log(JSON.stringify({privateInsertLatencyMs:Math.round(delivered.at-started),ownOnly:true,staffOnly:true,markReadUpdate:true,reconnectHistory:true,receivedEvents:received.length}));
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Realtime verification failed');process.exitCode=1;}).finally(async()=>{
  for(const client of clients){await client.removeAllChannels();client.realtime.disconnect();}
  await prisma.deliveryJob.deleteMany({where:{OR:ids.map(id=>({idempotencyKey:{startsWith:'welcome:'+id}}))}});
  await prisma.customerNotification.deleteMany({where:{id:{in:noticeIds}}});await prisma.notification.deleteMany({where:{id:{in:noticeIds}}});
  await prisma.user.deleteMany({where:{id:{in:ids}}});
  for(const id of ids){const result=await supabaseAdmin.auth.admin.deleteUser(id);if(result.error){console.error('Ephemeral Auth cleanup failed');process.exitCode=1;}}
  const remaining=await prisma.user.count({where:{id:{in:ids}}})+await prisma.customerNotification.count({where:{id:{in:noticeIds}}})+await prisma.notification.count({where:{id:{in:noticeIds}}});
  console.log(JSON.stringify({remainingDevFixtures:remaining,authAccountsAttemptedCleanup:ids.length}));await prisma.$disconnect();
});
