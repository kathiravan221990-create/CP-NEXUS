-- ACCESS MODE for Gateway of CP  (NOT RUN - for approval only)
-- Stores one setting in public.nexus_settings: key 'access_mode', value '1' | '2' | '3'
--   1 = Gateway only (default)   2 = Gateway + CP WORKSPACE + CP NEXUS   3 = everything opens
-- Uses the same pattern as nexus_set_ip_security. No existing function or table is changed.

insert into public.nexus_settings (key, value, updated_by, updated_at)
values ('access_mode', '1', 'setup', now())
on conflict (key) do nothing;

-- Read (Administrators / Managers only, from the Gateway panel)
create or replace function public.nexus_admin_get_access_mode(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public','extensions' as $$
declare u public.nexus_users; v text;
begin
  u := public._nexus_user_for_token(p_token);
  if u.user_id is null or not exists (select 1 from public.nexus_roles r where r.role_id = u.role_id and r.is_admin) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  select value into v from public.nexus_settings where key = 'access_mode';
  return jsonb_build_object('ok', true, 'mode', coalesce(v, '1'));
end $$;

-- Change (Super administrator only)
create or replace function public.nexus_admin_set_access_mode(p_token text, p_mode text)
returns jsonb language plpgsql security definer set search_path to 'public','extensions' as $$
declare u public.nexus_users;
begin
  u := public._nexus_user_for_token(p_token);
  if u.user_id is null or not exists (select 1 from public.nexus_roles r where r.role_id = u.role_id and r.is_super) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if p_mode not in ('1','2','3') then return jsonb_build_object('ok', false, 'error', 'bad_mode'); end if;
  insert into public.nexus_settings (key, value, updated_by, updated_at)
  values ('access_mode', p_mode, u.username, now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true, 'mode', p_mode);
end $$;

-- Public read for the apps (CP WORKSPACE, CP NEXUS, each app) so they know which mode is on.
create or replace function public.get_access_mode()
returns text language sql security definer set search_path to 'public' as $$
  select coalesce((select value from public.nexus_settings where key = 'access_mode'), '1');
$$;
grant execute on function public.get_access_mode() to anon, authenticated;
grant execute on function public.nexus_admin_get_access_mode(text), public.nexus_admin_set_access_mode(text, text) to anon, authenticated;
