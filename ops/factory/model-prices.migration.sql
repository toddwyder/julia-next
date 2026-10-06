BEGIN;
CREATE TABLE IF NOT EXISTS factory_model_prices (
  provider text NOT NULL, model text NOT NULL, token_type text NOT NULL,
  usd_per_token numeric NOT NULL CHECK (usd_per_token >= 0), effective_from timestamptz NOT NULL,
  PRIMARY KEY (provider, model, token_type, effective_from)
);
GRANT SELECT, INSERT ON factory_model_prices TO "julia-factory";
COMMIT;
