#!/usr/bin/env python3
"""Generate supabase/schema.sql (DDL + RLS + seed data) from the album list
in reference/fetch_covers.py, so the 83 seed rows are never hand-typed twice.

This describes the multi-poll schema (poll-scoped albums/votes/app_state) --
for a brand-new Supabase project. An already-live single-poll DB should run
supabase/migrate_multi_poll.sql instead, once, to transform in place."""
import importlib.util
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("fetch_covers", ROOT / "reference" / "fetch_covers.py")
fetch_covers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetch_covers)
ALBUMS = fetch_covers.ALBUMS

POLLS = ["main", "best_ever"]


def sql_str(s):
    return "'" + s.replace("'", "''") + "'"


DDL = """-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT throughout.
-- Describes a FRESH multi-poll setup. An existing single-poll DB should run
-- migrate_multi_poll.sql instead, once, to transform in place.

create table if not exists albums (
  poll text not null,
  id text not null,
  artist text not null,
  album text not null,
  year int,
  source text not null check (source in ('seed','added')),
  added_by text,
  cover_url text,
  created_at timestamptz not null default now(),
  primary key (poll, id)
);

-- catches exact-duplicate nominations racing each other, within a poll
create unique index if not exists albums_dedupe_idx
  on albums (poll, lower(trim(artist)), lower(trim(album)));

create table if not exists votes (
  poll text not null,
  voter text not null,
  album_id text not null,
  created_at timestamptz not null default now(),
  primary key (poll, voter, album_id),
  foreign key (poll, album_id) references albums (poll, id) on delete cascade
);

create table if not exists app_state (
  poll text primary key,
  phase text not null default 'nominate' check (phase in ('nominate','vote')),
  opened_at timestamptz
);
insert into app_state (poll, phase) values ('main', 'nominate')
  on conflict (poll) do nothing;
insert into app_state (poll, phase) values ('best_ever', 'nominate')
  on conflict (poll) do nothing;

alter table albums enable row level security;
alter table votes enable row level security;
alter table app_state enable row level security;

-- No real auth backs this app (voters just pick their name from a list —
-- see CLAUDE_CODE_HANDOFF.md #5). These policies are intentionally
-- permissive for the anon key; RLS is enabled mainly to avoid the
-- "no policies at all" default-deny trap and to keep intent explicit,
-- not to provide real per-voter security. Fine for six trusted friends.
-- albums/votes writes are additionally gated to the phase of their OWN poll
-- (nominate-only for albums, vote-only for ballots), enforced server-side
-- so a direct REST call with the anon key can't bypass the phase the UI
-- enforces only client-side, and one poll's phase can't affect the other's.
drop policy if exists albums_select on albums;
create policy albums_select on albums for select using (true);
drop policy if exists albums_insert on albums;
create policy albums_insert on albums for insert with check (
  source = 'added'
  and exists (select 1 from app_state s where s.poll = albums.poll and s.phase = 'nominate')
);
drop policy if exists albums_delete on albums;
create policy albums_delete on albums for delete using (
  source = 'added'
  and exists (select 1 from app_state s where s.poll = albums.poll and s.phase = 'nominate')
);

drop policy if exists votes_select on votes;
create policy votes_select on votes for select using (true);
drop policy if exists votes_insert on votes;
create policy votes_insert on votes for insert with check (
  exists (select 1 from app_state s where s.poll = votes.poll and s.phase = 'vote')
);
drop policy if exists votes_delete on votes;
create policy votes_delete on votes for delete using (
  exists (select 1 from app_state s where s.poll = votes.poll and s.phase = 'vote')
);

drop policy if exists app_state_select on app_state;
create policy app_state_select on app_state for select using (true);
drop policy if exists app_state_insert on app_state;
create policy app_state_insert on app_state for insert with check (true);
drop policy if exists app_state_update on app_state;
create policy app_state_update on app_state for update using (true) with check (true);

-- realtime: make sure these tables broadcast changes (guarded so re-running
-- this script never fails with "already member of publication")
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'albums') then
    alter publication supabase_realtime add table albums;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'votes') then
    alter publication supabase_realtime add table votes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_state') then
    alter publication supabase_realtime add table app_state;
  end if;
end $$;

-- seed data: same 83 albums, independently in each poll ----------------
"""

lines = [DDL]
for poll in POLLS:
    for a in ALBUMS:
        cover = f"covers/{a['id']}.jpg"
        lines.append(
            "insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values "
            f"({sql_str(poll)}, {sql_str(a['id'])}, {sql_str(a['artist'])}, {sql_str(a['album'])}, {a['year']}, "
            f"'seed', null, {sql_str(cover)}) on conflict (poll, id) do nothing;"
        )

out = ROOT / "supabase" / "schema.sql"
out.parent.mkdir(exist_ok=True)
out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"wrote {out} ({len(ALBUMS)} seed rows x {len(POLLS)} polls)")
