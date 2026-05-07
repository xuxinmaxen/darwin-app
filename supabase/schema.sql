-- Darwin · V1 Database Schema
--
-- Run this in Supabase SQL Editor ONCE per environment.
-- Idempotent: safe to re-run.

-- ─── Extensions ───────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── Projects ─────────────────────────────────────────────
create table if not exists public.projects (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  type            text not null check (type in ('html','ppt','doc','design')),
  background      text,
  conflict_mode   text not null default 'discuss' check (conflict_mode in ('discuss','ai_decide')),
  status          text not null default 'draft' check (status in ('draft','collaborating','tension','converged','published')),
  owner_id        uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists projects_owner_id_idx on public.projects(owner_id);
create index if not exists projects_updated_at_idx on public.projects(updated_at desc);

-- ─── Project collaborators (Phase 2) ──────────────────────
create table if not exists public.project_collaborators (
  project_id      uuid not null references public.projects(id) on delete cascade,
  member_id       text not null,                                   -- user id or agent id
  member_kind     text not null check (member_kind in ('human','agent')),
  role            text not null default 'contributor',
  joined_at       timestamptz not null default now(),
  primary key (project_id, member_id)
);

-- ─── Intents ──────────────────────────────────────────────
create table if not exists public.intents (
  id              uuid primary key default uuid_generate_v4(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  author_id       text not null,
  author_kind     text not null check (author_kind in ('human','agent')),
  statement       text not null,
  type            text not null check (type in ('Goal','Constraint','Preference','Reference','Veto')),
  scope           text not null,
  weight          text not null check (weight in ('must','should','nice_to_have')),
  rationale       text,
  created_at      timestamptz not null default now()
);

create index if not exists intents_project_id_idx on public.intents(project_id);
create index if not exists intents_project_scope_idx on public.intents(project_id, scope);

-- ─── Tensions (Phase 2) ───────────────────────────────────
create table if not exists public.tensions (
  id              uuid primary key default uuid_generate_v4(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  scope           text not null,
  variant         text not null check (variant in ('human','agents')),
  status          text not null default 'active' check (status in ('active','resolved')),
  title           text not null,
  description     text not null,
  intent_ids      uuid[] not null default '{}',
  options         jsonb not null default '[]'::jsonb,
  resolution      jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists tensions_project_id_idx on public.tensions(project_id);
create index if not exists tensions_status_idx on public.tensions(status);

-- ─── Versions (产物快照) ──────────────────────────────────
create table if not exists public.versions (
  id              uuid primary key default uuid_generate_v4(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  v               int not null,
  label           text not null,
  actor           text not null,
  scope           text,
  snapshot        jsonb not null,
  created_at      timestamptz not null default now(),
  unique (project_id, v)
);

create index if not exists versions_project_v_idx on public.versions(project_id, v desc);

-- ─── Triggers: updated_at ─────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists projects_touch_updated on public.projects;
create trigger projects_touch_updated
  before update on public.projects
  for each row execute function public.touch_updated_at();

-- ─── Row-Level Security ───────────────────────────────────
-- V1 development: keep open. Phase 2 will lock down by owner_id / collaborator.
-- alter table public.projects enable row level security;
-- alter table public.intents enable row level security;
-- alter table public.tensions enable row level security;
-- alter table public.versions enable row level security;
