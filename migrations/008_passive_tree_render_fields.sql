alter table passive_tree_versions
  add column if not exists groups_json jsonb not null default '[]'::jsonb;

alter table passive_tree_versions
  add column if not exists constants_json jsonb not null default '{}'::jsonb;

alter table passive_tree_nodes
  add column if not exists arc numeric not null default 0;

alter table passive_tree_nodes
  add column if not exists icon_path text not null default '';

alter table passive_tree_nodes
  add column if not exists is_ascendancy_start boolean not null default false;

alter table passive_tree_nodes
  add column if not exists is_mastery boolean not null default false;
