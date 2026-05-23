alter table currency_items
  add column if not exists related_items_json jsonb not null default '[]'::jsonb;

create index if not exists idx_currency_items_related_gin
  on currency_items using gin(related_items_json);
