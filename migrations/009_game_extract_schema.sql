create table if not exists game_extract_versions (
  id bigserial primary key,
  version_key text not null unique,
  source_kind text not null,
  source_label text not null default '',
  game_path text not null default '',
  ggpk_path text not null default '',
  pob_path text not null default '',
  pob_commit text not null default '',
  source_hash text not null,
  extract_hash text not null,
  status text not null default 'completed',
  metadata_json jsonb not null default '{}'::jsonb,
  summary_json jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists game_dat_tables (
  id bigserial primary key,
  extract_version_id bigint not null references game_extract_versions(id) on delete cascade,
  table_name text not null,
  source_path text not null default '',
  source_kind text not null default '',
  column_count integer not null default 0,
  row_count integer not null default 0,
  table_hash text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (extract_version_id, table_name)
);

create table if not exists game_dat_columns (
  id bigserial primary key,
  extract_version_id bigint not null references game_extract_versions(id) on delete cascade,
  table_name text not null,
  column_name text not null,
  ordinal integer not null default 0,
  type_hint text not null default '',
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (extract_version_id, table_name, column_name)
);

create table if not exists game_dat_rows (
  id bigserial primary key,
  extract_version_id bigint not null references game_extract_versions(id) on delete cascade,
  table_name text not null,
  row_key text not null,
  row_index integer not null default 0,
  source_path text not null default '',
  raw_json jsonb not null,
  row_hash text not null,
  created_at timestamptz not null default now(),
  unique (extract_version_id, table_name, row_key)
);

create table if not exists game_entities (
  id bigserial primary key,
  extract_version_id bigint not null references game_extract_versions(id) on delete cascade,
  entity_type text not null,
  entity_key text not null,
  display_name text not null default '',
  source_table text not null default '',
  source_row_key text not null default '',
  raw_json jsonb not null default '{}'::jsonb,
  normalized_json jsonb not null default '{}'::jsonb,
  source_hash text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (extract_version_id, entity_type, entity_key)
);

create table if not exists game_entity_relations (
  id bigserial primary key,
  extract_version_id bigint not null references game_extract_versions(id) on delete cascade,
  from_entity_type text not null,
  from_entity_key text not null,
  relation_type text not null,
  to_entity_type text not null,
  to_entity_key text not null,
  relation_json jsonb not null default '{}'::jsonb,
  relation_hash text not null,
  created_at timestamptz not null default now(),
  unique (
    extract_version_id,
    from_entity_type,
    from_entity_key,
    relation_type,
    to_entity_type,
    to_entity_key
  )
);

create table if not exists game_assets (
  id bigserial primary key,
  extract_version_id bigint not null references game_extract_versions(id) on delete cascade,
  asset_key text not null,
  kind text not null,
  logical_path text not null,
  source_path text not null default '',
  local_path text not null default '',
  byte_size bigint not null default 0,
  content_hash text not null default '',
  metadata_json jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (extract_version_id, asset_key)
);

create table if not exists game_entity_assets (
  id bigserial primary key,
  extract_version_id bigint not null references game_extract_versions(id) on delete cascade,
  entity_type text not null,
  entity_key text not null,
  asset_key text not null,
  relation_type text not null default 'uses_asset',
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (extract_version_id, entity_type, entity_key, asset_key, relation_type)
);

create table if not exists game_extract_diffs (
  id bigserial primary key,
  from_extract_version_id bigint references game_extract_versions(id) on delete set null,
  to_extract_version_id bigint references game_extract_versions(id) on delete set null,
  diff_hash text not null unique,
  summary_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists game_dat_row_diffs (
  id bigserial primary key,
  diff_id bigint not null references game_extract_diffs(id) on delete cascade,
  table_name text not null,
  row_key text not null,
  change_type text not null,
  previous_hash text not null default '',
  next_hash text not null default '',
  previous_json jsonb not null default '{}'::jsonb,
  next_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists game_entity_diffs (
  id bigserial primary key,
  diff_id bigint not null references game_extract_diffs(id) on delete cascade,
  entity_type text not null,
  entity_key text not null,
  change_type text not null,
  previous_hash text not null default '',
  next_hash text not null default '',
  previous_json jsonb not null default '{}'::jsonb,
  next_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists game_relation_diffs (
  id bigserial primary key,
  diff_id bigint not null references game_extract_diffs(id) on delete cascade,
  relation_key text not null,
  change_type text not null,
  previous_hash text not null default '',
  next_hash text not null default '',
  previous_json jsonb not null default '{}'::jsonb,
  next_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists game_asset_diffs (
  id bigserial primary key,
  diff_id bigint not null references game_extract_diffs(id) on delete cascade,
  asset_key text not null,
  change_type text not null,
  previous_hash text not null default '',
  next_hash text not null default '',
  previous_json jsonb not null default '{}'::jsonb,
  next_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists game_extractor_failures (
  id bigserial primary key,
  extract_version_id bigint references game_extract_versions(id) on delete cascade,
  stage text not null,
  source_path text not null default '',
  table_name text not null default '',
  entity_key text not null default '',
  message text not null,
  details_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_game_extract_versions_created
  on game_extract_versions(created_at desc);

create index if not exists idx_game_dat_rows_table_key
  on game_dat_rows(extract_version_id, table_name, row_key);

create index if not exists idx_game_dat_rows_payload_gin
  on game_dat_rows using gin(raw_json);

create index if not exists idx_game_entities_type_key
  on game_entities(entity_type, entity_key, extract_version_id);

create index if not exists idx_game_entities_normalized_gin
  on game_entities using gin(normalized_json);

create index if not exists idx_game_entity_relations_from
  on game_entity_relations(from_entity_type, from_entity_key, relation_type);

create index if not exists idx_game_entity_relations_to
  on game_entity_relations(to_entity_type, to_entity_key, relation_type);

create index if not exists idx_game_assets_kind_hash
  on game_assets(kind, content_hash);

create index if not exists idx_game_entity_assets_entity
  on game_entity_assets(entity_type, entity_key);

create index if not exists idx_game_extractor_failures_version
  on game_extractor_failures(extract_version_id, stage);
