-- vlaam Finance v2 — Supabase schema + RLS
-- Chạy TOÀN BỘ file này một lần trong Supabase Dashboard → SQL Editor.
-- Sau đó điền Project URL + Publishable Key vào supabase-config.js.

begin;

create table if not exists public.settings (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  auto_save_enabled boolean not null default true,
  auto_save_amount numeric(14,2) not null default 1000000 check (auto_save_amount >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 30),
  icon text not null default '•',
  type text not null check (type in ('income','expense')),
  budget numeric(14,2) check (budget is null or budget >= 0),
  created_at timestamptz not null default now()
);

create unique index if not exists categories_user_type_name_uq
  on public.categories (user_id, type, lower(name));
create index if not exists categories_user_id_idx on public.categories(user_id);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  transaction_date date not null default current_date,
  description text not null check (char_length(description) between 1 and 120),
  category_id uuid references public.categories(id) on delete set null,
  type text not null check (type in ('income','expense')),
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists transactions_user_id_idx on public.transactions(user_id);
create index if not exists transactions_user_date_idx on public.transactions(user_id, transaction_date desc);
create index if not exists transactions_category_id_idx on public.transactions(category_id);

create table if not exists public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 80),
  target numeric(14,2) not null check (target > 0),
  current numeric(14,2) not null default 0 check (current >= 0),
  deadline date,
  icon text not null default '🌱',
  created_at timestamptz not null default now(),
  constraint savings_current_not_over_target check (current <= target)
);

create index if not exists savings_goals_user_id_idx on public.savings_goals(user_id);

-- RLS: mỗi tài khoản chỉ đọc/ghi dữ liệu của chính mình.
alter table public.settings enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.savings_goals enable row level security;

-- Không cho người chưa đăng nhập truy cập các bảng tài chính.
revoke all on table public.settings from anon;
revoke all on table public.categories from anon;
revoke all on table public.transactions from anon;
revoke all on table public.savings_goals from anon;

grant select, insert, update, delete on table public.settings to authenticated;
grant select, insert, update, delete on table public.categories to authenticated;
grant select, insert, update, delete on table public.transactions to authenticated;
grant select, insert, update, delete on table public.savings_goals to authenticated;

-- Xóa policy cũ nếu chạy lại file.
drop policy if exists "settings_select_own" on public.settings;
drop policy if exists "settings_insert_own" on public.settings;
drop policy if exists "settings_update_own" on public.settings;
drop policy if exists "settings_delete_own" on public.settings;

drop policy if exists "categories_select_own" on public.categories;
drop policy if exists "categories_insert_own" on public.categories;
drop policy if exists "categories_update_own" on public.categories;
drop policy if exists "categories_delete_own" on public.categories;

drop policy if exists "transactions_select_own" on public.transactions;
drop policy if exists "transactions_insert_own" on public.transactions;
drop policy if exists "transactions_update_own" on public.transactions;
drop policy if exists "transactions_delete_own" on public.transactions;

drop policy if exists "savings_select_own" on public.savings_goals;
drop policy if exists "savings_insert_own" on public.savings_goals;
drop policy if exists "savings_update_own" on public.savings_goals;
drop policy if exists "savings_delete_own" on public.savings_goals;

create policy "settings_select_own" on public.settings for select to authenticated using ((select auth.uid()) = user_id);
create policy "settings_insert_own" on public.settings for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "settings_update_own" on public.settings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "settings_delete_own" on public.settings for delete to authenticated using ((select auth.uid()) = user_id);

create policy "categories_select_own" on public.categories for select to authenticated using ((select auth.uid()) = user_id);
create policy "categories_insert_own" on public.categories for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "categories_update_own" on public.categories for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "categories_delete_own" on public.categories for delete to authenticated using ((select auth.uid()) = user_id);

create policy "transactions_select_own" on public.transactions for select to authenticated using ((select auth.uid()) = user_id);
create policy "transactions_insert_own" on public.transactions for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and (category_id is null or exists (select 1 from public.categories c where c.id = category_id and c.user_id = (select auth.uid())))
);
create policy "transactions_update_own" on public.transactions for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and (category_id is null or exists (select 1 from public.categories c where c.id = category_id and c.user_id = (select auth.uid())))
);
create policy "transactions_delete_own" on public.transactions for delete to authenticated using ((select auth.uid()) = user_id);

create policy "savings_select_own" on public.savings_goals for select to authenticated using ((select auth.uid()) = user_id);
create policy "savings_insert_own" on public.savings_goals for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "savings_update_own" on public.savings_goals for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "savings_delete_own" on public.savings_goals for delete to authenticated using ((select auth.uid()) = user_id);

-- DELETE realtime cần old row đầy đủ để client nhận thay đổi ổn định.
alter table public.settings replica identity full;
alter table public.categories replica identity full;
alter table public.transactions replica identity full;
alter table public.savings_goals replica identity full;

commit;

-- Bật Postgres Changes cho 4 bảng mà không xóa publication hiện có.
do $$
declare
  t text;
begin
  foreach t in array array['settings','categories','transactions','savings_goals']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
