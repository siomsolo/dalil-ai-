create extension if not exists pgcrypto;

create table if not exists public.tools (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 slug text not null unique,
 short_description text not null,
 description text not null default '',
 category text not null,
 website_url text not null,
 pricing text not null default 'مجاني جزئياً',
 logo_url text,
 featured boolean not null default false,
 status text not null default 'pending' check (status in ('pending','published','rejected')),
 created_at timestamptz not null default now()
);

create table if not exists public.submissions (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 slug text not null,
 short_description text not null,
 description text not null default '',
 category text not null,
 website_url text not null,
 pricing text not null default 'مجاني جزئياً',
 contact_email text,
 status text not null default 'pending' check (status in ('pending','approved','rejected')),
 created_at timestamptz not null default now()
);

create index if not exists tools_published_created_idx on public.tools(status, created_at desc);
create index if not exists submissions_status_created_idx on public.submissions(status, created_at desc);

alter table public.tools enable row level security;
alter table public.submissions enable row level security;

drop policy if exists "Public read published tools" on public.tools;
create policy "Public read published tools" on public.tools for select to anon, authenticated using (status = 'published');

drop policy if exists "Admins manage tools" on public.tools;
create policy "Admins manage tools" on public.tools for all to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Public submit tool" on public.submissions;
create policy "Public submit tool" on public.submissions for insert to anon, authenticated with check (status = 'pending');

drop policy if exists "Admins read submissions" on public.submissions;
create policy "Admins read submissions" on public.submissions for select to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins update submissions" on public.submissions;
create policy "Admins update submissions" on public.submissions for update to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');