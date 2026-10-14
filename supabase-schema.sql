create table if not exists public.winterfreeze_expenses (
  id uuid primary key default gen_random_uuid(),
  description text not null check (char_length(trim(description)) between 1 and 120),
  category text not null check (category in ('Dépôt', 'Activité', 'Boisson', 'Chalet', 'Collation', 'Divers', 'Gaz', 'Repas')),
  amount numeric(10, 2) not null check (amount > 0),
  payer text not null check (payer in ('Pat', 'Jop', 'Luc', 'Steve', 'Mike', 'Simon', 'Mathieu', 'Pierre')),
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists winterfreeze_expenses_created_at_idx
  on public.winterfreeze_expenses (created_at desc);

alter table public.winterfreeze_expenses enable row level security;
alter table public.winterfreeze_expenses force row level security;

revoke all on table public.winterfreeze_expenses from anon, authenticated;
grant select, insert, delete on table public.winterfreeze_expenses to authenticated;

drop policy if exists "Participants can read Winterfreeze expenses" on public.winterfreeze_expenses;
create policy "Participants can read Winterfreeze expenses"
  on public.winterfreeze_expenses for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Participants can add Winterfreeze expenses" on public.winterfreeze_expenses;
create policy "Participants can add Winterfreeze expenses"
  on public.winterfreeze_expenses for insert to authenticated
  with check (auth.uid() = created_by);

drop policy if exists "Creators can delete their Winterfreeze expenses" on public.winterfreeze_expenses;
create policy "Creators can delete their Winterfreeze expenses"
  on public.winterfreeze_expenses for delete to authenticated
  using (auth.uid() = created_by);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'winterfreeze_expenses'
  ) then
    alter publication supabase_realtime add table public.winterfreeze_expenses;
  end if;
end
$$;

create table if not exists public.winterfreeze_checklist_items (
  id uuid primary key default gen_random_uuid(),
  list_key text not null check (list_key in ('depart', 'epicerie', 'equipement', 'box')),
  group_name text not null default '',
  label text not null check (char_length(trim(label)) between 1 and 180),
  quantity text not null default '',
  detail text not null default '',
  status text not null default '',
  sort_order integer not null default 0,
  seed_key text unique,
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists winterfreeze_checklist_items_order_idx
  on public.winterfreeze_checklist_items (list_key, group_name, sort_order, created_at);

create table if not exists public.winterfreeze_checklist_checks (
  item_id uuid primary key references public.winterfreeze_checklist_items(id) on delete cascade,
  checked boolean not null default false,
  updated_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  updated_at timestamptz not null default now()
);

create table if not exists public.winterfreeze_list_seed_status (
  id boolean primary key default true check (id),
  completed boolean not null default false
);

insert into public.winterfreeze_list_seed_status (id, completed)
values (true, false)
on conflict (id) do nothing;

alter table public.winterfreeze_checklist_items enable row level security;
alter table public.winterfreeze_checklist_items force row level security;
alter table public.winterfreeze_checklist_checks enable row level security;
alter table public.winterfreeze_checklist_checks force row level security;
alter table public.winterfreeze_list_seed_status enable row level security;
alter table public.winterfreeze_list_seed_status force row level security;

revoke all on table public.winterfreeze_checklist_items, public.winterfreeze_checklist_checks, public.winterfreeze_list_seed_status from anon, authenticated;
grant select, insert, update, delete on table public.winterfreeze_checklist_items, public.winterfreeze_checklist_checks to authenticated;

drop policy if exists "Participants can read Winterfreeze checklist items" on public.winterfreeze_checklist_items;
create policy "Participants can read Winterfreeze checklist items"
  on public.winterfreeze_checklist_items for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Participants can add Winterfreeze checklist items" on public.winterfreeze_checklist_items;
create policy "Participants can add Winterfreeze checklist items"
  on public.winterfreeze_checklist_items for insert to authenticated
  with check (auth.uid() = created_by);

drop policy if exists "Participants can edit Winterfreeze checklist items" on public.winterfreeze_checklist_items;
create policy "Participants can edit Winterfreeze checklist items"
  on public.winterfreeze_checklist_items for update to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "Participants can delete Winterfreeze checklist items" on public.winterfreeze_checklist_items;
create policy "Participants can delete Winterfreeze checklist items"
  on public.winterfreeze_checklist_items for delete to authenticated
  using (auth.uid() is not null);

drop policy if exists "Participants can read Winterfreeze checklist checks" on public.winterfreeze_checklist_checks;
create policy "Participants can read Winterfreeze checklist checks"
  on public.winterfreeze_checklist_checks for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Participants can set Winterfreeze checklist checks" on public.winterfreeze_checklist_checks;
create policy "Participants can set Winterfreeze checklist checks"
  on public.winterfreeze_checklist_checks for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() = updated_by);

drop function if exists public.seed_winterfreeze_checklists(jsonb, text[]);

create function public.seed_winterfreeze_checklists(
  p_items jsonb,
  p_checked_seed_keys text[] default '{}'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  seed_completed boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Checklist seed must be a JSON array';
  end if;

  select completed into seed_completed
  from public.winterfreeze_list_seed_status
  where id = true
  for update;

  if seed_completed then
    return false;
  end if;

  insert into public.winterfreeze_checklist_items
    (list_key, group_name, label, quantity, detail, status, sort_order, seed_key, created_by)
  select
    item.list_key,
    coalesce(item.group_name, ''),
    item.label,
    coalesce(item.quantity, ''),
    coalesce(item.detail, ''),
    coalesce(item.status, ''),
    item.sort_order,
    item.seed_key,
    auth.uid()
  from jsonb_to_recordset(p_items) as item(
    list_key text,
    group_name text,
    label text,
    quantity text,
    detail text,
    status text,
    sort_order integer,
    seed_key text
  )
  on conflict (seed_key) do nothing;

  insert into public.winterfreeze_checklist_checks (item_id, checked, updated_by)
  select id, true, auth.uid()
  from public.winterfreeze_checklist_items
  where seed_key = any(coalesce(p_checked_seed_keys, '{}'))
  on conflict (item_id) do nothing;

  update public.winterfreeze_list_seed_status
  set completed = true
  where id = true;
  return true;
end
$$;

revoke all on function public.seed_winterfreeze_checklists(jsonb, text[]) from public, anon;
grant execute on function public.seed_winterfreeze_checklists(jsonb, text[]) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'winterfreeze_checklist_items'
  ) then
    alter publication supabase_realtime add table public.winterfreeze_checklist_items;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'winterfreeze_checklist_checks'
  ) then
    alter publication supabase_realtime add table public.winterfreeze_checklist_checks;
  end if;
end
$$;
