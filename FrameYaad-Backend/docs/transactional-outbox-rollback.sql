-- Review-only rollback aid. Stop/revert the new application worker first.
-- Preserve delivery_jobs/email_delivery_events for investigation; do not discard
-- pending/failed work or provider IDs. No existing business/history rows are deleted.
BEGIN;
DROP TRIGGER IF EXISTS fy_order_delivery ON public."Order";
DROP TRIGGER IF EXISTS fy_appointment_delivery ON public.appointments;
DROP TRIGGER IF EXISTS fy_verified_welcome_delivery ON public.users;
DROP FUNCTION IF EXISTS frameyaad_private.enqueue_business_delivery();
COMMIT;
-- New private queue tables are intentionally retained. Archive/reconcile their
-- contents before separately considering removal and reconciling migration history.
