BEGIN;
CREATE TYPE "DeliveryJobState" AS ENUM ('PENDING','PROCESSING','SENT','FAILED');
CREATE TABLE public.delivery_jobs (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 sequence bigserial NOT NULL UNIQUE,
 "idempotencyKey" varchar(240) NOT NULL UNIQUE,
 kind varchar(40) NOT NULL, payload jsonb NOT NULL,
 state "DeliveryJobState" NOT NULL DEFAULT 'PENDING', attempts integer NOT NULL DEFAULT 0,
 "availableAt" timestamptz(3) NOT NULL DEFAULT now(), "lockedAt" timestamptz(3), "lockToken" text,
 "firstAttemptAt" timestamptz(3), "providerMessageId" text UNIQUE, "lastError" varchar(160),
 "deliveryEvent" varchar(40), "deliveredAt" timestamptz(3),
 "createdAt" timestamptz(3) NOT NULL DEFAULT now(), "updatedAt" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX delivery_jobs_state_availableAt_sequence_idx ON public.delivery_jobs(state,"availableAt",sequence);
CREATE TABLE public.email_delivery_events (
 id text PRIMARY KEY, "providerMessageId" text NOT NULL, type varchar(40) NOT NULL,
 "occurredAt" timestamptz(3) NOT NULL, "receivedAt" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX email_delivery_events_providerMessageId_idx ON public.email_delivery_events("providerMessageId");
ALTER TABLE public.delivery_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_delivery_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_jobs,public.email_delivery_events FROM anon,authenticated;
REVOKE ALL ON SEQUENCE public.delivery_jobs_sequence_seq FROM anon,authenticated;

-- Database triggers provide the same transaction boundary for every existing writer.
-- They don't alter business fields, historical rows, stock, status rules or API payloads.
CREATE FUNCTION frameyaad_private.enqueue_business_delivery() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE k text; event_key text; body jsonb;
BEGIN
 body:=to_jsonb(NEW);
 IF TG_TABLE_NAME='Order' THEN
  IF TG_OP='INSERT' THEN k:='ORDER_PLACED';event_key:='order-placed:'||NEW.id;
  ELSIF NEW."orderStatus" IS DISTINCT FROM OLD."orderStatus" THEN
   k:='ORDER_STATUS';event_key:='order-status:'||(NEW."statusHistory"->-1->>'eventId');
  ELSIF NEW."refundStatus" IS DISTINCT FROM OLD."refundStatus" THEN
   k:='REFUND';event_key:='refund:'||(NEW."refundHistory"->-1->>'eventId');
  ELSE RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='appointments' THEN
  body:=jsonb_build_object('id',NEW.id,'firstName',NEW.first_name,'email',NEW.email,'phoneNumber',NEW.phone_number,
   'originalBookingDate',NEW.original_booking_date,'bookingDate',NEW.booking_date,'location',NEW.location,
   'frameTypes',NEW.frame_types,'otherFrameType',NEW.other_frame_type,'status',NEW.status,
   'rescheduleReason',NEW.reschedule_reason,'cancellationReason',NEW.cancellation_reason,'updatedAt',NEW.updated_at);
  IF TG_OP='INSERT' THEN k:='APPOINTMENT_CREATED';event_key:='appointment-created:'||NEW.id;
  ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.booking_date IS DISTINCT FROM OLD.booking_date THEN
   IF NEW.status::text='COMPLETED' THEN RETURN NEW; END IF;
   k:='APPOINTMENT_STATUS';event_key:='appointment-status:'||NEW.id||':'||txid_current()::text;
   body:=body||jsonb_build_object('previousBookingDate',OLD.booking_date);
  ELSE RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='users' THEN
  IF NEW.role::text<>'CUSTOMER' OR NOT NEW."isEmailVerified" THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD."isEmailVerified" THEN RETURN NEW; END IF;
  k:='WELCOME';event_key:='welcome:'||NEW.id;
  body:=jsonb_build_object('id',NEW.id,'name',NEW.name,'email',NEW.email);
 ELSE RETURN NEW; END IF;
 IF event_key IS NULL THEN RAISE EXCEPTION 'Delivery event identity is required'; END IF;
 INSERT INTO public.delivery_jobs("idempotencyKey",kind,payload) VALUES(event_key,k,body) ON CONFLICT("idempotencyKey") DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION frameyaad_private.enqueue_business_delivery() FROM PUBLIC;
CREATE TRIGGER fy_order_delivery AFTER INSERT OR UPDATE ON public."Order" FOR EACH ROW EXECUTE FUNCTION frameyaad_private.enqueue_business_delivery();
CREATE TRIGGER fy_appointment_delivery AFTER INSERT OR UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION frameyaad_private.enqueue_business_delivery();
CREATE TRIGGER fy_verified_welcome_delivery AFTER INSERT OR UPDATE OF "isEmailVerified" ON public.users FOR EACH ROW EXECUTE FUNCTION frameyaad_private.enqueue_business_delivery();
COMMIT;
