-- A NULL user_id identifies one shared operational notification visible to
-- authenticated admins and employees. A non-NULL user_id remains a private
-- customer notification.
ALTER TABLE public.notifications ALTER COLUMN user_id DROP NOT NULL;

-- Convert any operational notifications created by the previous per-admin
-- implementation into a single shared record without duplicating the feed.
WITH ranked AS (
    SELECT n.id,
           row_number() OVER (
               PARTITION BY n.type, n.title, n.message
               ORDER BY n.created_at, n.id
           ) AS occurrence
    FROM public.notifications n
    INNER JOIN public.users u ON u.id = n.user_id
    WHERE u.role IN ('ADMIN'::public.user_role, 'EMPLOYEE'::public.user_role)
)
DELETE FROM public.notifications n
USING ranked r
WHERE n.id = r.id AND r.occurrence > 1;

UPDATE public.notifications n
SET user_id = NULL
FROM public.users u
WHERE n.user_id = u.id
  AND u.role IN ('ADMIN'::public.user_role, 'EMPLOYEE'::public.user_role);
