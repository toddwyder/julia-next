-- Apply to Factory's existing PostgreSQL database before enabling WEB_PUSH_*.
BEGIN;
CREATE TABLE IF NOT EXISTS factory_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  endpoint_hash text NOT NULL,
  encrypted_subscription bytea NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint_hash)
);
CREATE TABLE IF NOT EXISTS factory_push_deliveries (
  event_key text NOT NULL,
  device_id uuid NOT NULL REFERENCES factory_push_subscriptions(id),
  status text NOT NULL CHECK (status IN ('claimed', 'accepted', 'rejected', 'expired', 'unresolved')),
  attempts integer NOT NULL DEFAULT 1,
  retry_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_key, device_id)
);
GRANT SELECT, INSERT, UPDATE ON factory_push_subscriptions, factory_push_deliveries TO "julia-factory";
COMMIT;
