-- Approved riders can see customer details on published offers before accepting.
create or replace function public.get_manual_order_rider_feed()
returns table (
  order_id uuid, order_no text, status text, scheduled_at timestamptz,
  is_asap boolean, is_strict_time boolean, pickup_name text, pickup_map_link text,
  details text, delivery_fee numeric, rider_pay numeric, customer_name text,
  customer_phone text, drop_address text, drop_map_link text, cod_amount numeric,
  ready_at timestamptz, delivery_rider_id uuid
)
language plpgsql security definer set search_path = public
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'লগইন আবশ্যক'; end if;
  if not exists (select 1 from public.delivery_riders where profile_id = v_actor and verification_status = 'approved') then
    raise exception 'অনুমোদিত ডেলিভারি রাইডার হতে হবে';
  end if;
  return query
  select o.id, o.order_no, o.status, o.scheduled_at, o.is_asap, o.is_strict_time,
    o.pickup_name, o.pickup_map_link, o.details, o.delivery_fee, o.rider_pay,
    o.customer_name, o.customer_phone, o.drop_address, o.drop_map_link, o.cod_amount,
    o.ready_at, o.delivery_rider_id
  from public.manual_orders o
  where (o.status = 'new' and o.published_at is not null and o.manual_rider_id is null)
     or (o.delivery_rider_id = v_actor and o.status in ('rider_assigned', 'picked_up'))
  order by case when o.delivery_rider_id = v_actor then 0 else 1 end, o.scheduled_at asc;
end;
$$;
revoke all on function public.get_manual_order_rider_feed() from public, anon;
grant execute on function public.get_manual_order_rider_feed() to authenticated;
