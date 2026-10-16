-- Referral leaderboard: rank users only by lifetime successful referrals.
-- Each counted referral is worth 100 referral points; listing points and withdrawals
-- are intentionally excluded. This migration must be applied to the Supabase project.

create or replace function public.get_referral_leaderboard()
returns table (
  rank integer,
  user_id uuid,
  full_name text,
  avatar_url text,
  counted_referrals bigint,
  referral_points bigint,
  is_me boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with referral_totals as (
    select
      r.referrer_id as user_id,
      count(*)::bigint as counted_referrals
    from public.referrals r
    where r.status = 'counted'
      and r.referrer_id is not null
    group by r.referrer_id
  ),
  ranked as (
    select
      p.id as user_id,
      coalesce(nullif(trim(p.full_name), ''), 'স্মার্ট ফেনী ইউজার')::text as full_name,
      p.avatar_url::text as avatar_url,
      rt.counted_referrals,
      (rt.counted_referrals * 100)::bigint as referral_points,
      row_number() over (
        order by rt.counted_referrals desc, p.id asc
      )::integer as leaderboard_rank
    from referral_totals rt
    join public.profiles p on p.id = rt.user_id
  )
  select
    r.leaderboard_rank as rank,
    r.user_id,
    r.full_name,
    r.avatar_url,
    r.counted_referrals,
    r.referral_points,
    (r.user_id = auth.uid()) as is_me
  from ranked r
  where r.leaderboard_rank <= 10
     or r.user_id = auth.uid()
  order by r.leaderboard_rank;
$$;

revoke all on function public.get_referral_leaderboard() from public;
revoke all on function public.get_referral_leaderboard() from anon;
grant execute on function public.get_referral_leaderboard() to authenticated;
