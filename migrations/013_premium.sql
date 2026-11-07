-- Premium: a paid period on a web account, one key per account for client apps,
-- and the single device each key is bound to.

create table if not exists premium_subscriptions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  plan text not null check (plan in ('month', 'year', 'lifetime', 'custom')),
  starts_at timestamptz not null default now(),
  -- null = never expires (lifetime)
  expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'revoked')),
  source text not null default 'admin',
  note text not null default '',
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists premium_subscriptions_user_idx
  on premium_subscriptions (user_id, status, expires_at);

create table if not exists premium_keys (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  -- sha256 of the full key; the key itself is shown to the user once
  key_hash text not null unique,
  -- first characters, enough to recognise the key in the UI
  key_prefix text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- At most one usable key per account.
create unique index if not exists premium_keys_one_active_per_user
  on premium_keys (user_id) where revoked_at is null;

create table if not exists premium_key_devices (
  id text primary key,
  key_id text not null references premium_keys(id) on delete cascade,
  -- sha256 of the device id the client sends; never stored in clear
  device_hash text not null,
  device_label text not null default '',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_ip text not null default '',
  released_at timestamptz
);

-- A key is bound to a single device at a time.
create unique index if not exists premium_key_devices_one_active_per_key
  on premium_key_devices (key_id) where released_at is null;

create index if not exists premium_key_devices_key_idx
  on premium_key_devices (key_id, released_at);
