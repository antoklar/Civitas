import { useState, useEffect, useRef, useCallback } from "react";

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --ink: #0f1923;
    --paper: #f4f1eb;
    --cream: #faf8f3;
    --accent: #b5371f;
    --accent-light: #f5ece9;
    --gold: #c9973a;
    --muted: #6e6860;
    --border: #ddd8ce;
    --card: #ffffff;
    --dem: #1a3f8f;
    --dem-bg: #edf2ff;
    --rep: #8f1a1a;
    --rep-bg: #fff0f0;
    --ind: #1a6b3a;
    --ind-bg: #edfff4;
  }

  html, body { height: 100%; }

  body {
    font-family: 'DM Sans', sans-serif;
    background: var(--paper);
    color: var(--ink);
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }

  .app { max-width: 900px; margin: 0 auto; padding: 0 24px 100px; }

  .header {
    padding: 56px 0 48px;
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: end;
    border-bottom: 1.5px solid var(--ink);
    margin-bottom: 52px;
    gap: 24px;
  }

  .brand-eyebrow {
    font-size: 0.68rem;
    letter-spacing: 4px;
    text-transform: uppercase;
    color: var(--accent);
    font-weight: 600;
    margin-bottom: 10px;
  }

  .brand-name {
    font-family: 'DM Serif Display', serif;
    font-size: clamp(3rem, 8vw, 5.5rem);
    line-height: 0.9;
    color: var(--ink);
    letter-spacing: -2px;
  }

  .brand-name em { font-style: italic; color: var(--accent); }

  .brand-tagline {
    margin-top: 16px;
    font-size: 0.95rem;
    color: var(--muted);
    font-weight: 300;
    line-height: 1.65;
    max-width: 400px;
  }

  .brand-version {
    writing-mode: vertical-rl;
    font-size: 0.65rem;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: var(--border);
    font-weight: 500;
    align-self: center;
  }

  .search-block { margin-bottom: 52px; }

  .search-label {
    font-family: 'DM Serif Display', serif;
    font-size: 1.6rem;
    margin-bottom: 8px;
  }

  .search-desc {
    font-size: 0.9rem;
    color: var(--muted);
    line-height: 1.6;
    margin-bottom: 20px;
    max-width: 520px;
  }

  .search-wrapper { position: relative; max-width: 580px; }

  .search-input {
    width: 100%;
    padding: 16px 100px 16px 20px;
    font-family: 'DM Sans', sans-serif;
    font-size: 1rem;
    border: 2px solid var(--ink);
    border-radius: 3px;
    background: var(--cream);
    color: var(--ink);
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .search-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-light);
  }

  .search-input::placeholder { color: var(--muted); font-weight: 300; }

  .search-btn {
    position: absolute;
    right: 6px; top: 50%;
    transform: translateY(-50%);
    background: var(--ink);
    color: var(--paper);
    border: none;
    border-radius: 2px;
    padding: 8px 14px;
    font-family: 'DM Sans', sans-serif;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }

  .search-btn:hover:not(:disabled) { background: var(--accent); }
  .search-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .autocomplete-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0; right: 0;
    background: var(--card);
    border: 2px solid var(--ink);
    border-radius: 3px;
    box-shadow: 4px 4px 0 rgba(15,25,35,0.15);
    z-index: 200;
    overflow: hidden;
  }

  .autocomplete-item {
    padding: 13px 18px;
    cursor: pointer;
    font-size: 0.88rem;
    border-bottom: 1px solid var(--border);
    transition: background 0.1s;
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .autocomplete-item:last-child { border-bottom: none; }
  .autocomplete-item:hover, .autocomplete-item.active { background: var(--accent-light); }

  .ac-icon { color: var(--accent); flex-shrink: 0; margin-top: 1px; }
  .ac-main { font-weight: 500; color: var(--ink); }
  .ac-secondary { font-size: 0.78rem; color: var(--muted); margin-top: 2px; }

  .ac-loading {
    padding: 14px 18px;
    font-size: 0.82rem;
    color: var(--muted);
    font-style: italic;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .ac-spinner {
    width: 14px; height: 14px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    flex-shrink: 0;
  }

  .search-hint {
    margin-top: 8px;
    font-size: 0.78rem;
    color: var(--muted);
    font-style: italic;
  }

  .loading {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 40px 0;
  }

  .loading-row {
    display: flex;
    align-items: center;
    gap: 14px;
    color: var(--muted);
    font-size: 0.9rem;
    font-style: italic;
  }

  .spinner {
    width: 20px; height: 20px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  .loading-note {
    font-size: 0.78rem;
    color: var(--border);
    font-style: italic;
    padding-left: 34px;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .error {
    background: var(--accent-light);
    border-left: 3px solid var(--accent);
    padding: 16px 20px;
    border-radius: 2px;
    font-size: 0.9rem;
    color: #6b1a0a;
    line-height: 1.5;
    max-width: 580px;
    margin-bottom: 24px;
  }

  .results-meta {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 8px;
    flex-wrap: wrap;
    gap: 8px;
  }

  .results-title {
    font-family: 'DM Serif Display', serif;
    font-size: 1.4rem;
  }

  .results-location {
    font-size: 0.75rem;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--accent);
    font-weight: 600;
  }

  .results-rule {
    border: none;
    border-top: 1.5px solid var(--ink);
    margin-bottom: 36px;
  }

  .level-group { margin-bottom: 44px; }

  .level-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
  }

  .level-label {
    font-size: 0.68rem;
    letter-spacing: 3.5px;
    text-transform: uppercase;
    font-weight: 600;
    color: var(--muted);
    white-space: nowrap;
  }

  .level-line { flex: 1; height: 1px; background: var(--border); }
  .level-count { font-size: 0.7rem; color: var(--border); font-weight: 500; }

  .rep-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 22px 24px;
    margin-bottom: 10px;
    display: grid;
    grid-template-columns: 52px 1fr auto;
    gap: 18px;
    align-items: start;
    transition: box-shadow 0.18s, transform 0.15s;
    position: relative;
    overflow: hidden;
  }

  .rep-card::before {
    content: '';
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 3px;
    background: var(--border);
  }

  .rep-card.party-dem::before { background: var(--dem); }
  .rep-card.party-rep::before { background: var(--rep); }
  .rep-card.party-ind::before { background: var(--ind); }

  .rep-card:hover {
    box-shadow: 3px 3px 0 rgba(15,25,35,0.1);
    transform: translate(-1px, -1px);
  }

  .rep-avatar {
    width: 48px; height: 48px;
    border-radius: 50%;
    background: var(--ink);
    color: var(--paper);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'DM Serif Display', serif;
    font-size: 1.1rem;
    flex-shrink: 0;
    overflow: hidden;
    border: 2px solid var(--border);
  }

  .rep-avatar img { width: 100%; height: 100%; object-fit: cover; }

  .rep-name {
    font-family: 'DM Serif Display', serif;
    font-size: 1.05rem;
    line-height: 1.2;
    margin-bottom: 3px;
  }

  .rep-office { font-size: 0.82rem; color: var(--muted); margin-bottom: 10px; line-height: 1.3; }

  .rep-party-badge {
    display: inline-block;
    font-size: 0.67rem;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 2px;
    margin-bottom: 10px;
  }

  .party-dem .rep-party-badge { background: var(--dem-bg); color: var(--dem); }
  .party-rep .rep-party-badge { background: var(--rep-bg); color: var(--rep); }
  .party-ind .rep-party-badge { background: var(--ind-bg); color: var(--ind); }
  .party-other .rep-party-badge { background: #f5f0e8; color: var(--gold); }

  .rep-links { display: flex; flex-wrap: wrap; gap: 10px; }

  .rep-link {
    font-size: 0.78rem;
    color: var(--accent);
    text-decoration: none;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 4px;
    transition: color 0.15s;
  }

  .rep-link:hover { color: var(--ink); }

  .rep-side {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 5px;
  }

  .soon-tag {
    font-size: 0.6rem;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--border);
    font-weight: 600;
    border: 1px solid var(--border);
    padding: 2px 7px;
    border-radius: 2px;
    white-space: nowrap;
    transition: color 0.2s, border-color 0.2s;
  }

  .rep-card:hover .soon-tag { color: var(--gold); border-color: var(--gold); }

  .empty-state {
    padding: 48px 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 16px;
  }

  .empty-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 22px 20px;
    position: relative;
    overflow: hidden;
  }

  .empty-card::after {
    content: '';
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 2px;
    background: linear-gradient(90deg, var(--accent), var(--gold));
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 0.3s;
  }

  .empty-card:hover::after { transform: scaleX(1); }
  .empty-icon { font-size: 1.5rem; margin-bottom: 10px; }

  .empty-card h3 {
    font-family: 'DM Serif Display', serif;
    font-size: 0.95rem;
    margin-bottom: 6px;
  }

  .empty-card p { font-size: 0.8rem; color: var(--muted); line-height: 1.55; }

  .footer {
    margin-top: 80px;
    padding-top: 24px;
    border-top: 1.5px solid var(--ink);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }

  .footer-brand { font-family: 'DM Serif Display', serif; font-size: 1.1rem; }
  .footer-note { font-size: 0.75rem; color: var(--muted); }

  @media (max-width: 600px) {
    .header { grid-template-columns: 1fr; }
    .brand-version { display: none; }
    .rep-card { grid-template-columns: 44px 1fr; }
    .rep-side { display: none; }
  }
`;

const LEVEL_MAP = {
  country: "Federal",
  administrativeArea1: "State",
  administrativeArea2: "Local",
  locality: "Local",
  subLocality1: "Local",
  subLocality2: "Local",
  special: "Local",
};

const LEVEL_ORDER = ["Federal", "State", "Local"];

function getPartyClass(party = "") {
  if (/democrat/i.test(party)) return "party-dem";
  if (/republican/i.test(party)) return "party-rep";
  if (/independent|nonpartisan/i.test(party)) return "party-ind";
  return "party-other";
}

function getInitials(name = "") {
  return name.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase();
}

function RepCard({ official, office }) {
  const partyClass = getPartyClass(official.party);
  return (
    <div className={`rep-card ${partyClass}`}>
      <div className="rep-avatar">
        {official.photoUrl
          ? <img src={official.photoUrl} alt={official.name} onError={e => e.target.style.display = "none"} />
          : getInitials(official.name)
        }
      </div>
      <div>
        <div className="rep-name">{official.name}</div>
        <div className="rep-office">{office}</div>
        <span className="rep-party-badge">{official.party || "Unknown Party"}</span>
        <div className="rep-links">
          {official.phones?.[0] && <a href={`tel:${official.phones[0]}`} className="rep-link">📞 {official.phones[0]}</a>}
          {official.urls?.[0] && <a href={official.urls[0]} target="_blank" rel="noopener noreferrer" className="rep-link">🔗 Official Site</a>}
        </div>
      </div>
      <div className="rep-side">
        <span className="soon-tag">Voting Record</span>
        <span className="soon-tag">Donors</span>
        <span className="soon-tag">Deep Dive</span>
      </div>
    </div>
  );
}

export default function Civitas() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [acLoading, setAcLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reps, setReps] = useState(null);
  const [locationName, setLocationName] = useState("");
  const wrapperRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    function onOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setSuggestions([]);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const fetchSuggestions = useCallback(async (val) => {
    if (val.trim().length < 4) { setSuggestions([]); return; }
    setAcLoading(true);
    try {
      const res = await fetch(`/api/autocomplete?input=${encodeURIComponent(val)}`);
      const data = await res.json();
      setSuggestions(data.suggestions || []);
      setActiveIdx(-1);
    } catch {
      setSuggestions([]);
    } finally {
      setAcLoading(false);
    }
  }, []);

  function handleInput(val) {
    setQuery(val);
    setError("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length >= 4) {
      debounceRef.current = setTimeout(() => fetchSuggestions(val), 300);
    } else {
      setSuggestions([]);
    }
  }

  async function lookupReps(address) {
    const cleanAddress = address.trim().replace(/\s+/g, " ");
    if (!cleanAddress) return;

    setLoading(true);
    setError("");
    setReps(null);
    setSuggestions([]);
    setQuery(cleanAddress);

    try {
      const res = await fetch(`/api/representatives?address=${encodeURIComponent(cleanAddress)}`);
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      const input = data.normalizedInput || {};
      setLocationName([input.city, input.state].filter(Boolean).join(", "));

      const grouped = {};
      (data.offices || []).forEach(office => {
        const level = LEVEL_MAP[office.levels?.[0]] || "Local";
        if (!grouped[level]) grouped[level] = [];
        (office.officialIndices || []).forEach(idx => {
          const official = data.officials?.[idx];
          if (official) grouped[level].push({ official, office: office.name });
        });
      });

      if (Object.keys(grouped).length === 0) throw new Error("No representatives found.");
      setReps(grouped);

    } catch (err) {
      setError(`We couldn't find representatives for "${cleanAddress}". Please check the address and try again.`);
    } finally {
      setLoading(false);
    }
  }

  function selectSuggestion(s) {
    const full = s.full || `${s.main}, ${s.secondary}`;
    setQuery(full);
    setSuggestions([]);
    setActiveIdx(-1);
    lookupReps(full);
  }

  function handleKeyDown(e) {
    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)); return; }
      if (e.key === "Enter" && activeIdx >= 0) { selectSuggestion(suggestions[activeIdx]); return; }
      if (e.key === "Escape") { setSuggestions([]); return; }
    }
    if (e.key === "Enter" && query.trim()) {
      setSuggestions([]);
      lookupReps(query);
    }
  }

  const showDropdown = acLoading || suggestions.length > 0;

  return (
    <>
      <style>{STYLES}</style>
      <div className="app">
        <header className="header">
          <div className="brand">
            <div className="brand-eyebrow">Civic Intelligence Platform</div>
            <h1 className="brand-name">Civi<em>tas</em></h1>
            <p className="brand-tagline">
              Your government, explained like a friend would.
              Know who represents you, how they vote, who funds them,
              and where your tax dollars go.
            </p>
          </div>
          <div className="brand-version">Civitas · Founding Edition</div>
        </header>

        <div className="search-block">
          <div className="search-label">Find Your Representatives</div>
          <p className="search-desc">
            Enter your address or zip code. We'll show you everyone who
            represents you — from city hall to Capitol Hill.
          </p>

          <div className="search-wrapper" ref={wrapperRef}>
            <input
              className="search-input"
              type="text"
              placeholder="e.g. 5157 Veranda Terr, Round Rock TX 78665"
              value={query}
              onChange={e => handleInput(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              className="search-btn"
              onClick={() => { if (query.trim()) { setSuggestions([]); lookupReps(query); } }}
              disabled={loading || !query.trim()}
            >
              {loading ? "..." : "Search"}
            </button>

            {showDropdown && (
              <div className="autocomplete-dropdown">
                {acLoading && (
                  <div className="ac-loading">
                    <div className="ac-spinner" />
                    Finding addresses...
                  </div>
                )}
                {!acLoading && suggestions.map((s, i) => (
                  <div
                    key={i}
                    className={`autocomplete-item${i === activeIdx ? " active" : ""}`}
                    onMouseDown={() => selectSuggestion(s)}
                  >
                    <span className="ac-icon">📍</span>
                    <div>
                      <div className="ac-main">{s.main}</div>
                      <div className="ac-secondary">{s.secondary}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="search-hint">Start typing for address suggestions, or enter any address and press Search</p>
        </div>

        {error && <div className="error">⚠️ {error}</div>}

        {loading && (
          <div className="loading">
            <div className="loading-row">
              <div className="spinner" />
              Finding your representatives...
            </div>
            <div className="loading-note">Pulling from public government records</div>
          </div>
        )}

        {reps && !loading && (
          <div>
            <div className="results-meta">
              <span className="results-title">Your Representatives</span>
              {locationName && <span className="results-location">{locationName}</span>}
            </div>
            <hr className="results-rule" />
            {LEVEL_ORDER.map(level => {
              const officials = reps[level];
              if (!officials?.length) return null;
              return (
                <div key={level} className="level-group">
                  <div className="level-header">
                    <span className="level-label">{level}</span>
                    <span className="level-line" />
                    <span className="level-count">{officials.length} rep{officials.length !== 1 ? "s" : ""}</span>
                  </div>
                  {officials.map((item, i) => (
                    <RepCard key={i} official={item.official} office={item.office} />
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {!reps && !loading && !error && (
          <div className="empty-state">
            {[
              { icon: "🏛️", title: "All Levels of Government", desc: "City council to U.S. Senate — everyone who works for you, in one place." },
              { icon: "🗳️", title: "Local Elections Matter Most", desc: "School boards, sheriffs, judges — these offices shape your daily life more than national ones." },
              { icon: "🔍", title: "Follow the Money", desc: "Voting records, donor maps, budget transparency — the rabbit hole goes as deep as you want." },
              { icon: "🏘️", title: "Community Issues", desc: "Spot a problem in your neighborhood? Report it, rally your community, hold officials accountable." },
            ].map(c => (
              <div key={c.title} className="empty-card">
                <div className="empty-icon">{c.icon}</div>
                <h3>{c.title}</h3>
                <p>{c.desc}</p>
              </div>
            ))}
          </div>
        )}

        <footer className="footer">
          <span className="footer-brand">Civitas</span>
          <span className="footer-note">Information is power. So is knowing who to call.</span>
        </footer>
      </div>
    </>
  );
}
