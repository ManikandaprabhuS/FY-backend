import { AppointmentEmailStatus, AppointmentLocation, AppointmentStatus, Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), transaction: vi.fn(),
  wake: vi.fn(),
}));

vi.mock('../src/prisma/client', () => ({ prisma: { appointment: { create: mocks.create, update: mocks.update, findUnique: mocks.findUnique, findMany: mocks.findMany, count: mocks.count }, $transaction: mocks.transaction } }));
vi.mock('../src/services/delivery/outbox-signal',()=>({wakeDeliveryWorker:mocks.wake}));

import * as service from '../src/modules/appointment/appointment.service';

const id = '33333333-cccc-4333-8333-333333333333';
const original = new Date(Date.now() + 86_400_000);
const current = () => ({ id, firstName: 'Aarav', email: 'aarav@example.com', phoneNumber: '+919876543210', originalBookingDate: original, bookingDate: original, location: AppointmentLocation.COIMBATORE, frameTypes: ['PHOTOGRAPHS'], otherFrameType: null, status: AppointmentStatus.PENDING, rescheduleReason: null, cancellationReason: null, emailStatus: AppointmentEmailStatus.PENDING, createdAt: new Date(), updatedAt: new Date() });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue(current());
  mocks.findUnique.mockResolvedValue(current());


  mocks.update.mockImplementation((argument: { data: Record<string, unknown> }) => Promise.resolve({ ...current(), ...argument.data }));
});

describe('appointment service lifecycle', () => {
  it('sends no status email if the database update fails',async()=>{
    mocks.update.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.updateAppointmentStatus(id,{status:AppointmentStatus.CONFIRMED})).rejects.toThrow('database unavailable');
    expect(mocks.wake).not.toHaveBeenCalled();
  });
  it('returns a saved status change without waiting for an email transport',async()=>{
    const saved={...current(),status:AppointmentStatus.CONFIRMED};
    mocks.findUnique.mockResolvedValueOnce(current()).mockResolvedValueOnce(saved);
    mocks.update.mockResolvedValueOnce(saved);
    expect((await service.updateAppointmentStatus(id,{status:AppointmentStatus.CONFIRMED})).status).toBe(AppointmentStatus.CONFIRMED);
    expect(mocks.wake).toHaveBeenCalledOnce();
  });
  it('uses an atomic expected-version update and sends only one email for racing actions',async()=>{
    let claimed=false;
    mocks.update.mockImplementation((args:{where:Record<string,unknown>;data:Record<string,unknown>})=>{
      if(args.data.status){if(claimed)return Promise.reject(new Prisma.PrismaClientKnownRequestError('conflict',{code:'P2025',clientVersion:'6.19.3'}));claimed=true;expect(args.where).toMatchObject({id,status:AppointmentStatus.PENDING,bookingDate:original});}
      return Promise.resolve({...current(),status:AppointmentStatus.CONFIRMED,...args.data});
    });
    const result=await Promise.allSettled([service.updateAppointmentStatus(id,{status:AppointmentStatus.CONFIRMED}),service.updateAppointmentStatus(id,{status:AppointmentStatus.CONFIRMED})]);
    expect(result.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(mocks.wake).toHaveBeenCalledOnce();
  });
  it('returns a saved booking as PENDING for asynchronous email processing', async () => {

    const result = await service.createAppointment({ firstName: 'Aarav', email: 'aarav@example.com', phoneNumber: '+919876543210', bookingDate: original, location: AppointmentLocation.COIMBATORE, frameTypes: ['PHOTOGRAPHS'] });
    expect(result.emailStatus).toBe(AppointmentEmailStatus.PENDING);
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it('reschedules without overwriting the original booking date', async () => {
    const nextDate = new Date(original.getTime() + 86_400_000);
    const rescheduled = { ...current(), status: AppointmentStatus.RESCHEDULED, bookingDate: nextDate, rescheduleReason: 'Customer requested' };
    mocks.update.mockResolvedValueOnce(rescheduled);
    const result = await service.updateAppointmentStatus(id, { status: AppointmentStatus.RESCHEDULED, bookingDate: nextDate, rescheduleReason: 'Customer requested' });
    expect(result.bookingDate).toEqual(nextDate);
    const firstUpdate = mocks.update.mock.calls.at(0)?.at(0) as { data: Record<string, unknown> };
    expect(firstUpdate.data).not.toHaveProperty('originalBookingDate');
    expect(mocks.wake).toHaveBeenCalledOnce();
  });

  it('rejects terminal and otherwise invalid transitions', async () => {
    mocks.findUnique.mockResolvedValue({ ...current(), status: AppointmentStatus.CANCELLED });
    await expect(service.updateAppointmentStatus(id, { status: AppointmentStatus.CONFIRMED })).rejects.toMatchObject({ statusCode: 409, code: 'INVALID_APPOINTMENT_TRANSITION' });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejects rescheduling to the current booking date', async () => {
    await expect(service.updateAppointmentStatus(id, { status: AppointmentStatus.RESCHEDULED, bookingDate: original })).rejects.toMatchObject({ statusCode: 400, code: 'BOOKING_DATE_UNCHANGED' });
  });

  it('does not send a completed email', async () => {
    mocks.findUnique.mockResolvedValue({ ...current(), status: AppointmentStatus.CONFIRMED });

    const result = await service.updateAppointmentStatus(id, { status: AppointmentStatus.COMPLETED });
    expect(result.status).toBe(AppointmentStatus.COMPLETED);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});
