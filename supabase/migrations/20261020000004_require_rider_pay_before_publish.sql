-- Publishing requires a separately configured positive rider payout.
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
  if coalesce(v_order.rider_pay, 0) <= 0 then raise exception 'প্রকাশের আগে রাইডারের পে নির্ধারণ করুন'; end if;

  update public.manual_orders set published_at = coalesce(published_at, now()) where id = p_order_id;
  insert into public.manual_order_events(order_id, actor_id, event_type)
    values (p_order_id, v_actor, 'published');

  return jsonb_build_object('success', true, 'order_id', p_order_id);
end;
$$;
revoke all on function public.admin_publish_manual_order(uuid) from public, anon;
grant execute on function public.admin_publish_manual_order(uuid) to authenticated;
