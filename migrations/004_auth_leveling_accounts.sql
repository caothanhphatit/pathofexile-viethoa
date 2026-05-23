create table if not exists users (
  id text primary key,
  email text unique,
  display_name text not null default '',
  avatar_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth_accounts (
  id bigserial primary key,
  user_id text not null references users(id) on delete cascade,
  provider text not null,
  provider_user_id text not null,
  email text,
  display_name text not null default '',
  avatar_url text not null default '',
  profile_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_user_id)
);

create table if not exists user_sessions (
  session_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  user_agent text not null default '',
  ip_address text not null default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists leveling_characters (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  class_name text not null default '',
  level integer,
  source text not null default 'manual',
  poe_character_id text,
  log_path text not null default '',
  log_start_offset bigint not null default 0,
  last_selected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists leveling_character_progress (
  character_id text not null references leveling_characters(id) on delete cascade,
  task_id text not null,
  completed boolean not null default true,
  source text not null default 'manual',
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (character_id, task_id)
);

create table if not exists leveling_log_cursors (
  character_id text primary key references leveling_characters(id) on delete cascade,
  log_path text not null default '',
  byte_offset bigint not null default 0,
  file_size bigint not null default 0,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_auth_accounts_user_provider on auth_accounts(user_id, provider);
create index if not exists idx_user_sessions_user_expires on user_sessions(user_id, expires_at desc);
create index if not exists idx_leveling_characters_user_selected on leveling_characters(user_id, last_selected_at desc nulls last, updated_at desc);
create index if not exists idx_leveling_progress_character_done on leveling_character_progress(character_id, completed);
