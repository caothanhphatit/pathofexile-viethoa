create table if not exists game_data_runs (
  id bigserial primary key,
  run_key text not null unique,
  kind text not null,
  source_label text not null default '',
  source_ref text not null default '',
  source_hash text not null default '',
  status text not null default 'running',
  summary_json jsonb not null default '{}'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  crawl_run_id bigint references crawl_runs(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists game_data_sources (
  source_key text primary key,
  source_type text not null,
  source_label text not null default '',
  source_ref text not null default '',
  source_url text not null default '',
  source_hash text not null default '',
  raw_json jsonb not null default '{}'::jsonb,
  normalized_json jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  first_seen_run_id bigint references game_data_runs(id) on delete set null,
  last_seen_run_id bigint references game_data_runs(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists game_current_entities (
  entity_type text not null,
  entity_key text not null,
  display_name text not null default '',
  source_key text references game_data_sources(source_key) on delete set null,
  source_hash text not null default '',
  raw_json jsonb not null default '{}'::jsonb,
  normalized_json jsonb not null default '{}'::jsonb,
  tags_json jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  first_seen_run_id bigint references game_data_runs(id) on delete set null,
  last_seen_run_id bigint references game_data_runs(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (entity_type, entity_key)
);

create table if not exists game_stats (
  stat_key text primary key,
  text_en text not null default '',
  text_vi text not null default '',
  semantic_key text not null default '',
  value_type text not null default '',
  tags_json jsonb not null default '[]'::jsonb,
  raw_json jsonb not null default '{}'::jsonb,
  normalized_json jsonb not null default '{}'::jsonb,
  source_hash text not null default '',
  status text not null default 'active',
  first_seen_run_id bigint references game_data_runs(id) on delete set null,
  last_seen_run_id bigint references game_data_runs(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists game_mods (
  mod_key text primary key,
  display_name text not null default '',
  domain text not null default '',
  generation_type text not null default '',
  family text not null default '',
  required_level integer,
  max_level integer,
  tags_json jsonb not null default '[]'::jsonb,
  raw_json jsonb not null default '{}'::jsonb,
  normalized_json jsonb not null default '{}'::jsonb,
  source_hash text not null default '',
  status text not null default 'active',
  first_seen_run_id bigint references game_data_runs(id) on delete set null,
  last_seen_run_id bigint references game_data_runs(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists game_mod_stats (
  mod_key text not null references game_mods(mod_key) on delete cascade,
  stat_key text not null references game_stats(stat_key) on delete restrict,
  ordinal integer not null default 0,
  min_value numeric,
  max_value numeric,
  value_json jsonb not null default '{}'::jsonb,
  raw_json jsonb not null default '{}'::jsonb,
  primary key (mod_key, stat_key, ordinal)
);

create table if not exists game_mod_spawn_rules (
  id bigserial primary key,
  mod_key text not null references game_mods(mod_key) on delete cascade,
  domain text not null default 'item',
  target_scope text not null default 'item_class',
  target_key text not null default '',
  item_class text not null default '',
  item_category text not null default '',
  item_type text not null default '',
  min_item_level integer,
  max_item_level integer,
  craft_source text not null default 'natural',
  weight integer,
  required_tags_json jsonb not null default '[]'::jsonb,
  blocked_tags_json jsonb not null default '[]'::jsonb,
  conditions_json jsonb not null default '{}'::jsonb,
  raw_json jsonb not null default '{}'::jsonb,
  source_hash text not null default '',
  status text not null default 'active',
  first_seen_run_id bigint references game_data_runs(id) on delete set null,
  last_seen_run_id bigint references game_data_runs(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (mod_key, domain, target_scope, target_key, craft_source)
);

create table if not exists item_bases (
  base_key text primary key,
  display_name text not null default '',
  item_class text not null default '',
  item_category text not null default '',
  item_type text not null default '',
  weapon_type text not null default '',
  drop_level integer,
  required_level integer,
  width integer,
  height integer,
  tags_json jsonb not null default '[]'::jsonb,
  implicit_mods_json jsonb not null default '[]'::jsonb,
  requirements_json jsonb not null default '{}'::jsonb,
  base_stats_json jsonb not null default '{}'::jsonb,
  raw_json jsonb not null default '{}'::jsonb,
  normalized_json jsonb not null default '{}'::jsonb,
  source_hash text not null default '',
  status text not null default 'active',
  first_seen_run_id bigint references game_data_runs(id) on delete set null,
  last_seen_run_id bigint references game_data_runs(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists craft_item_snapshots (
  snapshot_key text primary key,
  base_key text references item_bases(base_key) on delete set null,
  display_name text not null default '',
  item_class text not null default '',
  item_category text not null default '',
  item_type text not null default '',
  weapon_type text not null default '',
  item_level integer,
  rarity text not null default '',
  quality integer,
  sockets_json jsonb not null default '[]'::jsonb,
  implicits_json jsonb not null default '[]'::jsonb,
  prefixes_count integer not null default 0,
  suffixes_count integer not null default 0,
  physical_dps numeric,
  elemental_dps numeric,
  total_dps numeric,
  attacks_per_second numeric,
  critical_chance numeric,
  base_stats_json jsonb not null default '{}'::jsonb,
  computed_stats_json jsonb not null default '{}'::jsonb,
  raw_json jsonb not null default '{}'::jsonb,
  normalized_json jsonb not null default '{}'::jsonb,
  source_hash text not null default '',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists craft_item_snapshot_mods (
  id bigserial primary key,
  snapshot_key text not null references craft_item_snapshots(snapshot_key) on delete cascade,
  mod_key text references game_mods(mod_key) on delete set null,
  slot text not null default '',
  ordinal integer not null default 0,
  mod_text text not null default '',
  roll_values_json jsonb not null default '{}'::jsonb,
  stats_json jsonb not null default '[]'::jsonb,
  raw_json jsonb not null default '{}'::jsonb,
  source_hash text not null default '',
  created_at timestamptz not null default now(),
  unique (snapshot_key, slot, ordinal)
);

create index if not exists idx_game_data_runs_kind_started
  on game_data_runs(kind, started_at desc);

create index if not exists idx_game_data_sources_active_kind
  on game_data_sources(source_type, updated_at desc)
  where status = 'active';

create index if not exists idx_game_current_entities_active_type_name
  on game_current_entities(entity_type, lower(display_name), entity_key)
  where status = 'active';

create index if not exists idx_game_current_entities_tags_gin
  on game_current_entities using gin(tags_json);

create index if not exists idx_game_current_entities_normalized_gin
  on game_current_entities using gin(normalized_json);

create index if not exists idx_game_stats_active_semantic
  on game_stats(semantic_key, stat_key)
  where status = 'active';

create index if not exists idx_game_stats_tags_gin
  on game_stats using gin(tags_json);

create index if not exists idx_game_mods_active_domain
  on game_mods(domain, generation_type, required_level, mod_key)
  where status = 'active';

create index if not exists idx_game_mods_tags_gin
  on game_mods using gin(tags_json);

create index if not exists idx_game_mod_stats_stat
  on game_mod_stats(stat_key, mod_key);

create index if not exists idx_game_mod_spawn_rules_target
  on game_mod_spawn_rules(domain, target_scope, target_key, item_class, craft_source)
  where status = 'active';

create index if not exists idx_game_mod_spawn_rules_tags_gin
  on game_mod_spawn_rules using gin(required_tags_json);

create index if not exists idx_item_bases_active_class
  on item_bases(item_class, item_category, item_type, lower(display_name))
  where status = 'active';

create index if not exists idx_item_bases_weapon_type
  on item_bases(weapon_type, drop_level, base_key)
  where status = 'active' and item_category = 'weapon';

create index if not exists idx_item_bases_tags_gin
  on item_bases using gin(tags_json);

create index if not exists idx_craft_item_snapshots_base
  on craft_item_snapshots(base_key, item_level, rarity)
  where status = 'active';

create index if not exists idx_craft_item_snapshots_weapon
  on craft_item_snapshots(weapon_type, item_level, total_dps desc, snapshot_key)
  where status = 'active' and item_category = 'weapon';

create index if not exists idx_craft_item_snapshots_computed_gin
  on craft_item_snapshots using gin(computed_stats_json);

create index if not exists idx_craft_item_snapshot_mods_snapshot
  on craft_item_snapshot_mods(snapshot_key, slot, ordinal);

create index if not exists idx_craft_item_snapshot_mods_mod
  on craft_item_snapshot_mods(mod_key);
