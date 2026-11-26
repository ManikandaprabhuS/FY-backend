import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({send:vi.fn()}));
vi.mock('../src/services/email.service',()=>({sendEmail:mocks.send}));
import {sendAppointmentCreatedEmails,sendAppointmentStatusEmail} from '../src/services/appointment-email/appointment-email.service';
import type {AppointmentEmailView} from '../src/modules/appointment/appointment.types';
const original=new Date('2026-12-03T04:30:00Z'),next=new Date('2026-12-04T05:30:00Z');
const booking:AppointmentEmailView={id:'33333333-cccc-4333-8333-333333333333',firstName:'Test <Customer>',email:'test@example.invalid',phoneNumber:'9000000000',originalBookingDate:original,bookingDate:original,location:'ODDANCHATRAM',frameTypes:['PHOTOGRAPHS'],otherFrameType:null,status:'PENDING',rescheduleReason:null,cancellationReason:null};
beforeEach(()=>{vi.resetAllMocks();mocks.send.mockResolvedValue({id:'mock-provider-message'});});
it('uses the existing transport for branded booking/confirmation emails with escaped customer details',async()=>{
 await sendAppointmentCreatedEmails(booking);expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({to:booking.email,subject:'Appointment Request Received',html:expect.stringContaining('Test &lt;Customer&gt;')}));
 await sendAppointmentStatusEmail({...booking,status:'CONFIRMED'});const mail=mocks.send.mock.calls.at(-1)?.[0] as {html:string};expect(mail.html).toContain('The FrameYaad Team');expect(mail.html).toContain('Oddanchatram');expect(mail.html).not.toContain('<Customer>');
});
it('reschedule email distinguishes saved previous and new dates',async()=>{
 await sendAppointmentStatusEmail({...booking,status:'RESCHEDULED',bookingDate:next},original);
 const html=(mocks.send.mock.calls[0]?.[0] as {html:string}).html;expect(html).toContain('Previous date:');expect(html).toContain('New date:');expect(html).toContain('3 December 2026');expect(html).toContain('4 December 2026');
});
it('cancellation preserves original date and escapes the optional reason',async()=>{
 await sendAppointmentStatusEmail({...booking,status:'CANCELLED',bookingDate:next,cancellationReason:'Test <reason>'});
 const html=(mocks.send.mock.calls[0]?.[0] as {html:string}).html;expect(html).toContain('Originally requested:');expect(html).toContain('3 December 2026');expect(html).toContain('Test &lt;reason&gt;');
});
it('transport failures return false rather than undoing saved bookings',async()=>{mocks.send.mockRejectedValue(new Error('simulated delivery failure'));expect(await sendAppointmentStatusEmail({...booking,status:'CONFIRMED'})).toBe(false);});
