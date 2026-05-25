alter table translation_comments
  drop constraint if exists translation_comments_entity_type_check;

alter table translation_comments
  add constraint translation_comments_entity_type_check
  check (entity_type in ('skill_gem', 'currency', 'dictionary', 'passive_tree_node'));

create table if not exists passive_tree_versions (
  id bigserial primary key,
  tree_version text not null,
  tree_name text not null default 'Default',
  source_ref text not null,
  source_path text not null,
  source_url text not null,
  source_hash text not null unique,
  class_count integer not null default 0,
  group_count integer not null default 0,
  node_count integer not null default 0,
  edge_count integer not null default 0,
  bounds_json jsonb not null default '{}'::jsonb,
  classes_json jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  crawl_run_id bigint references crawl_runs(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists passive_tree_nodes (
  node_id text primary key,
  tree_version text not null,
  name text not null,
  type text not null,
  group_id text not null default '',
  orbit integer not null default 0,
  orbit_index integer not null default 0,
  x numeric not null default 0,
  y numeric not null default 0,
  icon text not null default '',
  ascendancy_name text not null default '',
  stats_json jsonb not null default '[]'::jsonb,
  recipe_json jsonb not null default '[]'::jsonb,
  raw_json jsonb not null default '{}'::jsonb,
  source_hash text not null,
  status text not null default 'active',
  first_seen_run_id bigint references crawl_runs(id),
  last_seen_run_id bigint references crawl_runs(id),
  updated_at timestamptz not null default now()
);

create table if not exists passive_tree_edges (
  from_node_id text not null,
  to_node_id text not null,
  tree_version text not null,
  orbit integer not null default 0,
  status text not null default 'active',
  first_seen_run_id bigint references crawl_runs(id),
  last_seen_run_id bigint references crawl_runs(id),
  updated_at timestamptz not null default now(),
  primary key (from_node_id, to_node_id)
);

create table if not exists passive_tree_node_versions (
  id bigserial primary key,
  node_id text not null references passive_tree_nodes(node_id) on delete cascade,
  previous_hash text not null,
  next_hash text not null,
  previous_json jsonb not null,
  next_json jsonb not null,
  run_id bigint references crawl_runs(id),
  changed_at timestamptz not null default now()
);

create index if not exists idx_passive_tree_versions_active
  on passive_tree_versions(tree_version, created_at desc)
  where status = 'active';

create index if not exists idx_passive_tree_nodes_active_type
  on passive_tree_nodes(type, name)
  where status = 'active';

create index if not exists idx_passive_tree_nodes_ascendancy
  on passive_tree_nodes(ascendancy_name, type)
  where status = 'active';

create index if not exists idx_passive_tree_nodes_stats_gin
  on passive_tree_nodes using gin(stats_json);

create index if not exists idx_passive_tree_edges_from
  on passive_tree_edges(from_node_id)
  where status = 'active';

create index if not exists idx_passive_tree_edges_to
  on passive_tree_edges(to_node_id)
  where status = 'active';
