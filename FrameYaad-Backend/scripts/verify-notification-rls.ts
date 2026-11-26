import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/prisma/client';

// Dedicated dev/test only. Fixtures are deliberately rolled back, never committed.
const rollback = new Error('ROLLBACK_NOTIFICATION_RLS_FIXTURES');
async function main() {
  const customers = await prisma.user.findMany({ where: { role: 'CUSTOMER', isActive: true }, select: { id: true }, take: 2 });
  const staff = await prisma.user.findFirst({ where: { role: { in: ['ADMIN', 'EMPLOYEE'] }, isActive: true }, select: { id: true } });
  assert(customers.length === 2 && staff, 'Need two active dev customers and one staff account; no users will be created');
  const own = randomUUID(), other = randomUUID(), legacy = randomUUID(), operational = randomUUID();
  try {
    await prisma.$transaction(async tx => {
      await tx.customerNotification.createMany({ data: [
        { id: own, userId: customers[0].id, orderId: 'dev-rls-rollback-only', type: 'TEST', title: 'Dummy notification RLS check', message: 'Rolled back' },
        { id: other, userId: customers[1].id, orderId: 'dev-rls-rollback-only', type: 'TEST', title: 'Dummy notification RLS check', message: 'Rolled back' },
      ] });
      await tx.notification.createMany({ data: [
        { id: legacy, userId: customers[0].id, title: 'Dummy notification RLS check', message: 'Rolled back', type: 'INFO' },
        { id: operational, userId: null, title: 'Dummy notification RLS check', message: 'Rolled back', type: 'INFO' },
      ] });
      await tx.$executeRawUnsafe('SET LOCAL ROLE authenticated');
      const identity = (id: string) => tx.$queryRaw`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: id, role: 'authenticated' })}, true)`;
      await identity(customers[0].id);
      let rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM public.customer_notifications WHERE id IN (${own}, ${other})`;
      assert.deepEqual(rows.map(r => r.id), [own], 'Customer reads own modern notification only');
      rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM public.notifications WHERE id IN (${legacy}, ${operational})`;
      assert.deepEqual(rows.map(r => r.id), [legacy], 'Customer reads own legacy notification, not staff broadcast');
      await identity(customers[1].id);
      rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM public.customer_notifications WHERE id IN (${own}, ${other})`;
      assert.deepEqual(rows.map(r => r.id), [other], 'Second customer isolation');
      await identity(staff!.id);
      rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM public.notifications WHERE id IN (${legacy}, ${operational})`;
      assert.deepEqual(rows.map(r => r.id), [operational], 'Staff reads operational notifications only');
      rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM public.customer_notifications WHERE id IN (${own}, ${other})`;
      assert.equal(rows.length, 0, 'Staff cannot subscribe to private customer notification rows');
      throw rollback;
    }, { timeout: 30000 });
  } catch (error) { if (error !== rollback) throw error; }
  assert.equal(await prisma.customerNotification.count({ where: { id: { in: [own, other] } } }), 0);
  assert.equal(await prisma.notification.count({ where: { id: { in: [legacy, operational] } } }), 0);
  let denied = false;
  try { await prisma.$transaction(async tx => { await tx.$executeRawUnsafe('SET LOCAL ROLE anon'); await tx.$queryRawUnsafe('SELECT id FROM public.notifications LIMIT 1'); }); }
  catch (error) { denied = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010' && error.meta?.code === '42501'; }
  assert(denied, 'Anonymous reads must be forbidden');
  console.log('PASS: own/other customer, legacy, staff, anonymous isolation; four fixtures rolled back and cleanup verified');
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'RLS verification failed'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
