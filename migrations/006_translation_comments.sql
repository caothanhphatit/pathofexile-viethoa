create table if not exists translation_comments (
  id bigserial primary key,
  entity_type text not null check (entity_type in ('skill_gem', 'currency', 'dictionary')),
  entity_id text not null,
  entity_name text not null,
  field_path text not null default 'summary',
  source_text text not null default '',
  translated_text text not null default '',
  body text not null check (length(trim(body)) > 0),
  user_id text not null references users(id) on delete cascade,
  status text not null default 'visible' check (status in ('visible', 'hidden', 'deleted')),
  page_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_translation_comments_entity_created
  on translation_comments(entity_type, entity_id, created_at desc)
  where status = 'visible';

create index if not exists idx_translation_comments_user_created
  on translation_comments(user_id, created_at desc);
