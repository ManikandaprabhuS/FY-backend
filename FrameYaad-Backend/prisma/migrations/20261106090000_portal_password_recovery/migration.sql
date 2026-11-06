CREATE TABLE public.password_recoveries (
  id uuid PRIMARY KEY,
  user_id text NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  email varchar(320) NOT NULL,
  portal varchar(8) NOT NULL CHECK (portal IN ('CUSTOMER', 'ADMIN')),
  otp_hash varchar(64),
  expires_at timestamptz(6) NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  requested_at timestamptz(6) NOT NULL DEFAULT now(),
  verified_at timestamptz(6),
  reset_token_hash varchar(64) UNIQUE,
  reset_expires_at timestamptz(6),
  consumed_at timestamptz(6),
  provider_email_id text
);
CREATE INDEX password_recoveries_expires_at_idx ON public.password_recoveries(expires_at);
CREATE TABLE public.password_recovery_rates (
  key varchar(96) PRIMARY KEY,
  requests integer NOT NULL DEFAULT 0,
  window_expires_at timestamptz(6) NOT NULL,
  next_allowed_at timestamptz(6) NOT NULL
);
CREATE INDEX password_recovery_rates_window_expires_at_idx ON public.password_recovery_rates(window_expires_at);
ALTER TABLE public.password_recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_recovery_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_recoveries, public.password_recovery_rates FROM anon, authenticated;
