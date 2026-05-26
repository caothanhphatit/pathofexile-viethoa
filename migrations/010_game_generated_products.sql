create table if not exists game_generated_products (
  id bigserial primary key,
  extract_version_id bigint not null references game_extract_versions(id) on delete cascade,
  product_key text not null,
  product_kind text not null,
  product_hash text not null,
  payload_json jsonb not null,
  parity_json jsonb not null default '{}'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (extract_version_id, product_key)
);

create index if not exists idx_game_generated_products_kind
  on game_generated_products(product_kind, product_hash);

create index if not exists idx_game_generated_products_payload_gin
  on game_generated_products using gin(payload_json);
