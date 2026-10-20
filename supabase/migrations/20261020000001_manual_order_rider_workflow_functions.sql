-- Atomic workflow functions for Smart Feni manual orders.
-- These functions derive identity from auth.uid(); callers must use the user's JWT,
-- never the service-role client for the RPC itself.

create or replace function public.admin_publish_manual_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_order public.manual_orders%rowtype;
begin
  if v_actor is null then raise exception 'লগইন আবশ্যক'; end if;
  select role into v_role from public.profiles where id = v_actor;
  if v_role not in ('admin', 'moderator') then raise exception 'অ্যাডমিন পারমিশন নেই'; end if;

  select * into v_order from public.manual_orders where id = p_order_id for update;
  if not found then raise exception 'অর্ডার পাওয়া যায়নি'; end if;
  if v_order.status <> 'new' then raise exception 'শুধু নতুন অর্ডার প্রকাশ করা যাবে'; end if;
  if v_order.manual_rider_id is not null then raise exception 'রাইডার আগে থেকেই নির্ধারিত'; end if;

  update public.manual_orders set published_at = coalesce(published_at, now()) where id = p_order_id;
  insert into public.manual_order_events(order_id, actor_id, event_type)
    values (p_order_id, v_actor, 'published');

  return jsonb_build_object('success', true, 'order_id', p_order_id);
end;
$$;

create or replace function public.rider_accept_manual_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_rider public.delivery_riders%rowtype;
  v_order public.manual_orders%rowtype;
  v_manual_rider_id uuid;
  v_name text;
  v_phone text;
begin
  if v_actor is null then raise exception 'লগইন আবশ্যক'; end if;

  select * into v_rider
    from public.delivery_riders
    where profile_id = v_actor and verification_status = 'approved'
    for share;
  if not found then raise exception 'অনুমোদিত ডেলিভারি রাইডার হতে হবে'; end if;

  select * into v_order from public.manual_orders where id = p_order_id for update;
  if not found then raise exception 'অর্ডার পাওয়া যায়নি'; end if;
  if v_order.status <> 'new' or v_order.manual_rider_id is not null then
    raise exception 'অর্ডারটি অন্য রাইডার নিয়ে নিয়েছেন বা আর পাওয়া যাচ্ছে না';
  end if;
  if v_order.published_at is null then raise exception 'অর্ডারটি এখনো প্রকাশ করা হয়নি'; end if;

  select full_name, phone into v_name, v_phone from public.profiles where id = v_actor;
  insert into public.manual_riders(name, phone, is_active, profile_id)
    values (coalesce(nullif(trim(v_name), ''), 'Delivery Rider'), v_phone, true, v_actor)
    on conflict (profile_id) where profile_id is not null
    do update set is_active = true
    returning id into v_manual_rider_id;

  update public.manual_orders
     set manual_rider_id = v_manual_rider_id,
         delivery_rider_id = v_actor,
         status = 'rider_assigned',
         accepted_at = now()
   where id = p_order_id;

  insert into public.manual_order_events(order_id, actor_id, event_type)
    values (p_order_id, v_actor, 'accepted');

  return jsonb_build_object('success', true, 'order_id', p_order_id);
end;
$$;

create or replace function public.admin_mark_manual_order_ready(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_order public.manual_orders%rowtype;
begin
  if v_actor is null then raise exception 'লগইন আবশ্যক'; end if;
  select role into v_role from public.profiles where id = v_actor;
  if v_role not in ('admin', 'moderator') then raise exception 'অ্যাডমিন পারমিশন নেই'; end if;

  select * into v_order from public.manual_orders where id = p_order_id for update;
  if not found then raise exception 'অর্ডার পাওয়া যায়নি'; end if;
  if v_order.status not in ('rider_assigned', 'picked_up') then raise exception 'এই স্ট্যাটাসে Ready করা যাবে না'; end if;

  update public.manual_orders set ready_at = coalesce(ready_at, now()) where id = p_order_id;
  insert into public.manual_order_events(order_id, actor_id, event_type)
    values (p_order_id, v_actor, 'ready');
  return jsonb_build_object('success', true, 'order_id', p_order_id);
end;
$$;

create or replace function public.rider_mark_manual_order_picked_up(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.manual_orders%rowtype;
begin
  if v_actor is null then raise exception 'লগইন আবশ্যক'; end if;
  select * into v_order from public.manual_orders where id = p_order_id for update;
  if not found then raise exception 'অর্ডার পাওয়া যায়নি'; end if;
  if v_order.delivery_rider_id is distinct from v_actor then raise exception 'এই অর্ডার আপনার নয়'; end if;
  if v_order.status <> 'rider_assigned' then raise exception 'এই অর্ডার পিকআপ করা যাবে না'; end if;

  update public.manual_orders set status = 'picked_up', picked_up_at = now() where id = p_order_id;
  insert into public.manual_order_events(order_id, actor_id, event_type)
    values (p_order_id, v_actor, 'picked_up');
  return jsonb_build_object('success', true, 'order_id', p_order_id);
end;
$$;

create or replace function public.rider_mark_manual_order_delivered(
  p_order_id uuid,
  p_cash_received numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.manual_orders%rowtype;
begin
  if v_actor is null then raise exception 'লগইন আবশ্যক'; end if;
  if p_cash_received is null or p_cash_received < 0 then raise exception 'সঠিক ক্যাশের পরিমাণ দিন'; end if;
  select * into v_order from public.manual_orders where id = p_order_id for update;
  if not found then raise exception 'অর্ডার পাওয়া যায়নি'; end if;
  if v_order.delivery_rider_id is distinct from v_actor then raise exception 'এই অর্ডার আপনার নয়'; end if;
  if v_order.status <> 'picked_up' then raise exception 'পিকআপের আগে ডেলিভারড করা যাবে না'; end if;

  update public.manual_orders
     set status = 'delivered',
         cash_collected = p_cash_received,
         cash_received_note = nullif(left(trim(coalesce(p_note, '')), 500), ''),
         delivered_at = now()
   where id = p_order_id;
  insert into public.manual_order_events(order_id, actor_id, event_type, details)
    values (p_order_id, v_actor, 'delivered',
      jsonb_build_object('cash_received', p_cash_received, 'note', nullif(left(trim(coalesce(p_note, '')), 500), '')));
  return jsonb_build_object('success', true, 'order_id', p_order_id);
end;
$$;

create or replace function public.admin_raise_manual_order_rider_pay(p_order_id uuid, p_rider_pay numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_order public.manual_orders%rowtype;
begin
  if v_actor is null then raise exception 'লগইন আবশ্যক'; end if;
  select role into v_role from public.profiles where id = v_actor;
  if v_role <> 'admin' then raise exception 'শুধু অ্যাডমিন এই পরিবর্তন করতে পারবেন'; end if;
  if p_rider_pay is null or p_rider_pay < 0 then raise exception 'সঠিক রাইডার পে দিন'; end if;

  select * into v_order from public.manual_orders where id = p_order_id for update;
  if not found then raise exception 'অর্ডার পাওয়া যায়নি'; end if;
  if v_order.status <> 'new' or v_order.manual_rider_id is not null then
    raise exception 'রাইডার অর্ডার নেওয়ার পরে পে পরিবর্তন করা যাবে না';
  end if;
  if p_rider_pay <= coalesce(v_order.rider_pay, 0) then
    raise exception 'রাইডার পে বাড়াতে নতুন পরিমাণ বর্তমান পে-এর চেয়ে বেশি হতে হবে';
  end if;

  update public.manual_orders set rider_pay = p_rider_pay where id = p_order_id;
  insert into public.manual_order_events(order_id, actor_id, event_type, details)
    values (p_order_id, v_actor, 'rider_pay_changed',
      jsonb_build_object('old_rider_pay', v_order.rider_pay, 'new_rider_pay', p_rider_pay));
  return jsonb_build_object('success', true, 'order_id', p_order_id, 'rider_pay', p_rider_pay);
end;
$$;

create or replace function public.admin_cancel_manual_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_order public.manual_orders%rowtype;
begin
  if v_actor is null then raise exception 'লগইন আবশ্যক'; end if;
  select role into v_role from public.profiles where id = v_actor;
  if v_role <> 'admin' then raise exception 'শুধু অ্যাডমিন অর্ডার বাতিল করতে পারবেন'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'বাতিলের কারণ লিখুন'; end if;

  select * into v_order from public.manual_orders where id = p_order_id for update;
  if not found then raise exception 'অর্ডার পাওয়া যায়নি'; end if;
  if v_order.status in ('delivered', 'completed', 'cancelled') then
    raise exception 'ডেলিভারড/সম্পন্ন/বাতিল অর্ডার আবার বাতিল করা যাবে না';
  end if;

  update public.manual_orders
     set status = 'cancelled',
         cancel_reason = left(trim(p_reason), 300),
         cancelled_at = now(),
         cancelled_by = v_actor
   where id = p_order_id;
  insert into public.manual_order_events(order_id, actor_id, event_type, details)
    values (p_order_id, v_actor, 'cancelled',
      jsonb_build_object('reason', left(trim(p_reason), 300), 'delivery_rider_id', v_order.delivery_rider_id));
  return jsonb_build_object('success', true, 'order_id', p_order_id, 'delivery_rider_id', v_order.delivery_rider_id);
end;
$$;

revoke all on function public.admin_publish_manual_order(uuid) from public, anon;
revoke all on function public.rider_accept_manual_order(uuid) from public, anon;
revoke all on function public.admin_mark_manual_order_ready(uuid) from public, anon;
revoke all on function public.rider_mark_manual_order_picked_up(uuid) from public, anon;
revoke all on function public.rider_mark_manual_order_delivered(uuid, numeric, text) from public, anon;
revoke all on function public.admin_raise_manual_order_rider_pay(uuid, numeric) from public, anon;
revoke all on function public.admin_cancel_manual_order(uuid, text) from public, anon;

grant execute on function public.admin_publish_manual_order(uuid) to authenticated;
grant execute on function public.rider_accept_manual_order(uuid) to authenticated;
grant execute on function public.admin_mark_manual_order_ready(uuid) to authenticated;
grant execute on function public.rider_mark_manual_order_picked_up(uuid) to authenticated;
grant execute on function public.rider_mark_manual_order_delivered(uuid, numeric, text) to authenticated;
grant execute on function public.admin_raise_manual_order_rider_pay(uuid, numeric) to authenticated;
grant execute on function public.admin_cancel_manual_order(uuid, text) to authenticated;
