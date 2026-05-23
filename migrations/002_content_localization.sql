create table if not exists content_strings (
  id bigserial primary key,
  entity_type text not null,
  entity_id text not null,
  field_path text not null,
  source_locale text not null default 'en',
  source_text text not null,
  source_hash text not null,
  context_json jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  first_seen_run_id bigint references crawl_runs(id),
  last_seen_run_id bigint references crawl_runs(id),
  updated_at timestamptz not null default now(),
  unique (entity_type, entity_id, field_path, source_locale)
);

create table if not exists content_translations (
  string_id bigint not null references content_strings(id) on delete cascade,
  locale text not null,
  translated_text text not null default '',
  translation_status text not null default 'missing',
  needs_review boolean not null default false,
  reviewed_source_hash text,
  updated_at timestamptz not null default now(),
  primary key (string_id, locale)
);

create index if not exists idx_content_strings_entity
  on content_strings(entity_type, entity_id, field_path);

create index if not exists idx_content_strings_hash
  on content_strings(source_hash);

create index if not exists idx_content_translations_locale_status
  on content_translations(locale, translation_status, needs_review);
