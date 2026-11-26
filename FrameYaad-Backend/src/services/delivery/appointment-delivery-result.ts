import {z} from 'zod';
import {prisma} from '../../prisma/client';
const metadata=z.object({appointmentId:z.string().uuid(),appointmentStatus:z.string(),bookingDate:z.string(),parentId:z.string()});
export async function trackAppointmentEmail(payload:unknown,sent:boolean){
 const result=metadata.safeParse(payload);if(!result.success)return;
 const value=result.data,status=sent?'SENT':'FAILED';
 await prisma.$executeRaw`UPDATE public.appointments SET email_status=${status}::appointment_email_status,updated_at=date_trunc('milliseconds',now())
 WHERE id=${value.appointmentId}::uuid AND status::text=${value.appointmentStatus} AND booking_date=${new Date(value.bookingDate)}
 AND email_status::text<>${status}
 AND ${value.parentId}=(SELECT id FROM public.delivery_jobs WHERE kind IN ('APPOINTMENT_CREATED','APPOINTMENT_STATUS') AND payload->>'id'=${value.appointmentId} ORDER BY sequence DESC LIMIT 1)`;
}
