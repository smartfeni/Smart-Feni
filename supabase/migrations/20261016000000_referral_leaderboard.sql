-- Referral leaderboard: rank users by points earned from referrals + approved listings.
-- Withdrawals are excluded (they never reduce rank). Shows only name, photo, points.
-- Applied to Supabase as migration "referral_leaderboard_points".

create or replace function public.get_referral_leaderboard()
returns table (
  rank integer,
  user_id uuid,
  full_name text,
  avatar_url text,
  points bigint,
  is_me boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with totals as (
    select l.user_id, sum(l.points)::bigint as pts
    from public.points_ledger l
    where l.type in ('referral', 'listing_approved')
    group by l.user_id
    having sum(l.points) > 0
  ),
  ranked as (
    select
      p.id as user_id,
      coalesce(nullif(trim(p.full_name), ''), 'স্মার্ট ফেনী ইউজার')::text as full_name,
      p.avatar_url::text as avatar_url,
      t.pts as points,
      row_number() over (order by t.pts desc, p.id asc)::integer as lb_rank
    from totals t
    join public.profiles p on p.id = t.user_id
  )
  select r.lb_rank, r.user_id, r.full_name, r.avatar_url, r.points, (r.user_id = auth.uid())
  from ranked r
  where r.lb_rank <= 10 or r.user_id = auth.uid()
  order by r.lb_rank;
$$;

revoke all on function public.get_referral_leaderboard() from public;
revoke all on function public.get_referral_leaderboard() from anon;
grant execute on function public.get_referral_leaderboard() to authenticated;
