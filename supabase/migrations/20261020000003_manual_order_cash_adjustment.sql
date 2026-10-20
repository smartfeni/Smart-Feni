-- Admin-only correction for cash recorded at delivery, with an immutable audit event.
alter table public.manual_order_events
  drop constraint if exists manual_order_events_event_type_check;
alter table public.manual_order_events
  add constraint manual_order_events_event_type_check
  check (event_type in (
    'published', 'accepted', 'ready', 'picked_up', 'delivered',
    'cancelled', 'rider_pay_changed', 'cash_adjusted'
  ));

create or replace function public.admin_adjust_manual_order_cash(
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
  v_role text;
  v_order public.manual_orders%rowtype;
begin
  if v_actor is null then raise exception 'লগইন আবশ্যক'; end if;
  select role into v_role from public.profiles where id = v_actor;
  if v_role <> 'admin' then raise exception 'শুধু অ্যাডমিন ক্যাশের হিসাব সংশোধন করতে পারবেন'; end if;
  if p_cash_received is null or p_cash_received < 0 then raise exception 'সঠিক ক্যাশের পরিমাণ দিন'; end if;

  select * into v_order from public.manual_orders where id = p_order_id for update;
  if not found then raise exception 'অর্ডার পাওয়া যায়নি'; end if;
  if v_order.status not in ('delivered', 'completed') then raise exception 'শুধু ডেলিভারড অর্ডারের ক্যাশ সংশোধন করা যাবে'; end if;

  update public.manual_orders
    set cash_collected = p_cash_received,
        cash_received_note = coalesce(nullif(left(trim(coalesce(p_note, '')), 500), ''), cash_received_note)
    where id = p_order_id;

  insert into public.manual_order_events(order_id, actor_id, event_type, details)
    values (p_order_id, v_actor, 'cash_adjusted',
      jsonb_build_object(
        'old_cash_received', v_order.cash_collected,
        'new_cash_received', p_cash_received,
        'note', nullif(left(trim(coalesce(p_note, '')), 500), '')
      ));

  return jsonb_build_object('success', true, 'order_id', p_order_id, 'cash_received', p_cash_received);
end;
$$;

revoke all on function public.admin_adjust_manual_order_cash(uuid, numeric, text) from public, anon;
grant execute on function public.admin_adjust_manual_order_cash(uuid, numeric, text) to authenticated;
