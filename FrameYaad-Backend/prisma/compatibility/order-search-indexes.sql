-- Additive indexes for Orders Management filters/search; no row/schema-column changes.
-- Run outside a transaction because CREATE INDEX CONCURRENTLY is used.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
SET search_path TO public, extensions;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_userAddressId_idx" ON public."Order" ("userAddressId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_orderNumber_trgm_idx" ON public."Order" USING gin ("orderNumber" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS users_name_trgm_idx ON public.users USING gin (name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS users_email_trgm_idx ON public.users USING gin (email gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS users_normalized_phone_trgm_idx ON public.users USING gin ((regexp_replace(COALESCE("phoneNumber", ''), '[^0-9]', '', 'g')) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS user_address_normalized_phone_trgm_idx ON public.user_address USING gin ((regexp_replace("contactNumber", '[^0-9]', '', 'g')) gin_trgm_ops);
