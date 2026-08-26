import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  fetchAll,
  subscribeChanges,
  insertAlbum,
  removeAlbum,
  saveBallot,
  setPhase as dbSetPhase,
  resetAll as dbResetAll,
} from "./lib/store";
import { searchAlbums, coverArtUrl } from "./lib/musicbrainz";

/* ============================================================
   החבורה — דירוג האלבומים החשובים בתולדות החבורה
   ------------------------------------------------------------
   קוד המנהל: מגיע מתוך משתנה סביבה בזמן build (ראה .env / GitHub
   Actions secret ADMIN_PIN). רק מי שמקליד אותו יכול לפתוח הצבעה /
   להחזיר לשלב הצעות / לאפס הכל.
   ============================================================ */
const ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN || "1990";

const MEMBERS = [
  { id: "job",    name: "ג׳וב" },
  { id: "bomra",  name: "בומרה" },
  { id: "dan",    name: "דן" },
  { id: "bentzi", name: "בנצי" },
  { id: "boav",   name: "בואב" },
  { id: "fuad",   name: "פואד" },
];
const memberName = (id) => (MEMBERS.find((m) => m.id === id) || {}).name || id;

const PICKS_REQUIRED = 10;

/* ---------- helpers ---------- */
const norm = (s) =>
  (s || "")
    .toString()
    .toLowerCase()
    .replace(/[‘’'".,!?()\[\]/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const albumKey = (artist, album) => norm(artist) + " :: " + norm(album);

/* best-effort live cover lookup for freshly user-added albums, which have
   no pre-fetched local file. Seed albums use a committed cover instead —
   see resolveCover(). */
const bingCoverUrl = (artist, album) =>
  "https://tse1.mm.bing.net/th?q=" +
  encodeURIComponent(((artist || "") + " " + (album || "") + " album cover").trim()) +
  "&w=300&h=300&c=7&rs=1&p=0";

/* cover_url in the DB is either a full https:// URL (added albums) or a
   path relative to the site root (committed seed covers, e.g. "covers/s0.jpg") */
const resolveCover = (coverUrl) => {
  if (!coverUrl) return "";
  if (/^https?:\/\//.test(coverUrl)) return coverUrl;
  return import.meta.env.BASE_URL + coverUrl;
};

/* ---------- cover ----------
   The typographic tile is ALWAYS rendered as the base. The real cover
   overlays it only once it truly loads (onLoad). If it 404s or errors,
   the tile stays visible — so a cover square is never black or empty. */
function Cover({ artist, album, coverUrl, size }) {
  const [loaded, setLoaded] = useState(false);
  const src = resolveCover(coverUrl);
  return (
    <div className={"cover " + (size || "")}>
      <div className="cover-tile" aria-hidden={loaded}>
        <span className="fb-artist" dir="auto">{artist}</span>
        <span className="fb-album" dir="auto">{album}</span>
      </div>
      {src && (
        <img
          className={"cover-img " + (loaded ? "shown" : "")}
          src={src}
          alt={artist + " – " + album}
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={(e) => { if (e.target.naturalWidth > 2) setLoaded(true); }}
          onError={() => setLoaded(false)}
        />
      )}
    </div>
  );
}

/* ============================================================ */
export default function App() {
  const [booted, setBooted] = useState(false);
  const [phase, setPhase] = useState("nominate"); // nominate | vote
  const [albums, setAlbums] = useState([]);
  const [votes, setVotes] = useState({}); // { memberId: {picks:[], updatedAt} }
  const [me, setMe] = useState(null);
  const [view, setView] = useState("home"); // home | list | results
  const [admin, setAdmin] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const flash = useCallback((msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { albums: a, votes: v, phase: p } = await fetchAll();
      setAlbums(a);
      setVotes(v);
      setPhase(p);
    } catch (e) {
      flash("שגיאת חיבור לשרת");
    }
  }, [flash]);

  useEffect(() => {
    (async () => {
      await refresh();
      setBooted(true);
    })();
  }, [refresh]);

  // realtime sync across browsers, with a slow fallback poll in case the
  // websocket drops (common on mobile networks)
  useEffect(() => {
    const unsubscribe = subscribeChanges(refresh);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 30000);
    return () => {
      unsubscribe();
      clearInterval(t);
    };
  }, [refresh]);

  const allAlbums = useMemo(() => {
    const added = albums
      .filter((a) => a.source === "added")
      .slice()
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const seed = albums
      .filter((a) => a.source === "seed")
      .slice()
      .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    return [...added, ...seed];
  }, [albums]);
  const addedAlbums = useMemo(() => albums.filter((a) => a.source === "added"), [albums]);

  const albumById = useMemo(() => {
    const m = {};
    allAlbums.forEach((a) => (m[a.id] = a));
    return m;
  }, [allAlbums]);

  const existingKeys = useMemo(() => {
    const s = new Set();
    allAlbums.forEach((a) => s.add(albumKey(a.artist, a.album)));
    return s;
  }, [allAlbums]);

  /* ---------- results tally ---------- */
  const tally = useMemo(() => {
    const counts = {}; // id -> {count, voters:[]}
    Object.entries(votes).forEach(([mid, v]) => {
      (v.picks || []).forEach((id) => {
        if (!counts[id]) counts[id] = { count: 0, voters: [] };
        counts[id].count += 1;
        counts[id].voters.push(mid);
      });
    });
    const rows = Object.entries(counts)
      .map(([id, c]) => ({ album: albumById[id], id, ...c }))
      .filter((r) => r.album)
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        const ya = a.album.year || 9999, yb = b.album.year || 9999;
        if (ya !== yb) return ya - yb;
        return (a.album.artist || "").localeCompare(b.album.artist || "");
      });
    // rank + boundary tie flag for top 5
    let rank = 0, lastCount = null, shown = 0;
    rows.forEach((r) => {
      shown += 1;
      if (r.count !== lastCount) { rank = shown; lastCount = r.count; }
      r.rank = rank;
    });
    const boundaryTie = rows.filter((r) => r.rank === (rows[4] ? rows[4].rank : -1)).length > 1 && rows.length > 5;
    return { rows, boundaryTie };
  }, [votes, albumById]);

  const votedCount = useMemo(
    () => MEMBERS.filter((m) => (votes[m.id]?.picks?.length || 0) === PICKS_REQUIRED).length,
    [votes]
  );

  /* ---------- add album ---------- */
  const addAlbum = useCallback(
    async (artist, album, year, coverUrl) => {
      artist = (artist || "").trim();
      album = (album || "").trim();
      if (!artist || !album) { flash("צריך גם אמן וגם שם אלבום"); return false; }
      if (existingKeys.has(albumKey(artist, album))) { flash("האלבום כבר ברשימה"); return false; }
      const entry = {
        id: "u" + Date.now() + Math.floor(Math.random() * 1000),
        artist, album,
        year: year ? Number(year) : null,
        addedBy: me,
        coverUrl: coverUrl || bingCoverUrl(artist, album),
      };
      const ok = await insertAlbum(entry);
      if (ok) { await refresh(); flash("נוסף: " + artist + " – " + album); return true; }
      flash("שמירה נכשלה, נסה שוב");
      return false;
    },
    [me, flash, existingKeys, refresh]
  );

  /* ---------- delete a user-added album (nominate phase only) ---------- */
  const deleteAlbum = useCallback(
    async (id) => {
      const target = albums.find((a) => a.id === id);
      const ok = await removeAlbum(id);
      if (ok) { await refresh(); flash(target ? "נמחק: " + target.artist + " – " + target.album : "נמחק"); }
      else flash("מחיקה נכשלה, נסה שוב");
    },
    [albums, refresh, flash]
  );

  /* ---------- save ballot (locked once submitted — see Ballot component) ---------- */
  const saveVote = useCallback(
    async (picks) => {
      if ((votes[me]?.picks?.length || 0) === PICKS_REQUIRED) {
        flash("ההצבעה שלך כבר ננעלה");
        return false;
      }
      const ok = await saveBallot(me, picks);
      if (ok) {
        await refresh();
        flash("ההצבעה נשמרה ונעולה");
        return true;
      }
      flash("שמירה נכשלה, נסה שוב");
      return false;
    },
    [me, votes, flash, refresh]
  );

  /* ---------- admin actions (confirmation handled inline in AdminBar) ---------- */
  const openVoting = useCallback(async () => {
    const ok = await dbSetPhase("vote");
    if (ok) { await refresh(); flash("ההצבעה נפתחה"); }
    else flash("הפעולה נכשלה");
  }, [flash, refresh]);
  const reopenNoms = useCallback(async () => {
    const ok = await dbSetPhase("nominate");
    if (ok) { await refresh(); flash("חזרה לשלב הצעות"); }
    else flash("הפעולה נכשלה");
  }, [flash, refresh]);
  const resetAll = useCallback(async () => {
    await dbResetAll();
    await refresh();
    flash("אופס הכל");
  }, [refresh, flash]);

  if (!booted) {
    return (
      <div className="wrap center">
        <Style />
        <div className="loading">טוען את הרשימה…</div>
      </div>
    );
  }

  return (
    <div className="wrap" dir="rtl">
      <Style />
      <div className="grain" aria-hidden="true" />

      <Nav
        me={me}
        phase={phase}
        view={view}
        setView={setView}
        setMe={setMe}
        admin={admin}
      />

      <main className="main">
        {view === "home" && (
          <Home
            me={me}
            setMe={setMe}
            setView={setView}
            phase={phase}
            votes={votes}
            added={addedAlbums}
            total={allAlbums.length}
            votedCount={votedCount}
          />
        )}

        {view === "list" && me && phase === "nominate" && (
          <Nominate
            me={me}
            albums={allAlbums}
            addAlbum={addAlbum}
            deleteAlbum={deleteAlbum}
            existingKeys={existingKeys}
          />
        )}

        {view === "list" && me && phase === "vote" && (
          <Ballot
            me={me}
            albums={allAlbums}
            initial={votes[me]?.picks || []}
            saveVote={saveVote}
          />
        )}

        {view === "list" && !me && (
          <EmptyPrompt setView={setView} />
        )}

        {view === "results" && (
          <Results tally={tally} phase={phase} votedCount={votedCount} votes={votes} />
        )}
      </main>

      <AdminBar
        admin={admin}
        setAdmin={setAdmin}
        phase={phase}
        openVoting={openVoting}
        reopenNoms={reopenNoms}
        resetAll={resetAll}
        flash={flash}
      />

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* ============================================================ NAV */
function Nav({ me, phase, view, setView, setMe, admin }) {
  return (
    <header className="nav">
      <button className="brand" onClick={() => setView("home")}>
        <span className="brand-mark">◈</span>
        <span className="brand-word">החבורה</span>
      </button>
      <nav className="nav-links">
        <button className={"navlink " + (view === "home" ? "on" : "")} onClick={() => setView("home")}>בית</button>
        <button className={"navlink " + (view === "list" ? "on" : "")} onClick={() => setView("list")}>
          {phase === "vote" ? "הצבעה" : "הרשימה"}
        </button>
        <button className={"navlink " + (view === "results" ? "on" : "")} onClick={() => setView("results")}>תוצאות</button>
      </nav>
      <div className="nav-me">
        {me ? (
          <>
            <span className="me-name">{memberName(me)}</span>
            <button className="me-swap" onClick={() => { setMe(null); setView("home"); }}>החלף</button>
          </>
        ) : (
          <span className="me-name muted">מי אתה?</span>
        )}
      </div>
    </header>
  );
}

/* ============================================================ HOME */
function Home({ me, setMe, setView, phase, votes, added, total, votedCount }) {
  const enter = (id) => {
    setMe(id);
    setView("list");
  };
  return (
    <section className="home">
      <div className="masthead">
        <div className="eyebrow">
          {phase === "vote" ? "ההצבעה פתוחה" : "שלב ההצעות"} · {total} אלבומים
        </div>
        <h1 className="hero">
          <span className="hero-l1">חמשת האלבומים</span>
          <span className="hero-l2">החשובים בתולדות</span>
          <span className="hero-l3">החבורה</span>
        </h1>
        <p className="dek">
          {phase === "vote"
            ? "הרשימה נעולה. כל אחד בוחר בדיוק עשרה. בסוף — הספירה הגדולה."
            : "בונים את הרשימה יחד. כל אחד מוסיף אלבומים שחסרים, ואז המנהל פותח להצבעה."}
        </p>
      </div>

      <div className="whoblock">
        <div className="who-h">מי מהחבורה אתה?</div>
        <div className="members">
          {MEMBERS.map((m) => {
            const picks = votes[m.id]?.picks?.length || 0;
            const done = picks === PICKS_REQUIRED;
            return (
              <button
                key={m.id}
                className={"member " + (me === m.id ? "active " : "") + (done && phase === "vote" ? "done" : "")}
                onClick={() => enter(m.id)}
              >
                <span className="member-name">{m.name}</span>
                <span className="member-meta">
                  {phase === "vote"
                    ? done
                      ? "✓ הצביע"
                      : picks > 0
                      ? picks + "/10 טיוטה"
                      : "טרם הצביע"
                    : "כניסה →"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="home-stats">
        {phase === "vote" ? (
          <>
            <Stat n={votedCount + "/6"} label="הצביעו" />
            <Stat n={total} label="אלבומים במרוץ" />
            <button className="btn btn-pink btn-lg" onClick={() => setView("results")}>לספירה הגדולה →</button>
          </>
        ) : (
          <>
            <Stat n={total} label="אלבומים ברשימה" />
            <Stat n={added.length} label="נוספו ע״י החבורה" />
            <span className="hint">ההצבעה תיפתח כשהמנהל ינעל את הרשימה.</span>
          </>
        )}
      </div>
    </section>
  );
}
function Stat({ n, label }) {
  return (
    <div className="stat">
      <div className="stat-n">{n}</div>
      <div className="stat-l">{label}</div>
    </div>
  );
}
function EmptyPrompt({ setView }) {
  return (
    <div className="empty">
      <p>בחר קודם מי אתה.</p>
      <button className="btn btn-blue" onClick={() => setView("home")}>לבחירת שם →</button>
    </div>
  );
}

/* ============================================================ ADD ALBUM (search-first, manual fallback) */
function AddAlbumPanel({ addAlbum, existingKeys }) {
  const [mode, setMode] = useState("search"); // search | manual
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const reqId = useRef(0);

  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [year, setYear] = useState("");

  useEffect(() => {
    if (mode !== "search") return;
    const term = q.trim();
    // dropdown only renders when term.length >= 2, so stale state below is harmless
    if (term.length < 2) return;
    setLoading(true);
    setSearchError(false);
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        const r = await searchAlbums(term);
        if (reqId.current === id) { setResults(r); setLoading(false); }
      } catch (e) {
        if (reqId.current === id) { setSearchError(true); setLoading(false); }
      }
    }, 400);
    return () => clearTimeout(t);
  }, [q, mode]);

  const pick = async (r) => {
    const ok = await addAlbum(r.artist, r.album, r.year, coverArtUrl(r.id));
    if (ok) { setQ(""); setResults([]); }
  };

  const dup = artist.trim() && album.trim() &&
    existingKeys.has(norm(artist) + " :: " + norm(album));
  const submitManual = async () => {
    const ok = await addAlbum(artist, album, year);
    if (ok) { setArtist(""); setAlbum(""); setYear(""); }
  };

  if (mode === "manual") {
    return (
      <div className="add-panel">
        <div className="panel-title">הוספת אלבום ידנית</div>
        <div className="add-grid">
          <input className="inp" placeholder="אמן / להקה" value={artist} dir="auto"
            onChange={(e) => setArtist(e.target.value)} />
          <input className="inp" placeholder="שם האלבום" value={album} dir="auto"
            onChange={(e) => setAlbum(e.target.value)} />
          <input className="inp inp-year" placeholder="שנה" value={year} inputMode="numeric"
            onChange={(e) => setYear(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))} />
          <button className="btn btn-pink" disabled={!artist.trim() || !album.trim() || dup} onClick={submitManual}>
            הוסף
          </button>
        </div>
        {dup && <div className="warn">האלבום הזה כבר ברשימה.</div>}
        <div className="add-note">העטיפה תיטען אוטומטית לפי האמן והאלבום.</div>
        <button className="mb-switch" onClick={() => setMode("search")}>← חזרה לחיפוש</button>
      </div>
    );
  }

  return (
    <div className="add-panel">
      <div className="panel-title">הוספת אלבום לרשימה</div>
      <div className="mb-search-wrap">
        <input className="inp" placeholder="חפש לפי אמן ואלבום… (למשל: Pixies Doolittle)" value={q} dir="auto"
          onChange={(e) => setQ(e.target.value)} />
        {q.trim().length >= 2 && (
          <div className="mb-results">
            {loading && <div className="mb-hint">מחפש…</div>}
            {!loading && searchError && <div className="mb-hint">החיפוש נכשל. נסה שוב או הוסף ידנית.</div>}
            {!loading && !searchError && results.length === 0 && (
              <div className="mb-hint">לא נמצא. נסו ניסוח אחר או הוספה ידנית.</div>
            )}
            {!loading && results.map((r) => {
              const already = existingKeys.has(albumKey(r.artist, r.album));
              return (
                <button key={r.id} className="mb-result" disabled={already} onClick={() => pick(r)}>
                  <Cover artist={r.artist} album={r.album} coverUrl={coverArtUrl(r.id)} size="mini" />
                  <div className="mb-result-meta">
                    <span className="mb-result-artist" dir="auto">{r.artist}</span>
                    <span className="mb-result-album" dir="auto">{r.album}{r.year ? " · " + r.year : ""}</span>
                    {already && <span className="mb-result-dup">כבר ברשימה</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="add-note">חיפוש מול מאגר MusicBrainz. אלבומים מהרשימה המקורית קבועים; אלבומים שנוספו אפשר למחוק, כל עוד ההצבעה לא נפתחה.</div>
      <button className="mb-switch" onClick={() => setMode("manual")}>לא מוצאים? הוספה ידנית →</button>
    </div>
  );
}

/* ============================================================ NOMINATE */
function Nominate({ me, albums, addAlbum, deleteAlbum, existingKeys }) {
  const [q, setQ] = useState("");
  const [confirmId, setConfirmId] = useState(null); // album pending delete-confirm

  const filtered = useMemo(() => {
    const t = norm(q);
    if (!t) return albums;
    return albums.filter((a) => norm(a.artist + " " + a.album).includes(t));
  }, [q, albums]);

  return (
    <section className="nominate">
      <AddAlbumPanel addAlbum={addAlbum} existingKeys={existingKeys} />

      <div className="list-toolbar">
        <input className="inp search" placeholder="חיפוש ברשימה…" value={q} dir="auto"
          onChange={(e) => setQ(e.target.value)} />
        <span className="count">{filtered.length} אלבומים</span>
      </div>

      <div className="grid">
        {filtered.map((a) => (
          <div key={a.id} className={"acard " + (a.source === "added" ? "is-added" : "")}>
            <Cover artist={a.artist} album={a.album} coverUrl={a.cover_url} />
            {a.source === "added" && confirmId !== a.id && (
              <button className="del-x" title="מחק אלבום" aria-label="מחק אלבום"
                onClick={() => setConfirmId(a.id)}>×</button>
            )}
            {a.source === "added" && confirmId === a.id && (
              <div className="del-confirm">
                <span className="dc-q">למחוק?</span>
                <button className="dc-yes" onClick={async () => { await deleteAlbum(a.id); setConfirmId(null); }}>מחק</button>
                <button className="dc-no" onClick={() => setConfirmId(null)}>ביטול</button>
              </div>
            )}
            <div className="ameta">
              <div className="a-artist" dir="auto">{a.artist}</div>
              <div className="a-album" dir="auto">{a.album}</div>
              <div className="a-sub">
                <span>{a.year || ""}</span>
                {a.source === "added" && <span className="tag">נוסף · {memberName(a.added_by)}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ============================================================ BALLOT */
function Ballot({ me, albums, initial, saveVote }) {
  const locked = initial.length === PICKS_REQUIRED;
  const [picks, setPicks] = useState(() => new Set(initial));
  const [q, setQ] = useState("");
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirty = useMemo(() => {
    const a = [...picks].sort().join(",");
    const b = [...initial].sort().join(",");
    return a !== b;
  }, [picks, initial]);

  const toggle = (id) => {
    if (locked) return;
    setPicks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        if (next.size >= PICKS_REQUIRED) return prev;
        next.add(id);
      }
      return next;
    });
  };

  const count = picks.size;
  const canSave = !locked && !saving && count === PICKS_REQUIRED && dirty;

  const handleSave = async () => {
    setSaving(true);
    await saveVote([...picks]);
    setSaving(false);
  };

  const filtered = useMemo(() => {
    const t = norm(q);
    let list = albums;
    if (t) list = list.filter((a) => norm(a.artist + " " + a.album).includes(t));
    if (onlyPicked) list = list.filter((a) => picks.has(a.id));
    return list;
  }, [q, albums, onlyPicked, picks]);

  return (
    <section className="ballot">
      <div className="ballot-bar">
        <div className="bb-count">
          <span className={"bb-num " + (count === PICKS_REQUIRED ? "full" : "")}>{count}</span>
          <span className="bb-of">/ {PICKS_REQUIRED}</span>
          <span className="bb-label">
            {locked
              ? "ההצבעה שלך ננעלה — לא ניתן לשנות"
              : count === PICKS_REQUIRED
              ? "העשירייה שלך מוכנה"
              : "בחר עשרה אלבומים"}
          </span>
        </div>
        <div className="bb-actions">
          <button className={"chip " + (onlyPicked ? "on" : "")} onClick={() => setOnlyPicked((v) => !v)}>
            {onlyPicked ? "כל האלבומים" : "רק שבחרתי"}
          </button>
          {!locked && (
            <button className="btn btn-pink" disabled={!canSave} onClick={handleSave}>
              {saving ? "שומר…" : dirty ? "שמור הצבעה" : "נשמר"}
            </button>
          )}
        </div>
      </div>

      <div className="list-toolbar">
        <input className="inp search" placeholder="חיפוש…" value={q} dir="auto"
          onChange={(e) => setQ(e.target.value)} />
        <span className="count">{filtered.length} אלבומים</span>
      </div>

      <div className="grid">
        {filtered.map((a) => {
          const sel = picks.has(a.id);
          return (
            <button
              key={a.id}
              className={"acard pick " + (sel ? "sel" : "")}
              onClick={() => toggle(a.id)}
              aria-pressed={sel}
              aria-disabled={locked}
            >
              <Cover artist={a.artist} album={a.album} coverUrl={a.cover_url} />
              {sel && <span className="check">✓</span>}
              <div className="ameta">
                <div className="a-artist" dir="auto">{a.artist}</div>
                <div className="a-album" dir="auto">{a.album}</div>
                <div className="a-sub"><span>{a.year || ""}</span></div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ============================================================ RESULTS */
function Results({ tally, phase, votedCount, votes }) {
  const { rows, boundaryTie } = tally;
  if (phase !== "vote") {
    return (
      <section className="results">
        <div className="res-locked">
          <div className="rl-title">הספירה עדיין סגורה</div>
          <p>התוצאות ייחשפו כשההצבעה תיפתח. בינתיים בונים את הרשימה.</p>
        </div>
      </section>
    );
  }
  if (rows.length === 0) {
    return (
      <section className="results">
        <div className="res-locked">
          <div className="rl-title">אין עדיין הצבעות</div>
          <p>{votedCount}/6 הצביעו. ברגע שמישהו שומר עשירייה, הספירה מתחילה.</p>
        </div>
      </section>
    );
  }
  const top5 = rows.slice(0, 5);
  const rest = rows.slice(5);
  return (
    <section className="results">
      <div className="res-head">
        <div className="eyebrow">הספירה הגדולה</div>
        <h2 className="res-title">חמשת החשובים</h2>
        <div className="res-progress">{votedCount}/6 מהחבורה הצביעו</div>
        {votedCount < 6 && <div className="res-warn">הספירה חיה — עוד לא כולם הצביעו.</div>}
        {boundaryTie && <div className="res-warn">יש תיקו סביב מקום 5 — צריך שובר שוויון ידני.</div>}
      </div>

      <ol className="top5">
        {top5.map((r) => (
          <li key={r.id} className="crown">
            <div className="rank">
              <span className="rank-ghost">{r.rank}</span>
              <span className="rank-fore">{r.rank}</span>
            </div>
            <Cover artist={r.album.artist} album={r.album.album} coverUrl={r.album.cover_url} size="big" />
            <div className="crown-meta">
              <div className="c-artist" dir="auto">{r.album.artist}</div>
              <div className="c-album" dir="auto">{r.album.album}</div>
              <div className="c-year">{r.album.year || ""}</div>
              <Voters ids={r.voters} count={r.count} />
            </div>
          </li>
        ))}
      </ol>

      {rest.length > 0 && (
        <>
          <div className="rest-h">שאר הרשימה</div>
          <ol className="restlist">
            {rest.map((r) => (
              <li key={r.id} className="rrow">
                <span className="rrank">{r.rank}</span>
                <Cover artist={r.album.artist} album={r.album.album} coverUrl={r.album.cover_url} size="mini" />
                <div className="rmeta">
                  <span className="r-artist" dir="auto">{r.album.artist}</span>
                  <span className="r-album" dir="auto">{r.album.album}</span>
                </div>
                <Voters ids={r.voters} count={r.count} compact />
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
function Voters({ ids, count, compact }) {
  return (
    <div className={"voters " + (compact ? "compact" : "")}>
      <span className="v-count">{count} {count === 1 ? "קול" : "קולות"}</span>
      <span className="v-names">{ids.map(memberName).join(" · ")}</span>
    </div>
  );
}

/* ============================================================ ADMIN */
function AdminBar({ admin, setAdmin, phase, openVoting, reopenNoms, resetAll, flash }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pending, setPending] = useState(null); // {q, yes, run}
  const tryUnlock = () => {
    if (pin === ADMIN_PIN) { setAdmin(true); setOpen(false); setPin(""); flash("מצב מנהל פעיל"); }
    else flash("קוד שגוי");
  };
  return (
    <footer className="adminbar">
      {!admin ? (
        !open ? (
          <button className="admin-toggle" onClick={() => setOpen(true)}>מנהל</button>
        ) : (
          <div className="admin-unlock">
            <input className="inp inp-pin" type="password" placeholder="קוד מנהל" value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && tryUnlock()} />
            <button className="btn btn-blue" onClick={tryUnlock}>כניסה</button>
            <button className="btn btn-ghost" onClick={() => { setOpen(false); setPin(""); }}>ביטול</button>
          </div>
        )
      ) : pending ? (
        <div className="admin-panel confirm">
          <span className="admin-q">{pending.q}</span>
          <button className="btn btn-pink" onClick={async () => { const p = pending; setPending(null); await p.run(); }}>{pending.yes}</button>
          <button className="btn btn-ghost" onClick={() => setPending(null)}>ביטול</button>
        </div>
      ) : (
        <div className="admin-panel">
          <span className="admin-tag">מנהל</span>
          {phase === "nominate" ? (
            <button className="btn btn-pink" onClick={() => setPending({
              q: "לפתוח הצבעה? הרשימה תינעל ולא יהיה אפשר להוסיף או למחוק.",
              yes: "פתח הצבעה", run: openVoting })}>פתח הצבעה — נעל את הרשימה</button>
          ) : (
            <button className="btn btn-ghost" onClick={() => setPending({
              q: "להחזיר לשלב הצעות? ההצבעות נשמרות, אבל שינוי הרשימה משנה את מה שכבר הצביעו עליו.",
              yes: "החזר להצעות", run: reopenNoms })}>החזר לשלב הצעות</button>
          )}
          <button className="btn btn-ghost danger" onClick={() => setPending({
            q: "לאפס הכל? מחיקת כל ההצבעות וכל האלבומים שנוספו. אין חזרה.",
            yes: "אפס הכל", run: resetAll })}>אפס הכל</button>
          <button className="btn btn-ghost" onClick={() => setAdmin(false)}>יציאה</button>
        </div>
      )}
    </footer>
  );
}

/* ============================================================ STYLE */
function Style() {
  return (
    <style dangerouslySetInnerHTML={{ __html: CSS }} />
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Suez+One&family=Heebo:wght@400;500;700;900&display=swap');

:root{
  --paper:#e7e3d6; --paper2:#f1ede1; --ink:#17130f; --ink2:#4a4335;
  --pink:#fa4d3c; --blue:#2b41c4; --line:rgba(23,19,15,.16);
}
*{box-sizing:border-box}
.wrap{
  position:relative; min-height:100vh; background:var(--paper); color:var(--ink);
  font-family:'Heebo',system-ui,Arial,sans-serif; overflow-x:hidden;
  -webkit-font-smoothing:antialiased;
}
.wrap.center{display:flex;align-items:center;justify-content:center}
.loading{font-family:'Suez One',serif;font-size:22px;letter-spacing:.02em}
.grain{position:fixed;inset:0;pointer-events:none;z-index:1;opacity:.5;mix-blend-mode:multiply;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.35'/%3E%3C/svg%3E");}
.main{position:relative;z-index:2;max-width:1120px;margin:0 auto;padding:22px 20px 120px}

/* nav */
.nav{position:relative;z-index:3;max-width:1120px;margin:0 auto;padding:16px 20px 10px;
  display:flex;align-items:center;gap:14px;border-bottom:2px solid var(--ink);flex-wrap:wrap}
.brand{background:none;border:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:0}
.brand-mark{color:var(--pink);font-size:20px;line-height:1}
.brand-word{font-family:'Suez One',serif;font-size:26px;color:var(--ink);letter-spacing:.01em}
.nav-links{display:flex;gap:4px;margin-inline-start:6px}
.navlink{background:none;border:none;cursor:pointer;font-family:'Heebo';font-weight:700;font-size:14px;
  color:var(--ink2);padding:6px 10px;border-radius:2px}
.navlink:hover{color:var(--ink)}
.navlink.on{color:var(--ink);box-shadow:inset 0 -3px 0 var(--pink)}
.nav-me{margin-inline-start:auto;display:flex;align-items:center;gap:8px}
.me-name{font-weight:700;font-size:14px}
.me-name.muted{color:var(--ink2)}
.me-swap{background:none;border:1px solid var(--line);border-radius:2px;cursor:pointer;
  font-family:'Heebo';font-size:12px;padding:4px 8px;color:var(--ink2)}
.me-swap:hover{border-color:var(--ink);color:var(--ink)}

/* home */
.masthead{padding:26px 0 8px;border-bottom:1px dashed var(--line);margin-bottom:26px}
.eyebrow{font-weight:700;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--blue)}
.hero{font-family:'Suez One',serif;line-height:.92;margin:14px 0 0;letter-spacing:-.01em;
  display:flex;flex-direction:column}
.hero-l1{font-size:clamp(34px,8vw,74px)}
.hero-l2{font-size:clamp(34px,8vw,74px)}
.hero-l3{font-size:clamp(52px,13vw,120px);color:var(--pink);
  text-shadow:3px 3px 0 var(--blue)}
.dek{font-size:clamp(15px,2.2vw,19px);max-width:46ch;margin:18px 0 4px;color:var(--ink2);font-weight:500;line-height:1.5}

.whoblock{margin:8px 0 26px}
.who-h{font-family:'Suez One',serif;font-size:22px;margin-bottom:12px}
.members{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.member{cursor:pointer;text-align:start;background:var(--paper2);border:2px solid var(--ink);
  border-radius:3px;padding:16px 16px;transition:transform .12s ease, box-shadow .12s ease;
  box-shadow:4px 4px 0 rgba(23,19,15,.12)}
.member:hover{transform:translate(-2px,-2px);box-shadow:6px 6px 0 var(--blue)}
.member.active{box-shadow:6px 6px 0 var(--pink)}
.member.done{background:#eef3ea}
.member-name{display:block;font-family:'Suez One',serif;font-size:26px;line-height:1}
.member-meta{display:block;margin-top:8px;font-size:13px;font-weight:700;color:var(--ink2)}
.member.done .member-meta{color:var(--blue)}

.home-stats{display:flex;align-items:center;gap:26px;flex-wrap:wrap;padding-top:18px;border-top:2px solid var(--ink)}
.stat-n{font-family:'Suez One',serif;font-size:40px;line-height:1;color:var(--pink)}
.stat-l{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ink2);margin-top:4px}
.hint{font-size:14px;color:var(--ink2);font-weight:500}

/* buttons */
.btn{cursor:pointer;font-family:'Heebo';font-weight:700;font-size:14px;border:2px solid var(--ink);
  border-radius:3px;padding:9px 16px;background:var(--paper2);color:var(--ink);transition:transform .1s, box-shadow .1s}
.btn:hover{transform:translate(-1px,-1px);box-shadow:3px 3px 0 var(--ink)}
.btn:disabled{opacity:.4;cursor:not-allowed;transform:none;box-shadow:none}
.btn-pink{background:var(--pink);color:#fff;border-color:var(--ink)}
.btn-pink:hover{box-shadow:3px 3px 0 var(--blue)}
.btn-blue{background:var(--blue);color:#fff}
.btn-ghost{background:transparent}
.btn-ghost.danger{color:var(--pink);border-color:var(--pink)}
.btn-lg{font-size:16px;padding:12px 22px}
.empty{padding:60px 0;text-align:center}
.empty p{font-family:'Suez One',serif;font-size:24px;margin-bottom:16px}

/* toolbar + inputs */
.list-toolbar{display:flex;align-items:center;gap:12px;margin:18px 0 14px;flex-wrap:wrap}
.inp{font-family:'Heebo';font-size:15px;padding:10px 12px;border:2px solid var(--ink);border-radius:3px;
  background:var(--paper2);color:var(--ink);min-width:0}
.inp:focus{outline:none;box-shadow:3px 3px 0 var(--blue)}
.search{flex:1;min-width:180px}
.count{font-size:13px;font-weight:700;color:var(--ink2)}

/* add panel */
.add-panel{border:2px solid var(--ink);border-radius:4px;background:var(--paper2);padding:16px;margin-bottom:8px;
  box-shadow:5px 5px 0 rgba(23,19,15,.1)}
.panel-title{font-family:'Suez One',serif;font-size:20px;margin-bottom:12px}
.add-grid{display:grid;grid-template-columns:1fr 1fr 90px auto;gap:10px}
.inp-year{text-align:center}
.warn{margin-top:10px;color:var(--pink);font-weight:700;font-size:14px}
.add-note{margin-top:10px;font-size:13px;color:var(--ink2)}
.mb-search-wrap{position:relative}
.mb-results{position:absolute;inset-inline:0;top:calc(100% - 2px);z-index:6;border:2px solid var(--ink);
  border-top:none;border-radius:0 0 4px 4px;background:var(--paper2);max-height:340px;overflow-y:auto;
  box-shadow:5px 5px 0 rgba(23,19,15,.1)}
.mb-result{display:flex;align-items:center;gap:10px;padding:8px 10px;cursor:pointer;
  background:none;border:none;border-top:1px solid var(--line);width:100%;text-align:start;font-family:'Heebo'}
.mb-result:hover:not(:disabled){background:#fff}
.mb-result:disabled{opacity:.5;cursor:not-allowed}
.mb-result .cover{width:40px;flex:none;border:1.5px solid var(--ink)}
.mb-result-meta{display:flex;flex-direction:column;min-width:0}
.mb-result-artist{font-size:12px;font-weight:700;color:var(--ink2)}
.mb-result-album{font-family:'Suez One',serif;font-size:15px;line-height:1.1}
.mb-result-dup{font-size:11px;color:var(--pink);font-weight:700}
.mb-hint{padding:10px;font-size:13px;color:var(--ink2)}
.mb-switch{background:none;border:none;cursor:pointer;color:var(--blue);font-weight:700;font-size:13px;
  padding:0;margin-top:10px;display:block;font-family:'Heebo'}
.mb-switch:hover{text-decoration:underline}

/* album grid */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px}
.acard{background:var(--paper2);border:2px solid var(--ink);border-radius:3px;padding:0;overflow:hidden;
  text-align:start;position:relative;transition:transform .12s, box-shadow .12s}
.acard.is-added{border-color:var(--blue)}
button.acard{cursor:pointer;font-family:'Heebo';color:var(--ink);width:100%}
.acard.pick:hover{transform:translate(-2px,-2px);box-shadow:5px 5px 0 var(--ink)}
.acard.sel{box-shadow:5px 5px 0 var(--pink);border-color:var(--pink);background:#fff}
.check{position:absolute;top:8px;inset-inline-end:8px;background:var(--pink);color:#fff;
  width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-weight:900;border:2px solid var(--ink);z-index:2}
.del-x{position:absolute;top:6px;inset-inline-end:6px;z-index:3;cursor:pointer;
  width:26px;height:26px;line-height:1;border-radius:50%;border:2px solid var(--ink);
  background:var(--paper2);color:var(--ink);font-size:18px;font-weight:900;
  display:flex;align-items:center;justify-content:center;padding:0}
.del-x:hover{background:var(--pink);color:#fff}
.del-confirm{position:absolute;top:6px;inset-inline:6px;z-index:4;display:flex;gap:6px;align-items:center;
  justify-content:center;background:var(--ink);border-radius:4px;padding:6px 8px}
.dc-q{color:var(--paper);font-weight:700;font-size:12px;margin-inline-end:2px}
.dc-yes,.dc-no{cursor:pointer;border:none;border-radius:3px;font-family:'Heebo';font-weight:700;font-size:12px;padding:5px 9px}
.dc-yes{background:var(--pink);color:#fff}
.dc-no{background:var(--paper2);color:var(--ink)}
.admin-panel.confirm{gap:10px}
.admin-q{font-weight:700;font-size:13px;max-width:44ch;line-height:1.3}
.cover{aspect-ratio:1/1;position:relative;overflow:hidden;background:#201b16}
.cover-tile{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:6px;padding:12px;text-align:center;color:#e7e3d6;
  background:repeating-linear-gradient(45deg,#201b16,#201b16 6px,#2a241d 6px,#2a241d 12px)}
.cover-tile::after{content:"◈";position:absolute;top:8px;inset-inline-start:8px;font-size:11px;color:var(--pink);opacity:.8}
.cover-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;
  opacity:0;transition:opacity .2s ease}
.cover-img.shown{opacity:1}
.fb-artist{font-family:'Suez One',serif;font-size:15px;line-height:1.1}
.fb-album{font-size:12px;opacity:.85;line-height:1.2}
.ameta{padding:10px 11px 12px}
.a-artist{font-weight:700;font-size:13px;line-height:1.2}
.a-album{font-family:'Suez One',serif;font-size:16px;line-height:1.05;margin-top:2px}
.a-sub{display:flex;gap:8px;align-items:center;margin-top:6px;font-size:12px;color:var(--ink2);flex-wrap:wrap}
.tag{background:var(--blue);color:#fff;padding:1px 6px;border-radius:2px;font-weight:700;font-size:11px}

/* ballot bar */
.ballot-bar{position:sticky;top:0;z-index:5;background:var(--paper);border-bottom:2px solid var(--ink);
  padding:12px 4px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:6px}
.bb-count{display:flex;align-items:baseline;gap:6px}
.bb-num{font-family:'Suez One',serif;font-size:38px;line-height:1;color:var(--ink)}
.bb-num.full{color:var(--pink)}
.bb-of{font-family:'Suez One',serif;font-size:20px;color:var(--ink2)}
.bb-label{margin-inline-start:10px;font-size:14px;font-weight:700;color:var(--ink2)}
.bb-actions{display:flex;gap:8px;align-items:center}
.chip{cursor:pointer;font-family:'Heebo';font-weight:700;font-size:13px;border:2px solid var(--ink);
  background:var(--paper2);border-radius:20px;padding:6px 12px;color:var(--ink)}
.chip.on{background:var(--ink);color:var(--paper)}

/* results */
.res-locked{text-align:center;padding:70px 0}
.rl-title{font-family:'Suez One',serif;font-size:30px}
.res-locked p{color:var(--ink2);margin-top:10px;font-weight:500}
.res-head{padding:8px 0 6px;border-bottom:2px solid var(--ink);margin-bottom:26px}
.res-title{font-family:'Suez One',serif;font-size:clamp(40px,9vw,84px);line-height:.95;color:var(--pink);
  text-shadow:3px 3px 0 var(--blue);margin:6px 0}
.res-progress{font-weight:700;font-size:14px}
.res-warn{color:var(--blue);font-weight:700;font-size:14px;margin-top:6px}

.top5{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:18px}
.crown{display:grid;grid-template-columns:auto 120px 1fr;gap:18px;align-items:center;
  border-bottom:1px dashed var(--line);padding-bottom:18px}
.rank{position:relative;width:clamp(64px,11vw,120px);text-align:center}
.rank-ghost,.rank-fore{font-family:'Suez One',serif;font-size:clamp(64px,12vw,128px);line-height:.8;display:block}
.rank-ghost{position:absolute;inset:0;color:var(--blue);transform:translate(4px,4px)}
.rank-fore{position:relative;color:var(--pink)}
.crown .cover{width:120px;border:2px solid var(--ink)}
.crown-meta{min-width:0}
.c-artist{font-weight:700;font-size:15px;color:var(--ink2)}
.c-album{font-family:'Suez One',serif;font-size:clamp(22px,4vw,34px);line-height:1.02}
.c-year{font-size:13px;color:var(--ink2);margin-top:2px}
.voters{margin-top:8px;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.v-count{font-weight:900;color:var(--pink);font-size:15px}
.v-names{font-size:13px;color:var(--ink2)}
.voters.compact{margin-top:0}

.rest-h{font-family:'Suez One',serif;font-size:22px;margin:30px 0 12px;
  border-top:2px solid var(--ink);padding-top:16px}
.restlist{list-style:none;margin:0;padding:0}
.rrow{display:grid;grid-template-columns:44px 48px 1fr auto;gap:12px;align-items:center;
  padding:10px 0;border-bottom:1px solid var(--line)}
.rrank{font-family:'Suez One',serif;font-size:26px;color:var(--ink2);text-align:center}
.rrow .cover{width:48px;border:1.5px solid var(--ink)}
.rmeta{display:flex;flex-direction:column;min-width:0}
.r-artist{font-size:12px;color:var(--ink2);font-weight:700}
.r-album{font-family:'Suez One',serif;font-size:17px;line-height:1}

/* admin */
.adminbar{position:fixed;bottom:0;inset-inline:0;z-index:8;display:flex;justify-content:center;
  padding:10px;pointer-events:none}
.admin-toggle,.admin-unlock,.admin-panel{pointer-events:auto}
.admin-toggle{background:var(--ink);color:var(--paper);border:none;border-radius:20px;
  font-family:'Heebo';font-weight:700;font-size:12px;padding:7px 16px;cursor:pointer;opacity:.85}
.admin-toggle:hover{opacity:1}
.admin-unlock,.admin-panel{display:flex;gap:8px;align-items:center;background:var(--paper2);
  border:2px solid var(--ink);border-radius:26px;padding:8px 12px;box-shadow:0 6px 20px rgba(0,0,0,.18);flex-wrap:wrap;justify-content:center}
.inp-pin{padding:7px 10px;width:120px}
.admin-tag{background:var(--pink);color:#fff;font-weight:900;font-size:11px;padding:3px 8px;border-radius:12px}

/* toast */
.toast{position:fixed;bottom:64px;inset-inline:0;margin:0 auto;z-index:20;width:max-content;max-width:90vw;
  background:var(--ink);color:var(--paper);font-weight:700;font-size:14px;padding:11px 20px;border-radius:4px;
  box-shadow:0 8px 24px rgba(0,0,0,.25)}

@media (max-width:640px){
  .members{grid-template-columns:1fr 1fr}
  .add-grid{grid-template-columns:1fr 1fr;gap:8px}
  .add-grid .btn{grid-column:1/-1}
  .inp-year{grid-column:auto}
  .crown{grid-template-columns:auto 84px 1fr;gap:12px}
  .crown .cover{width:84px}
}
@media (prefers-reduced-motion:reduce){
  *{transition:none!important}
}
`;
