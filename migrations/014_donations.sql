-- Donations: one transfer code per donation, so an incoming bank transfer can be matched
-- to the person who made it. Tiers shown on the site are computed from these rows.

create table if not exists donation_intents (
  id text primary key,
  -- Transfer content the donor types / the QR carries: POE + 6 characters.
  code text not null unique,
  -- Signed-in donor; null for an anonymous donation.
  user_id text references users(id) on delete set null,
  display_name text not null default '',
  message text not null default '',
  amount_expected bigint not null check (amount_expected > 0),
  hide_amount boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  -- What the bank reported; a donation has no fixed price, so this may differ from amount_expected.
  amount_paid bigint,
  paid_at timestamptz,
  payment_id text,
  -- Set by the owner to take an abusive name or message off the wall.
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists donation_intents_paid_idx
  on donation_intents (status, paid_at desc);

create index if not exists donation_intents_user_idx
  on donation_intents (user_id, status);

-- Every incoming transfer the payment service reported, matched or not. The primary key
-- makes a retried webhook harmless.
create table if not exists donation_payments (
  payment_id text primary key,
  code text not null default '',
  amount bigint not null,
  content text not null default '',
  intent_id text references donation_intents(id) on delete set null,
  received_at timestamptz not null default now()
);
