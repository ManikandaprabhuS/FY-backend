-- Dev rollback only: restores observed 2026-11-26 notification ACL/RLS/publication.
-- Before using on another environment, compare its original grants and policies.
BEGIN;
ALTER PUBLICATION supabase_realtime DROP TABLE public.notifications, public.customer_notifications;
DROP POLICY fy_notification_customer_read ON public.notifications;
DROP POLICY fy_notification_staff_read ON public.notifications;
DROP POLICY fy_customer_notification_read ON public.customer_notifications;
ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_notifications DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications, public.customer_notifications FROM anon, authenticated;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.notifications, public.customer_notifications TO anon, authenticated;
DROP FUNCTION frameyaad_private.notification_role(text[]);
-- Keep the namespace and publication; they may acquire unrelated users later.
COMMIT;
