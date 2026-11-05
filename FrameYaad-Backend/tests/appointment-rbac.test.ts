import { AppointmentLocation, AppointmentStatus, UserRole } from '@prisma/client';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), userFindUnique: vi.fn(), userUpdate: vi.fn(),
  createAppointment: vi.fn(), listAppointments: vi.fn(), getAppointment: vi.fn(), updateAppointmentStatus: vi.fn(),
}));

vi.mock('../src/config/supabase', () => ({ supabaseAdmin: { auth: { getUser: mocks.getUser } }, createUserSupabaseClient: vi.fn() }));
vi.mock('../src/prisma/client', () => ({ prisma: { user: { findUnique: mocks.userFindUnique, update: mocks.userUpdate } } }));
vi.mock('../src/modules/appointment/appointment.service', () => ({
  createAppointment: mocks.createAppointment,
  listAppointments: mocks.listAppointments,
  getAppointment: mocks.getAppointment,
  updateAppointmentStatus: mocks.updateAppointmentStatus,
}));

import { app } from '../src/app';

const userId = '11111111-aaaa-4111-8111-111111111111';
const appointmentId = '22222222-bbbb-4222-8222-222222222222';
const future = () => new Date(Date.now() + 86_400_000).toISOString();
const validBody = () => ({ firstName: 'Meera', email: 'MEERA@EXAMPLE.COM', phoneNumber: '+91 98765 43210', bookingDate: future(), location: AppointmentLocation.ODDANCHATRAM, frameTypes: ['PHOTOGRAPHS'] });
const appointment = () => ({ id: appointmentId, ...validBody(), email: 'meera@example.com', originalBookingDate: new Date(future()), bookingDate: new Date(future()), status: AppointmentStatus.PENDING, otherFrameType: null, rescheduleReason: null, cancellationReason: null, emailStatus: 'SENT', createdAt: new Date(), updatedAt: new Date() });
const baseUser = { id: userId, name: 'Staff', email: 'staff@example.com', isEmailVerified: true, phoneNumber: null, isPhoneNumberVerified: false, addressLine: null, postalCode: null, city: null, state: null, country: null, gender: null, role: UserRole.ADMIN, isActive: true, createdById: null, createdAt: new Date(), updatedAt: new Date() };

const authenticateAs = (role: UserRole) => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId, email_confirmed_at: new Date().toISOString(), phone_confirmed_at: null } }, error: null });
  mocks.userFindUnique.mockResolvedValue({ ...baseUser, role });
};

beforeEach(() => {
  vi.clearAllMocks(); authenticateAs(UserRole.ADMIN);
  mocks.createAppointment.mockResolvedValue(appointment());
  mocks.listAppointments.mockResolvedValue({ appointments: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
  mocks.getAppointment.mockResolvedValue(appointment());
  mocks.updateAppointmentStatus.mockResolvedValue({ ...appointment(), status: AppointmentStatus.CONFIRMED });
});

describe('appointment public creation', () => {
  it('creates a pending appointment with normalized values', async () => {
    const response = await request(app).post('/api/v1/appointments').send(validBody());
    expect(response.status).toBe(201);
    expect(mocks.createAppointment).toHaveBeenCalledWith(expect.objectContaining({ email: 'meera@example.com', phoneNumber: '+919876543210' }));
  });

  it.each([
    ['missing name', { firstName: '' }], ['bad email', { email: 'invalid' }], ['bad phone', { phoneNumber: '1234' }],
    ['past date', { bookingDate: '2020-01-01T00:00:00.000Z' }], ['invalid location', { location: 'CHENNAI' }], ['empty types', { frameTypes: [] }],
    ['others missing description', { frameTypes: ['OTHERS'] }],
  ])('rejects %s', async (_label, override) => {
    const response = await request(app).post('/api/v1/appointments').send({ ...validBody(), ...override });
    expect(response.status).toBe(400); expect(mocks.createAppointment).not.toHaveBeenCalled();
  });
});

describe('appointment staff access', () => {
  it.each([UserRole.ADMIN, UserRole.EMPLOYEE])('allows %s to list and manage', async (role) => {
    authenticateAs(role);
    expect((await request(app).get('/api/v1/appointments').set('Authorization', `Bearer ${role}`)).status).toBe(200);
    expect((await request(app).patch(`/api/v1/appointments/${appointmentId}/status`).set('Authorization', `Bearer ${role}`).send({ status: 'CONFIRMED' })).status).toBe(200);
  });

  it('blocks unauthenticated and customer access', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error('invalid') });
    expect((await request(app).get('/api/v1/appointments')).status).toBe(401);
    authenticateAs(UserRole.CUSTOMER);
    expect((await request(app).get('/api/v1/appointments').set('Authorization', 'Bearer customer')).status).toBe(403);
  });

  it('requires a future date when rescheduling', async () => {
    const response = await request(app).patch(`/api/v1/appointments/${appointmentId}/status`).set('Authorization', 'Bearer admin').send({ status: 'RESCHEDULED' });
    expect(response.status).toBe(400); expect(mocks.updateAppointmentStatus).not.toHaveBeenCalled();
  });
});
