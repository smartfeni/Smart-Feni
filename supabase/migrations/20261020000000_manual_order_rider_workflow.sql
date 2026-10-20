-- Smart Feni manual-order rider workflow.
-- Idempotent schema migration; apply through the project's Supabase SQL/migration process.
begin;

alter table public.manual_riders
  add column if not exists profile_id uuid references public.profiles(id) on delete set null;

create unique index if not exists manual_riders_profile_id_uidx
  on public.manual_riders(profile_id)
  where profile_id is not null;

alter table public.manual_orders
  add column if not exists published_at timestamptz,
  add column if not exists delivery_rider_id uuid references public.profiles(id) on delete set null,
  add column if not exists accepted_at timestamptz,
  add column if not exists ready_at timestamptz,
  add column if not exists picked_up_at timestamptz,
  add column if not exists cash_received_note text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null;

create index if not exists manual_orders_open_published_idx
  on public.manual_orders(published_at, scheduled_at)
  where published_at is not null and manual_rider_id is null and status = 'new';

create index if not exists manual_orders_delivery_rider_idx
  on public.manual_orders(delivery_rider_id, status);

create table if not exists public.manual_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.manual_orders(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in (
    'published', 'accepted', 'ready', 'picked_up', 'delivered',
    'cancelled', 'rider_pay_changed'
  )),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists manual_order_events_order_created_idx
  on public.manual_order_events(order_id, created_at desc);

alter table public.manual_order_events enable row level security;

comment on column public.manual_orders.published_at is
  'When this manual order was published to approved delivery riders, online or offline.';
comment on column public.manual_orders.delivery_rider_id is
  'Authenticated Smart Feni delivery-rider profile that accepted the manual order.';
comment on column public.manual_orders.cash_received_note is
  'Optional rider note submitted with the cash-received confirmation.';

commit;
