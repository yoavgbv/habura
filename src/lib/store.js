import { supabase } from "./supabaseClient";

/* ---------- reads ---------- */
export async function fetchAll() {
  const [{ data: albums, error: albumsErr }, { data: voteRows, error: votesErr }, { data: stateRows, error: stateErr }] =
    await Promise.all([
      supabase.from("albums").select("*").order("created_at", { ascending: true }),
      supabase.from("votes").select("*"),
      supabase.from("app_state").select("*").eq("id", 1).limit(1),
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
export function subscribeChanges(onChange) {
  let timer = null;
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 250);
  };
  const channel = supabase
    .channel("habura-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "albums" }, debounced)
    .on("postgres_changes", { event: "*", schema: "public", table: "votes" }, debounced)
    .on("postgres_changes", { event: "*", schema: "public", table: "app_state" }, debounced)
    .subscribe();

  return () => {
    if (timer) clearTimeout(timer);
    supabase.removeChannel(channel);
  };
}

/* ---------- writes ---------- */
export async function insertAlbum({ id, artist, album, year, addedBy, coverUrl }) {
  const { error } = await supabase.from("albums").insert({
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

export async function removeAlbum(id) {
  const { error } = await supabase
    .from("albums")
    .delete()
    .eq("id", id)
    .eq("source", "added");
  return !error;
}

export async function saveBallot(voter, picks) {
  const del = await supabase.from("votes").delete().eq("voter", voter);
  if (del.error) return false;
  if (picks.length === 0) return true;
  const rows = picks.map((album_id) => ({ voter, album_id }));
  const ins = await supabase.from("votes").insert(rows);
  return !ins.error;
}

export async function setPhase(phase) {
  const { error } = await supabase
    .from("app_state")
    .upsert({ id: 1, phase, opened_at: new Date().toISOString() });
  return !error;
}

export async function resetAll() {
  await supabase.from("votes").delete().neq("voter", "");
  await supabase.from("albums").delete().eq("source", "added");
  await setPhase("nominate");
}
