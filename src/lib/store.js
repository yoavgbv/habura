import { supabase } from "./supabaseClient";

/* ---------- reads ---------- */
export async function fetchAll(poll) {
  const [{ data: albums, error: albumsErr }, { data: voteRows, error: votesErr }, { data: stateRows, error: stateErr }] =
    await Promise.all([
      supabase.from("albums").select("*").eq("poll", poll).order("created_at", { ascending: true }),
      supabase.from("votes").select("*").eq("poll", poll),
      supabase.from("app_state").select("*").eq("poll", poll).limit(1),
    ]);
  if (albumsErr) throw albumsErr;
  if (votesErr) throw votesErr;
  if (stateErr) throw stateErr;

  const votes = {};
  (voteRows || []).forEach((r) => {
    if (!votes[r.voter]) votes[r.voter] = { picks: [], updatedAt: 0 };
    votes[r.voter].picks.push(r.album_id);
    const t = new Date(r.created_at).getTime();
    if (t > votes[r.voter].updatedAt) votes[r.voter].updatedAt = t;
  });

  const phase = (stateRows && stateRows[0] && stateRows[0].phase) || "nominate";

  return { albums: albums || [], votes, phase };
}

/* ---------- realtime ---------- */
export function subscribeChanges(poll, onChange) {
  let timer = null;
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 250);
  };
  const channel = supabase
    .channel("habura-live-" + poll)
    .on("postgres_changes", { event: "*", schema: "public", table: "albums", filter: "poll=eq." + poll }, debounced)
    .on("postgres_changes", { event: "*", schema: "public", table: "votes", filter: "poll=eq." + poll }, debounced)
    .on("postgres_changes", { event: "*", schema: "public", table: "app_state", filter: "poll=eq." + poll }, debounced)
    .subscribe();

  return () => {
    if (timer) clearTimeout(timer);
    supabase.removeChannel(channel);
  };
}

/* ---------- writes ---------- */
export async function insertAlbum(poll, { id, artist, album, year, addedBy, coverUrl }) {
  const { error } = await supabase.from("albums").insert({
    poll,
    id,
    artist,
    album,
    year,
    source: "added",
    added_by: addedBy,
    cover_url: coverUrl || null,
  });
  return !error;
}

export async function removeAlbum(poll, id) {
  const { error } = await supabase
    .from("albums")
    .delete()
    .eq("poll", poll)
    .eq("id", id)
    .eq("source", "added");
  return !error;
}

export async function saveBallot(poll, voter, picks) {
  const del = await supabase.from("votes").delete().eq("poll", poll).eq("voter", voter);
  if (del.error) return false;
  if (picks.length === 0) return true;
  const rows = picks.map((album_id) => ({ poll, voter, album_id }));
  const ins = await supabase.from("votes").insert(rows);
  return !ins.error;
}

export async function setPhase(poll, phase) {
  const { error } = await supabase
    .from("app_state")
    .upsert({ poll, phase, opened_at: new Date().toISOString() });
  return !error;
}

export async function resetAll(poll) {
  await supabase.from("votes").delete().eq("poll", poll);
  await supabase.from("albums").delete().eq("poll", poll).eq("source", "added");
  await setPhase(poll, "nominate");
}
