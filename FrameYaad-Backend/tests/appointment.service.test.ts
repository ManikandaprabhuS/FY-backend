import { AppointmentEmailStatus, AppointmentLocation, AppointmentStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), transaction: vi.fn(),
  sendCreated: vi.fn(), sendStatus: vi.fn(),
}));

vi.mock('../src/prisma/client', () => ({ prisma: { appointment: { create: mocks.create, update: mocks.update, findUnique: mocks.findUnique, findMany: mocks.findMany, count: mocks.count }, $transaction: mocks.transaction } }));
vi.mock('../src/services/appointment-email/appointment-email.service', () => ({ sendAppointmentCreatedEmails: mocks.sendCreated, sendAppointmentStatusEmail: mocks.sendStatus }));

import * as service from '../src/modules/appointment/appointment.service';

const id = '33333333-cccc-4333-8333-333333333333';
const original = new Date(Date.now() + 86_400_000);
const current = () => ({ id, firstName: 'Aarav', email: 'aarav@example.com', phoneNumber: '+919876543210', originalBookingDate: original, bookingDate: original, location: AppointmentLocation.COIMBATORE, frameTypes: ['PHOTOGRAPHS'], otherFrameType: null, status: AppointmentStatus.PENDING, rescheduleReason: null, cancellationReason: null, emailStatus: AppointmentEmailStatus.PENDING, createdAt: new Date(), updatedAt: new Date() });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue(current());
  mocks.findUnique.mockResolvedValue(current());
  mocks.sendCreated.mockResolvedValue(true);
  mocks.sendStatus.mockResolvedValue(true);
  mocks.update.mockImplementation((argument: { data: Record<string, unknown> }) => Promise.resolve({ ...current(), ...argument.data }));
});

describe('appointment service lifecycle', () => {
  it('keeps the save successful and records FAILED when creation email fails', async () => {
    mocks.sendCreated.mockResolvedValue(false);
    const result = await service.createAppointment({ firstName: 'Aarav', email: 'aarav@example.com', phoneNumber: '+919876543210', bookingDate: original, location: AppointmentLocation.COIMBATORE, frameTypes: ['PHOTOGRAPHS'] });
    expect(result.emailStatus).toBe(AppointmentEmailStatus.FAILED);
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it('reschedules without overwriting the original booking date', async () => {
    const nextDate = new Date(original.getTime() + 86_400_000);
    const rescheduled = { ...current(), status: AppointmentStatus.RESCHEDULED, bookingDate: nextDate, rescheduleReason: 'Customer requested' };
    mocks.update.mockResolvedValueOnce(rescheduled).mockResolvedValueOnce({ ...rescheduled, emailStatus: AppointmentEmailStatus.SENT });
    const result = await service.updateAppointmentStatus(id, { status: AppointmentStatus.RESCHEDULED, bookingDate: nextDate, rescheduleReason: 'Customer requested' });
    expect(result.bookingDate).toEqual(nextDate);
    const firstUpdate = mocks.update.mock.calls.at(0)?.at(0) as { data: Record<string, unknown> };
    expect(firstUpdate.data).not.toHaveProperty('originalBookingDate');
    expect(mocks.sendStatus).toHaveBeenCalledWith(expect.objectContaining({ bookingDate: nextDate }), original);
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
    mocks.sendStatus.mockResolvedValue(null);
    const result = await service.updateAppointmentStatus(id, { status: AppointmentStatus.COMPLETED });
    expect(result.status).toBe(AppointmentStatus.COMPLETED);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});
