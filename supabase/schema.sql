-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
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

insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's0', 'Pixies', 'Surfer Rosa', 1988, 'seed', null, 'covers/s0.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's1', 'Pixies', 'Doolittle', 1989, 'seed', null, 'covers/s1.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's2', 'Pixies', 'Bossanova', 1990, 'seed', null, 'covers/s2.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's3', 'Pixies', 'Trompe le Monde', 1991, 'seed', null, 'covers/s3.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's4', 'Sonic Youth', 'EVOL', 1986, 'seed', null, 'covers/s4.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's5', 'Sonic Youth', 'Goo', 1990, 'seed', null, 'covers/s5.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's6', 'Sonic Youth', 'Dirty', 1992, 'seed', null, 'covers/s6.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's7', 'Blur', 'Leisure', 1991, 'seed', null, 'covers/s7.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's8', 'Blur', 'Modern Life Is Rubbish', 1993, 'seed', null, 'covers/s8.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's9', 'Blur', 'Parklife', 1994, 'seed', null, 'covers/s9.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's10', 'Blur', 'The Great Escape', 1995, 'seed', null, 'covers/s10.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's11', 'Metallica', 'Metallica (The Black Album)', 1991, 'seed', null, 'covers/s11.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's12', 'Nirvana', 'Bleach', 1989, 'seed', null, 'covers/s12.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's13', 'Nirvana', 'Nevermind', 1991, 'seed', null, 'covers/s13.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's14', 'Nirvana', 'In Utero', 1993, 'seed', null, 'covers/s14.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's15', 'Pearl Jam', 'Ten', 1991, 'seed', null, 'covers/s15.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's16', 'Pavement', 'Slanted and Enchanted', 1992, 'seed', null, 'covers/s16.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's17', 'Pavement', 'Crooked Rain, Crooked Rain', 1994, 'seed', null, 'covers/s17.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's18', 'Pavement', 'Wowee Zowee', 1995, 'seed', null, 'covers/s18.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's19', 'Pavement', 'Brighten the Corners', 1997, 'seed', null, 'covers/s19.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's20', 'Pavement', 'Terror Twilight', 1999, 'seed', null, 'covers/s20.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's21', 'The Smashing Pumpkins', 'Gish', 1991, 'seed', null, 'covers/s21.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's22', 'The Smashing Pumpkins', 'Siamese Dream', 1993, 'seed', null, 'covers/s22.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's23', 'Guided by Voices', 'Same Place the Fly Got Smashed', 1990, 'seed', null, 'covers/s23.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's24', 'Guided by Voices', 'Propeller', 1992, 'seed', null, 'covers/s24.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's25', 'Guided by Voices', 'Vampire on Titus', 1993, 'seed', null, 'covers/s25.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's26', 'Guided by Voices', 'Bee Thousand', 1994, 'seed', null, 'covers/s26.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's27', 'Guided by Voices', 'Alien Lanes', 1995, 'seed', null, 'covers/s27.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's28', 'Guided by Voices', 'Under the Bushes Under the Stars', 1996, 'seed', null, 'covers/s28.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's29', 'The Breeders', 'Pod', 1990, 'seed', null, 'covers/s29.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's30', 'The Breeders', 'Last Splash', 1993, 'seed', null, 'covers/s30.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's31', 'The Amps', 'Pacer', 1995, 'seed', null, 'covers/s31.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's32', 'Dinosaur Jr.', 'You''re Living All Over Me', 1987, 'seed', null, 'covers/s32.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's33', 'Dinosaur Jr.', 'Bug', 1988, 'seed', null, 'covers/s33.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's34', 'Dinosaur Jr.', 'Green Mind', 1991, 'seed', null, 'covers/s34.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's35', 'Dinosaur Jr.', 'Where You Been', 1993, 'seed', null, 'covers/s35.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's36', 'Sebadoh', 'III', 1991, 'seed', null, 'covers/s36.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's37', 'Sebadoh', 'Bakesale', 1994, 'seed', null, 'covers/s37.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's38', 'Sebadoh', 'Harmacy', 1996, 'seed', null, 'covers/s38.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's39', 'Robert Wyatt', 'Rock Bottom', 1974, 'seed', null, 'covers/s39.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's40', 'נושאי המגבעת', 'נושאי המגבעת', 1988, 'seed', null, 'covers/s40.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's41', 'נושאי המגבעת', 'מי רצח את אגנתה פאלסקוג', 1991, 'seed', null, 'covers/s41.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's42', 'רעש', 'רעש רק רעש', 1994, 'seed', null, 'covers/s42.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's43', 'Pink Floyd', 'The Piper at the Gates of Dawn', 1967, 'seed', null, 'covers/s43.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's44', 'Pink Floyd', 'Atom Heart Mother', 1970, 'seed', null, 'covers/s44.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's45', 'The Beatles', 'The Beatles (White Album)', 1968, 'seed', null, 'covers/s45.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's46', 'Aphex Twin', 'Richard D. James Album', 1996, 'seed', null, 'covers/s46.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's47', 'My Bloody Valentine', 'Loveless', 1991, 'seed', null, 'covers/s47.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's48', 'Built to Spill', 'Perfect from Now On', 1997, 'seed', null, 'covers/s48.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's49', 'Yo La Tengo', 'I Can Hear the Heart Beating as One', 1997, 'seed', null, 'covers/s49.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's50', 'Beck', 'Mellow Gold', 1994, 'seed', null, 'covers/s50.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's51', 'Afghan Whigs', 'Gentlemen', 1993, 'seed', null, 'covers/s51.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's52', 'PJ Harvey', 'Rid of Me', 1993, 'seed', null, 'covers/s52.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's53', 'Stereolab', 'Emperor Tomato Ketchup', 1996, 'seed', null, 'covers/s53.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's54', 'The Velvet Underground', 'The Velvet Underground', 1969, 'seed', null, 'covers/s54.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's55', 'The Cure', 'Disintegration', 1989, 'seed', null, 'covers/s55.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's56', 'Joy Division', 'Unknown Pleasures', 1979, 'seed', null, 'covers/s56.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's57', 'The Modern Lovers', 'The Modern Lovers', 1976, 'seed', null, 'covers/s57.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's58', 'The Magnetic Fields', '69 Love Songs', 1999, 'seed', null, 'covers/s58.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's59', 'Blonde Redhead', 'Fake Can Be Just as Good', 1997, 'seed', null, 'covers/s59.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's60', 'Blonde Redhead', 'In an Expression of the Inexpressible', 1998, 'seed', null, 'covers/s60.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's61', 'R.E.M.', 'Automatic for the People', 1992, 'seed', null, 'covers/s61.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's62', 'Pulp', 'Different Class', 1995, 'seed', null, 'covers/s62.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's63', 'Faith No More', 'Angel Dust', 1992, 'seed', null, 'covers/s63.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's64', 'Jane''s Addiction', 'Ritual de lo Habitual', 1990, 'seed', null, 'covers/s64.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's65', 'Frank Black', 'Teenager of the Year', 1994, 'seed', null, 'covers/s65.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's66', 'dEUS', 'Worst Case Scenario', 1994, 'seed', null, 'covers/s66.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's67', 'Mission of Burma', 'Vs.', 1982, 'seed', null, 'covers/s67.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's68', 'The Jon Spencer Blues Explosion', 'Orange', 1994, 'seed', null, 'covers/s68.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's69', 'Oasis', 'Definitely Maybe', 1994, 'seed', null, 'covers/s69.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's70', 'זקני צפת', 'זקני צפת', 1992, 'seed', null, 'covers/s70.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's71', 'כרמלה גרוס ואגנר', 'פרח שחור', 1991, 'seed', null, 'covers/s71.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's72', 'הפה והטלפיים', 'בין הים והביצות', 1995, 'seed', null, 'covers/s72.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's73', 'רוקפור', 'האיש שראה הכל', 1995, 'seed', null, 'covers/s73.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's74', 'ברי סחרוף', 'סימנים של חולשה', 1993, 'seed', null, 'covers/s74.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's75', 'Gang of Four', 'Entertainment!', 1979, 'seed', null, 'covers/s75.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's76', 'Can', 'Ege Bamyasi', 1972, 'seed', null, 'covers/s76.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's77', 'Portishead', 'Dummy', 1994, 'seed', null, 'covers/s77.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's78', 'Ween', 'The Mollusk', 1997, 'seed', null, 'covers/s78.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's79', 'Pere Ubu', 'The Modern Dance', 1978, 'seed', null, 'covers/s79.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's80', 'Shellac', 'At Action Park', 1994, 'seed', null, 'covers/s80.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's81', 'Devo', 'Q: Are We Not Men? A: We Are Devo!', 1978, 'seed', null, 'covers/s81.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('main', 's82', 'Syd Barrett', 'The Madcap Laughs', 1970, 'seed', null, 'covers/s82.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's0', 'Pixies', 'Surfer Rosa', 1988, 'seed', null, 'covers/s0.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's1', 'Pixies', 'Doolittle', 1989, 'seed', null, 'covers/s1.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's2', 'Pixies', 'Bossanova', 1990, 'seed', null, 'covers/s2.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's3', 'Pixies', 'Trompe le Monde', 1991, 'seed', null, 'covers/s3.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's4', 'Sonic Youth', 'EVOL', 1986, 'seed', null, 'covers/s4.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's5', 'Sonic Youth', 'Goo', 1990, 'seed', null, 'covers/s5.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's6', 'Sonic Youth', 'Dirty', 1992, 'seed', null, 'covers/s6.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's7', 'Blur', 'Leisure', 1991, 'seed', null, 'covers/s7.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's8', 'Blur', 'Modern Life Is Rubbish', 1993, 'seed', null, 'covers/s8.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's9', 'Blur', 'Parklife', 1994, 'seed', null, 'covers/s9.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's10', 'Blur', 'The Great Escape', 1995, 'seed', null, 'covers/s10.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's11', 'Metallica', 'Metallica (The Black Album)', 1991, 'seed', null, 'covers/s11.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's12', 'Nirvana', 'Bleach', 1989, 'seed', null, 'covers/s12.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's13', 'Nirvana', 'Nevermind', 1991, 'seed', null, 'covers/s13.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's14', 'Nirvana', 'In Utero', 1993, 'seed', null, 'covers/s14.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's15', 'Pearl Jam', 'Ten', 1991, 'seed', null, 'covers/s15.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's16', 'Pavement', 'Slanted and Enchanted', 1992, 'seed', null, 'covers/s16.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's17', 'Pavement', 'Crooked Rain, Crooked Rain', 1994, 'seed', null, 'covers/s17.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's18', 'Pavement', 'Wowee Zowee', 1995, 'seed', null, 'covers/s18.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's19', 'Pavement', 'Brighten the Corners', 1997, 'seed', null, 'covers/s19.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's20', 'Pavement', 'Terror Twilight', 1999, 'seed', null, 'covers/s20.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's21', 'The Smashing Pumpkins', 'Gish', 1991, 'seed', null, 'covers/s21.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's22', 'The Smashing Pumpkins', 'Siamese Dream', 1993, 'seed', null, 'covers/s22.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's23', 'Guided by Voices', 'Same Place the Fly Got Smashed', 1990, 'seed', null, 'covers/s23.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's24', 'Guided by Voices', 'Propeller', 1992, 'seed', null, 'covers/s24.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's25', 'Guided by Voices', 'Vampire on Titus', 1993, 'seed', null, 'covers/s25.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's26', 'Guided by Voices', 'Bee Thousand', 1994, 'seed', null, 'covers/s26.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's27', 'Guided by Voices', 'Alien Lanes', 1995, 'seed', null, 'covers/s27.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's28', 'Guided by Voices', 'Under the Bushes Under the Stars', 1996, 'seed', null, 'covers/s28.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's29', 'The Breeders', 'Pod', 1990, 'seed', null, 'covers/s29.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's30', 'The Breeders', 'Last Splash', 1993, 'seed', null, 'covers/s30.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's31', 'The Amps', 'Pacer', 1995, 'seed', null, 'covers/s31.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's32', 'Dinosaur Jr.', 'You''re Living All Over Me', 1987, 'seed', null, 'covers/s32.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's33', 'Dinosaur Jr.', 'Bug', 1988, 'seed', null, 'covers/s33.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's34', 'Dinosaur Jr.', 'Green Mind', 1991, 'seed', null, 'covers/s34.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's35', 'Dinosaur Jr.', 'Where You Been', 1993, 'seed', null, 'covers/s35.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's36', 'Sebadoh', 'III', 1991, 'seed', null, 'covers/s36.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's37', 'Sebadoh', 'Bakesale', 1994, 'seed', null, 'covers/s37.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's38', 'Sebadoh', 'Harmacy', 1996, 'seed', null, 'covers/s38.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's39', 'Robert Wyatt', 'Rock Bottom', 1974, 'seed', null, 'covers/s39.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's40', 'נושאי המגבעת', 'נושאי המגבעת', 1988, 'seed', null, 'covers/s40.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's41', 'נושאי המגבעת', 'מי רצח את אגנתה פאלסקוג', 1991, 'seed', null, 'covers/s41.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's42', 'רעש', 'רעש רק רעש', 1994, 'seed', null, 'covers/s42.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's43', 'Pink Floyd', 'The Piper at the Gates of Dawn', 1967, 'seed', null, 'covers/s43.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's44', 'Pink Floyd', 'Atom Heart Mother', 1970, 'seed', null, 'covers/s44.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's45', 'The Beatles', 'The Beatles (White Album)', 1968, 'seed', null, 'covers/s45.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's46', 'Aphex Twin', 'Richard D. James Album', 1996, 'seed', null, 'covers/s46.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's47', 'My Bloody Valentine', 'Loveless', 1991, 'seed', null, 'covers/s47.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's48', 'Built to Spill', 'Perfect from Now On', 1997, 'seed', null, 'covers/s48.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's49', 'Yo La Tengo', 'I Can Hear the Heart Beating as One', 1997, 'seed', null, 'covers/s49.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's50', 'Beck', 'Mellow Gold', 1994, 'seed', null, 'covers/s50.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's51', 'Afghan Whigs', 'Gentlemen', 1993, 'seed', null, 'covers/s51.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's52', 'PJ Harvey', 'Rid of Me', 1993, 'seed', null, 'covers/s52.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's53', 'Stereolab', 'Emperor Tomato Ketchup', 1996, 'seed', null, 'covers/s53.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's54', 'The Velvet Underground', 'The Velvet Underground', 1969, 'seed', null, 'covers/s54.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's55', 'The Cure', 'Disintegration', 1989, 'seed', null, 'covers/s55.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's56', 'Joy Division', 'Unknown Pleasures', 1979, 'seed', null, 'covers/s56.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's57', 'The Modern Lovers', 'The Modern Lovers', 1976, 'seed', null, 'covers/s57.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's58', 'The Magnetic Fields', '69 Love Songs', 1999, 'seed', null, 'covers/s58.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's59', 'Blonde Redhead', 'Fake Can Be Just as Good', 1997, 'seed', null, 'covers/s59.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's60', 'Blonde Redhead', 'In an Expression of the Inexpressible', 1998, 'seed', null, 'covers/s60.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's61', 'R.E.M.', 'Automatic for the People', 1992, 'seed', null, 'covers/s61.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's62', 'Pulp', 'Different Class', 1995, 'seed', null, 'covers/s62.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's63', 'Faith No More', 'Angel Dust', 1992, 'seed', null, 'covers/s63.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's64', 'Jane''s Addiction', 'Ritual de lo Habitual', 1990, 'seed', null, 'covers/s64.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's65', 'Frank Black', 'Teenager of the Year', 1994, 'seed', null, 'covers/s65.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's66', 'dEUS', 'Worst Case Scenario', 1994, 'seed', null, 'covers/s66.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's67', 'Mission of Burma', 'Vs.', 1982, 'seed', null, 'covers/s67.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's68', 'The Jon Spencer Blues Explosion', 'Orange', 1994, 'seed', null, 'covers/s68.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's69', 'Oasis', 'Definitely Maybe', 1994, 'seed', null, 'covers/s69.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's70', 'זקני צפת', 'זקני צפת', 1992, 'seed', null, 'covers/s70.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's71', 'כרמלה גרוס ואגנר', 'פרח שחור', 1991, 'seed', null, 'covers/s71.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's72', 'הפה והטלפיים', 'בין הים והביצות', 1995, 'seed', null, 'covers/s72.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's73', 'רוקפור', 'האיש שראה הכל', 1995, 'seed', null, 'covers/s73.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's74', 'ברי סחרוף', 'סימנים של חולשה', 1993, 'seed', null, 'covers/s74.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's75', 'Gang of Four', 'Entertainment!', 1979, 'seed', null, 'covers/s75.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's76', 'Can', 'Ege Bamyasi', 1972, 'seed', null, 'covers/s76.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's77', 'Portishead', 'Dummy', 1994, 'seed', null, 'covers/s77.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's78', 'Ween', 'The Mollusk', 1997, 'seed', null, 'covers/s78.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's79', 'Pere Ubu', 'The Modern Dance', 1978, 'seed', null, 'covers/s79.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's80', 'Shellac', 'At Action Park', 1994, 'seed', null, 'covers/s80.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's81', 'Devo', 'Q: Are We Not Men? A: We Are Devo!', 1978, 'seed', null, 'covers/s81.jpg') on conflict (poll, id) do nothing;
insert into albums (poll, id, artist, album, year, source, added_by, cover_url) values ('best_ever', 's82', 'Syd Barrett', 'The Madcap Laughs', 1970, 'seed', null, 'covers/s82.jpg') on conflict (poll, id) do nothing;
