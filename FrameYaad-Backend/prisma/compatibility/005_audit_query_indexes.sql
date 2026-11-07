-- Task 2: additive indexes for observed query paths
-- Run each statement outside a transaction because CONCURRENTLY avoids blocking writes
-- Existing unique email, phone, employee ID, SKU and coupon-code indexes are retained

-- Customer/employee role lists ordered by creation time
CREATE INDEX CONCURRENTLY IF NOT EXISTS "users_role_createdAt_idx" ON public.users (role, "createdAt" DESC);
-- Customer order history and admin status queues
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_userId_createdAt_idx" ON public."Order" ("userId", "createdAt" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_orderStatus_createdAt_idx" ON public."Order" ("orderStatus", "createdAt" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_createdAt_idx" ON public."Order" ("createdAt" DESC);
-- Batched order item loading
CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderItem_orderId_idx" ON public."OrderItem" ("orderId");
-- Product relations and paginated admin catalog
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_materialId_idx" ON public."Product" ("materialId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_variantId_idx" ON public."Product" ("variantId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_createdAt_idx" ON public."Product" ("createdAt" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProductVariant_productId_idx" ON public."ProductVariant" ("productId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProductImage_productIdentifier_idx" ON public."ProductImage" ("productIdentifier");
-- Owner-scoped address and notification pages and unread filters
CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_address_userId_idx" ON public.user_address ("userId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "notifications_userId_date_idx" ON public.notifications ("userId", date DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "notifications_userId_read_date_idx" ON public.notifications ("userId", read, date DESC);
-- Wishlist pagination and cross-customer product analytics
CREATE INDEX CONCURRENTLY IF NOT EXISTS "wishlist_userId_createdAt_idx" ON public.wishlist ("userId", "createdAt" DESC, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "wishlist_productIdentifier_idx" ON public.wishlist ("productIdentifier");
-- Reverse references used by product deletion checks and coupon detail lists
CREATE INDEX CONCURRENTLY IF NOT EXISTS "CartItem_productIdentifier_idx" ON public."CartItem" ("productIdentifier");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderItem_productIdentifier_idx" ON public."OrderItem" ("productIdentifier");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "product_discount_couponId_idx" ON public.product_discount ("couponId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "coupon_createdAt_idx" ON public.coupon ("createdAt" DESC);
-- Normalized uniqueness is a race-safe backstop after conflict prechecks
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "users_normalized_email_key" ON public.users (LOWER(BTRIM(email)));
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "coupon_normalized_code_key" ON public.coupon (UPPER(BTRIM("couponCode")));
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "ProductImage_normalized_color_key" ON public."ProductImage" ("productIdentifier", LOWER(BTRIM(color))) WHERE color IS NOT NULL;
