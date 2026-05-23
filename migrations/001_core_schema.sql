create table if not exists schema_migrations (
  filename text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);

create table if not exists crawl_runs (
  id bigserial primary key,
  kind text not null,
  source_url text not null,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  total_count integer not null default 0,
  new_count integer not null default 0,
  changed_count integer not null default 0,
  removed_count integer not null default 0,
  unchanged_count integer not null default 0,
  failed_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists dictionary_terms (
  term text primary key,
  keyword text,
  category text not null,
  meaning text not null,
  keep_reason text not null,
  variants_json jsonb not null default '[]'::jsonb,
  examples_json jsonb not null default '[]'::jsonb,
  description_en text not null default '',
  source_url text not null default '',
  hover_url text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists skill_gems (
  slug text primary key,
  name text not null,
  tier integer,
  color text not null,
  source_url text not null,
  icon_url text not null default '',
  icon_alt text not null default '',
  hover_url text not null default '',
  tags_json jsonb not null default '[]'::jsonb,
  source_hash text not null,
  status text not null default 'active',
  first_seen_run_id bigint references crawl_runs(id),
  last_seen_run_id bigint references crawl_runs(id),
  updated_at timestamptz not null default now()
);

create table if not exists skill_gem_translations (
  slug text primary key references skill_gems(slug) on delete cascade,
  vi_name text not null,
  vi_tags_json jsonb not null default '[]'::jsonb,
  translation_status text not null default 'auto',
  needs_review boolean not null default false,
  reviewed_hash text,
  updated_at timestamptz not null default now()
);

create table if not exists skill_gem_details (
  slug text primary key references skill_gems(slug) on delete cascade,
  summary_en text not null default '',
  summary_vi text not null default '',
  properties_json jsonb not null default '[]'::jsonb,
  requirements_json jsonb not null default '[]'::jsonb,
  mods_json jsonb not null default '[]'::jsonb,
  sections_json jsonb not null default '[]'::jsonb,
  source_hash text,
  updated_at timestamptz not null default now()
);

create table if not exists skill_gem_versions (
  id bigserial primary key,
  slug text not null references skill_gems(slug) on delete cascade,
  previous_hash text not null,
  next_hash text not null,
  previous_json jsonb not null,
  next_json jsonb not null,
  run_id bigint references crawl_runs(id),
  changed_at timestamptz not null default now()
);

create table if not exists currency_items (
  slug text primary key,
  name text not null,
  category text not null,
  category_label text not null,
  family text not null,
  family_label text not null,
  subtype text not null,
  subtype_label text not null,
  source_url text not null,
  icon_url text not null default '',
  icon_alt text not null default '',
  hover_url text not null default '',
  stack_size text not null default '',
  description_en text not null default '',
  description_vi text not null default '',
  properties_json jsonb not null default '[]'::jsonb,
  mods_json jsonb not null default '[]'::jsonb,
  source_hash text not null,
  status text not null default 'active',
  first_seen_run_id bigint references crawl_runs(id),
  last_seen_run_id bigint references crawl_runs(id),
  updated_at timestamptz not null default now()
);

create table if not exists currency_versions (
  id bigserial primary key,
  slug text not null references currency_items(slug) on delete cascade,
  previous_hash text not null,
  next_hash text not null,
  previous_json jsonb not null,
  next_json jsonb not null,
  run_id bigint references crawl_runs(id),
  changed_at timestamptz not null default now()
);

create table if not exists item_menus (
  key text primary key,
  label text not null,
  group_label text not null,
  source_url text not null unique,
  status text not null default 'active',
  sort_order integer not null default 0,
  first_seen_run_id bigint references crawl_runs(id),
  last_seen_run_id bigint references crawl_runs(id),
  updated_at timestamptz not null default now()
);

create table if not exists items (
  slug text primary key,
  menu_key text not null references item_menus(key) on delete restrict,
  menu_label text not null,
  group_label text not null,
  name text not null,
  source_url text not null unique,
  icon_url text not null default '',
  icon_alt text not null default '',
  requirements_json jsonb not null default '[]'::jsonb,
  properties_json jsonb not null default '[]'::jsonb,
  mods_json jsonb not null default '[]'::jsonb,
  raw_json jsonb not null default '{}'::jsonb,
  translated_json jsonb not null default '{}'::jsonb,
  tooltip_refs_json jsonb not null default '[]'::jsonb,
  source_hash text not null,
  status text not null default 'active',
  first_seen_run_id bigint references crawl_runs(id),
  last_seen_run_id bigint references crawl_runs(id),
  updated_at timestamptz not null default now()
);

create table if not exists item_versions (
  id bigserial primary key,
  slug text not null references items(slug) on delete cascade,
  previous_hash text not null,
  next_hash text not null,
  previous_json jsonb not null,
  next_json jsonb not null,
  run_id bigint references crawl_runs(id),
  changed_at timestamptz not null default now()
);

create table if not exists item_tooltip_refs (
  id bigserial primary key,
  item_slug text not null references items(slug) on delete cascade,
  term text not null,
  keyword text,
  label text not null,
  href text not null default '',
  hover_url text not null default '',
  source_url text not null default '',
  run_id bigint references crawl_runs(id),
  created_at timestamptz not null default now(),
  unique (item_slug, term, label, hover_url)
);

create index if not exists idx_crawl_runs_kind_started on crawl_runs(kind, started_at desc);
create index if not exists idx_dictionary_terms_category on dictionary_terms(category);
create index if not exists idx_skill_gems_active_tier on skill_gems(tier, name) where status = 'active';
create index if not exists idx_skill_gems_tags_gin on skill_gems using gin(tags_json);
create index if not exists idx_currency_items_active_subtype on currency_items(subtype, name) where status = 'active';
create index if not exists idx_currency_items_props_gin on currency_items using gin(properties_json);
create index if not exists idx_item_menus_active_group on item_menus(group_label, sort_order) where status = 'active';
create index if not exists idx_items_active_menu on items(menu_key, name) where status = 'active';
create index if not exists idx_items_active_updated on items(updated_at desc) where status = 'active';
create index if not exists idx_items_translated_gin on items using gin(translated_json);
create index if not exists idx_items_tooltips_gin on items using gin(tooltip_refs_json);
create index if not exists idx_item_tooltip_refs_term on item_tooltip_refs(term);
