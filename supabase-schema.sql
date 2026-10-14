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
