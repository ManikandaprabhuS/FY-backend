-- Dev/review only. Revert the corresponding application release first.
-- Export the three new Product settings and Order upload-policy snapshots before
-- rollback if any were edited/new orders placed. No old business columns/rows change.
BEGIN;
ALTER TABLE public."Product" DROP CONSTRAINT product_photo_policy_check;
DROP INDEX public.product_arts_created_idx;
ALTER TABLE public."Product" DROP COLUMN allow_customer_photo,DROP COLUMN max_photo_mb,DROP COLUMN is_frameyaad_art;
ALTER TABLE public."Order" DROP COLUMN customer_photo_allowed;
COMMIT;
