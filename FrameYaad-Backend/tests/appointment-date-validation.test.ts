import {expect,it} from 'vitest';
import {createAppointmentSchema,updateAppointmentStatusSchema} from '../src/modules/appointment/appointment.schemas';
it('rejects past booking and reschedule dates server-side; permits future times',()=>{
 const base={firstName:'Test Customer',email:'test@example.invalid',phoneNumber:'9000000000',location:'ODDANCHATRAM',frameTypes:['PHOTOGRAPHS']};
 for(const date of [new Date(Date.now()-86400000),new Date(Date.now()-60000)]){
  expect(createAppointmentSchema.safeParse({...base,bookingDate:date.toISOString()}).success).toBe(false);
  expect(updateAppointmentStatusSchema.safeParse({status:'RESCHEDULED',bookingDate:date.toISOString()}).success).toBe(false);
 }
 expect(createAppointmentSchema.safeParse({...base,bookingDate:new Date(Date.now()+3600000).toISOString()}).success).toBe(true);
});
