-- One-time migration: turn the single-poll schema into a multi-poll one so a
-- second poll ("best_ever" — האלבום הכי טוב בהיסטוריה) can run alongside the
-- existing one ("main" — החבורה) without touching its live data.
--
-- Wrapped in a transaction: if any step fails, nothing applies. Safe to run
-- only once against a DB that still has the single-poll shape (checks below
-- make re-running a no-op rather than an error, but this isn't meant to be
-- re-run routinely like schema.sql).

begin;

alter table albums add column if not exists poll text not null default 'main';
alter table votes add column if not exists poll text not null default 'main';

-- old policies reference app_state.id -- must go before we touch that column
drop policy if exists albums_insert on albums;
drop policy if exists albums_delete on albums;
drop policy if exists votes_insert on votes;
drop policy if exists votes_delete on votes;

-- votes' old FK depends on albums' old single-column PK -- must drop before
-- albums_pkey can be rebuilt as composite
alter table votes drop constraint if exists votes_pkey;
alter table votes drop constraint if exists votes_album_id_fkey;

-- app_state: was a singleton row (id int, always 1). Becomes one row per poll.
alter table app_state add column if not exists poll text;
update app_state set poll = 'main' where poll is null;
alter table app_state alter column poll set not null;
alter table app_state drop constraint if exists app_state_pkey;
alter table app_state drop constraint if exists app_state_singleton;
alter table app_state add constraint app_state_pkey primary key (poll);
alter table app_state drop column if exists id;

-- albums: composite primary key so the same album id can exist in both polls
alter table albums drop constraint if exists albums_pkey;
alter table albums add constraint albums_pkey primary key (poll, id);

-- votes: composite primary key + FK to match
alter table votes add constraint votes_pkey primary key (poll, voter, album_id);
alter table votes add constraint votes_poll_album_fkey
  foreign key (poll, album_id) references albums (poll, id) on delete cascade;

-- dedupe index: was global, now scoped per poll (the same album can be
-- nominated independently in each poll)
drop index if exists albums_dedupe_idx;
create unique index if not exists albums_dedupe_idx
  on albums (poll, lower(trim(artist)), lower(trim(album)));

-- seed the new poll with the same base list as main, starting in nominate
insert into albums (poll, id, artist, album, year, source, added_by, cover_url)
select 'best_ever', id, artist, album, year, 'seed', null, cover_url
from albums
where poll = 'main' and source = 'seed'
on conflict (poll, id) do nothing;

insert into app_state (poll, phase) values ('best_ever', 'nominate')
on conflict (poll) do nothing;

-- RLS: phase-gating now checks the phase of the row's OWN poll, not a single
-- global app_state row
create policy albums_insert on albums for insert with check (
  source = 'added'
  and exists (select 1 from app_state s where s.poll = albums.poll and s.phase = 'nominate')
);
create policy albums_delete on albums for delete using (
  source = 'added'
  and exists (select 1 from app_state s where s.poll = albums.poll and s.phase = 'nominate')
);
create policy votes_insert on votes for insert with check (
  exists (select 1 from app_state s where s.poll = votes.poll and s.phase = 'vote')
);
create policy votes_delete on votes for delete using (
  exists (select 1 from app_state s where s.poll = votes.poll and s.phase = 'vote')
);

commit;
