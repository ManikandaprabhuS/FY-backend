CREATE TYPE public.notification_type AS ENUM ('ACCOUNT_CREATED', 'ORDER_PLACED');

CREATE TABLE public.wishlists (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    product_identifier VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT wishlists_pkey PRIMARY KEY (id),
    CONSTRAINT wishlists_user_id_product_identifier_key UNIQUE (user_id, product_identifier),
    CONSTRAINT wishlists_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT wishlists_product_identifier_fkey FOREIGN KEY (product_identifier) REFERENCES public.products(product_identifier) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX wishlists_product_identifier_idx ON public.wishlists(product_identifier);

CREATE TABLE public.notifications (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    title VARCHAR(160) NOT NULL,
    message TEXT NOT NULL,
    type public.notification_type NOT NULL,
    read BOOLEAN NOT NULL DEFAULT false,
    read_by UUID,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT notifications_pkey PRIMARY KEY (id),
    CONSTRAINT notifications_title_not_blank CHECK (length(btrim(title)) > 0),
    CONSTRAINT notifications_message_not_blank CHECK (length(btrim(message)) > 0),
    CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT notifications_read_by_fkey FOREIGN KEY (read_by) REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX notifications_user_id_read_created_at_idx ON public.notifications(user_id, read, created_at);
CREATE INDEX notifications_type_created_at_idx ON public.notifications(type, created_at);
CREATE INDEX notifications_read_by_idx ON public.notifications(read_by);

ALTER TABLE public.wishlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
