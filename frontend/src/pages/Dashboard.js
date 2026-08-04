import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Radio, Power, Trash2, Sparkles, Zap, Music2, Newspaper, MessageCircle, LogOut, LogIn, Send, User, ChevronRight, Cpu, Users, RefreshCw, Megaphone, Euro, ExternalLink, Download, Archive, Sliders, Mic, PauseCircle, PlayCircle, Upload, Package, Replace } from "lucide-react";
import { lineInMixer } from "@/lib/lineInMixer";
import { endpoints, api } from "@/lib/api";
import BrandName from "@/components/BrandName";
import { toast } from "sonner";

const STUDIO_BG = "https://images.unsplash.com/photo-1781865202636-0adef1d06cce?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2MzR8MHwxfHNlYXJjaHwzfHxmdXR1cmlzdGljJTIwcmFkaW8lMjBzdHVkaW8lMjBuaWdodHxlbnwwfHx8fDE3ODM4MDAwMjl8MA&ixlib=rb-4.1.0&q=85";

export default function Dashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(location.state?.user || null);
  const [checking, setChecking] = useState(!location.state?.user);
  const [station, setStation] = useState({ is_live: false });
  const [djs, setDjs] = useState([]);
  const [segments, setSegments] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [analytics, setAnalytics] = useState({});
  const [ads, setAds] = useState([]);
  const [adRevenue, setAdRevenue] = useState({ total_revenue_eur: 0, active_campaigns: 0, exhausted_campaigns: 0, paypal_mode: "demo" });
  const [tgStatus, setTgStatus] = useState({ enabled: false });
  const [adPlays, setAdPlays] = useState({}); // { campaign_id: plays payload }
  const [busy, setBusy] = useState(false);
  const [newDj, setNewDj] = useState({ name: "", personality: "", voice_key: "female-1", llm_provider: "openai", llm_model: "gpt-5.2", accent_color: "#22d3ee" });

  useEffect(() => {
    if (user) return;
    if (window.location.hash?.includes("session_id=")) return;
    (async () => {
      try {
        const me = await endpoints.me();
        setUser(me);
      } catch { /* not logged in — that's fine, we allow guest admin view */ }
      setChecking(false);
    })();
  }, [user]);

  const refresh = async () => {
    try {
      const [s, d, seg, t, q, a, adsList, rev, tg] = await Promise.all([
        endpoints.station(), endpoints.djs(), endpoints.segments(),
        endpoints.tracks(), endpoints.questions(false), endpoints.analytics(),
        endpoints.ads(),
        endpoints.adRevenue(),
        endpoints.telegramStatus(),
      ]);
      setStation(s); setDjs(d); setSegments(seg); setTracks(t); setQuestions(q); setAnalytics(a);
      setAds(adsList); setAdRevenue(rev); setTgStatus(tg);
      // Fetch play analytics for each active campaign (max 6 to avoid burst)
      const active = adsList.filter(c => c.status === "active" || c.status === "exhausted").slice(0, 6);
      const plays = {};
      await Promise.all(active.map(async (c) => {
        try { plays[c.id] = await endpoints.adPlays(c.id); } catch { /* noop */ }
      }));
      setAdPlays(plays);
    } catch (e) { /* noop */ }
  };
  useEffect(() => { refresh(); const iv = setInterval(refresh, 8000); return () => clearInterval(iv); }, []);

  const toggleStation = async () => {
    setBusy(true);
    try { const r = await endpoints.toggle(); setStation(s => ({ ...s, is_live: r.is_live })); toast.success(r.is_live ? "Stazione live" : "Stazione spenta"); }
    catch { toast.error("Errore"); } finally { setBusy(false); }
  };

  const generate = async (kind) => {
    setBusy(true);
    try {
      const s = await endpoints.generateSegment(kind ? { kind } : {});
      setSegments(prev => [...prev, s]);
      toast.success(`Segmento generato · ${s.llm_provider}`);
    } catch { toast.error("Errore generazione"); } finally { setBusy(false); }
  };

  const generateTrack = async () => {
    setBusy(true);
    try { const t = await endpoints.generateTrack(); setTracks(p => [t, ...p]); toast.success(`Traccia inventata: ${t.title}`); }
    catch { toast.error("Errore"); } finally { setBusy(false); }
  };

  const answerQuestion = async (q) => {
    setBusy(true);
    try { const s = await endpoints.generateSegment({ kind: "answer", question_id: q.id }); toast.success(`Risposta pronta da ${s.dj_name}`); refresh(); }
    catch { toast.error("Errore"); } finally { setBusy(false); }
  };

  const clearSegments = async () => {
    await endpoints.clearSegments(); toast.success("Timeline pulita"); refresh();
  };

  const login = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/dashboard";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };
  const logout = async () => {
    await endpoints.logout(); setUser(null); toast.success("Sessione chiusa");
  };

  const submitDj = async (e) => {
    e.preventDefault();
    if (!newDj.name || !newDj.personality) return;
    try {
      const d = await endpoints.createDj(newDj);
      setDjs(p => [...p, d]);
      toast.success(`DJ ${d.name} aggiunto`);
      setNewDj({ name: "", personality: "", voice_key: "female-1", llm_provider: "openai", llm_model: "gpt-5.2", accent_color: "#22d3ee" });
    } catch { toast.error("Errore"); }
  };

  const deleteDj = async (id) => {
    await endpoints.deleteDj(id); setDjs(p => p.filter(x => x.id !== id)); toast.success("DJ rimosso");
  };

  return (
    <div className="min-h-screen text-white bg-[#05050A]">
      {/* Sidebar-like header */}
      <header className="border-b border-white/8 bg-[#0F0F14]">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <Radio className="w-5 h-5 text-pink-500" />
            <div>
              <BrandName className="font-display font-black text-base" suffix=" · Admin" />
              <div className="label-mono">Control Room</div>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            {station.is_live ? (
              <div className="flex items-center gap-2" data-testid="admin-live-status"><span className="live-dot" /><span className="font-mono text-xs text-pink-400 uppercase tracking-widest">On Air</span></div>
            ) : (
              <span className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Off Air</span>
            )}
            {user ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm">
                  {user.picture && <img src={user.picture} alt="" className="w-7 h-7 rounded-full border border-white/10" />}
                  <span className="font-mono text-xs text-zinc-400">{user.email}</span>
                </div>
                <button data-testid="logout-button" onClick={logout} className="btn-outline text-sm flex items-center gap-2"><LogOut className="w-4 h-4" /> Esci</button>
              </div>
            ) : (
              <button data-testid="login-button" onClick={login} className="btn-outline text-sm flex items-center gap-2"><LogIn className="w-4 h-4" /> Login Google</button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-4 gap-6">

        {/* NEW: Broadcast control bar — Play/Pause/Skip/Jingle propagated
            to every public listener via /api/admin/command */}
        <BroadcastControlBar />

        {/* NEW: Live External — switch listeners to an Icecast/Shoutcast URL */}
        <LiveExternalPanel />

        {/* Control room */}
        <section className="lg:col-span-4 rounded-xl overflow-hidden relative border border-white/10">
          <div className="absolute inset-0 -z-10" style={{ backgroundImage: `linear-gradient(180deg, rgba(5,5,10,0.7) 0%, rgba(5,5,10,0.92) 100%), url(${STUDIO_BG})`, backgroundSize: "cover", backgroundPosition: "center" }} />
          <div className="p-6 md:p-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <div className="label-mono mb-2">Control Room</div>
              <h1 className="font-display font-black text-3xl sm:text-4xl">Pilota la webradio AI</h1>
              <p className="text-zinc-400 mt-2 max-w-xl">Accendi o spegni la trasmissione, genera segmenti, dai voce alle domande del pubblico.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button data-testid="station-toggle" disabled={busy} onClick={toggleStation} className={station.is_live ? "btn-outline flex items-center gap-2" : "btn-primary flex items-center gap-2"}>
                <Power className="w-4 h-4" /> {station.is_live ? "Spegni stazione" : "Accendi stazione"}
              </button>
              <button data-testid="gen-talk" disabled={busy} onClick={() => generate("talk")} className="btn-outline flex items-center gap-2"><MessageCircle className="w-4 h-4" /> Talk</button>
              <button data-testid="gen-music" disabled={busy} onClick={() => generate("music")} className="btn-outline flex items-center gap-2"><Music2 className="w-4 h-4" /> Musica</button>
              <button data-testid="gen-news" disabled={busy} onClick={() => generate("news")} className="btn-outline flex items-center gap-2"><Newspaper className="w-4 h-4" /> News</button>
              <button data-testid="gen-interview" disabled={busy} onClick={() => generate("interview")} className="btn-outline flex items-center gap-2"><Users className="w-4 h-4" /> Dialogo</button>
              <button data-testid="gen-horoscope" disabled={busy} onClick={() => generate("horoscope")} className="btn-outline flex items-center gap-2"><Sparkles className="w-4 h-4" /> Oroscopo</button>
              <button data-testid="gen-history" disabled={busy} onClick={() => generate("history")} className="btn-outline flex items-center gap-2"><Sparkles className="w-4 h-4" /> Storia</button>
              <button data-testid="gen-weather" disabled={busy} onClick={() => generate("weather")} className="btn-outline flex items-center gap-2"><Sparkles className="w-4 h-4" /> Meteo</button>
              <button data-testid="gen-joke" disabled={busy} onClick={() => generate("joke")} className="btn-outline flex items-center gap-2"><Sparkles className="w-4 h-4" /> Battuta</button>
              <button data-testid="gen-motivation" disabled={busy} onClick={() => generate("motivation")} className="btn-outline flex items-center gap-2"><Sparkles className="w-4 h-4" /> Motivazione</button>
            </div>
          </div>
        </section>

        {/* DB Sync — export/import tracks between preview and production */}
        <DbSyncPanel />

        {/* NEW: Rotation rules (jingle every X, DJ talk every Y) */}
        <RotationRulesPanel />

        {/* Unified track manager — clean table with search, upload, replace */}
        <TrackManagerPanel />

        {/* Community "A.I. Vs Umani" — brani caricati dagli utenti */}
        <CommunityPanel />
        {/* Manual Mode & Line-In Mixer */}
        <ManualModePanel />

        {/* KPI */}
        <KPI label="Segmenti" value={analytics.total_segments || 0} icon={Zap} />
        <KPI label="Tracce inventate" value={analytics.total_tracks || 0} icon={Music2} />
        <KPI label="Domande ricevute" value={analytics.total_questions || 0} icon={MessageCircle} />
        <KPI label="Ricavi pubblicità" value={`€${(adRevenue.total_revenue_eur || 0).toFixed(2).replace(".", ",")}`} icon={Euro} />

        {/* Ad Campaigns panel */}
        <section className="lg:col-span-4 card-surface p-6" data-testid="ads-panel">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <div className="label-mono flex items-center gap-2">
                <Megaphone className="w-3.5 h-3.5" /> Monetizzazione automatica
                <span className="chip" style={{ borderColor: adRevenue.paypal_mode === "live" ? "#10b98155" : "#22d3ee55", color: adRevenue.paypal_mode === "live" ? "#10b981" : "#22d3ee" }}>
                  PayPal · {adRevenue.paypal_mode}
                </span>
              </div>
              <h3 className="font-display font-bold text-xl">Campagne pubblicitarie</h3>
              <div className="text-xs font-mono text-zinc-500 mt-1">
                Attive: {adRevenue.active_campaigns} · Terminate: {adRevenue.exhausted_campaigns} · Ricavi totali: <span className="text-emerald-400">€{(adRevenue.total_revenue_eur || 0).toFixed(2)}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Link to="/pubblicita" target="_blank" rel="noopener noreferrer" className="btn-outline text-sm flex items-center gap-2" data-testid="open-ads-page">
                <ExternalLink className="w-4 h-4" /> Pagina pubblica
              </Link>
              <button
                onClick={async () => {
                  const brand = window.prompt("Nome brand:");
                  if (!brand) return;
                  const message = window.prompt("Messaggio chiave (max 400 caratteri):");
                  if (!message) return;
                  const tier = (window.prompt("Tier (basic/standard/premium):", "basic") || "basic").toLowerCase();
                  try {
                    const r = await api.post("/ads/create", { brand, message, tier, return_origin: window.location.origin });
                    // immediately confirm demo (admin quick-create)
                    if (r.data.is_demo) {
                      await api.post(`/ads/${r.data.id}/confirm`, null, { timeout: 120000 });
                      toast.success("Campagna creata e attivata (demo)");
                    } else if (r.data.approval_url) {
                      window.open(r.data.approval_url, "_blank");
                    }
                    refresh();
                  } catch (e) { toast.error("Errore creazione campagna"); }
                }}
                className="btn-primary text-sm flex items-center gap-2"
                data-testid="quick-create-ad"
              >
                <Sparkles className="w-4 h-4" /> Crea rapida
              </button>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-3 max-h-96 overflow-auto pr-1">
            {ads.length === 0 && (
              <div className="text-sm text-zinc-500 col-span-2">Nessuna campagna ancora. La <Link to="/pubblicita" className="text-cyan-400 underline">pagina pubblica</Link> è aperta agli inserzionisti.</div>
            )}
            {ads.map(c => {
              const plays = adPlays[c.id];
              const maxHour = plays ? Math.max(1, ...(plays.hourly || []).map(h => h.plays)) : 1;
              return (
              <div key={c.id} className="border border-white/8 rounded-lg p-3 bg-[#0F0F14]" data-testid={`ad-${c.id}`}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="font-display font-semibold truncate">{c.brand}</div>
                  <span className="chip" style={{ color: c.status === "active" ? "#10b981" : c.status === "exhausted" ? "#a1a1aa" : "#f59e0b", borderColor: "rgba(255,255,255,0.15)" }}>
                    {c.status}
                  </span>
                </div>
                <div className="text-xs font-mono text-zinc-500 mb-1">
                  {c.tier.toUpperCase()} · €{(c.price_eur || 0).toFixed(2)} · {c.plays_remaining}/{c.plays_total} passaggi
                  {c.is_demo && <span className="text-cyan-400 ml-2">DEMO</span>}
                </div>
                {c.script && <div className="text-xs text-zinc-400 line-clamp-2 mt-1">{c.script}</div>}
                {c.audio_url && (
                  <audio controls src={endpoints.audioUrl(c.audio_url)} className="mt-2 w-full h-8" style={{ height: 32 }} />
                )}
                {plays && plays.total_plays > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="label-mono">Passaggi per ora</div>
                      <div className="font-mono text-xs text-zinc-500">totale: {plays.total_plays}</div>
                    </div>
                    <div className="flex items-end gap-[2px] h-10">
                      {(plays.hourly || []).map((h, i) => (
                        <div
                          key={i}
                          title={`${h.hour}:00 → ${h.plays} passaggi`}
                          className="flex-1 rounded-t"
                          style={{
                            height: `${(h.plays / maxHour) * 100}%`,
                            minHeight: h.plays > 0 ? "3px" : "1px",
                            background: h.plays > 0 ? "linear-gradient(180deg,#FF1493,#8A2BE2)" : "rgba(255,255,255,0.05)",
                          }}
                        />
                      ))}
                    </div>
                    <div className="flex justify-between font-mono text-[10px] text-zinc-600 mt-1">
                      <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
                    </div>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        </section>

        {/* Telegram integration status */}
        <section className="lg:col-span-2 card-surface p-6" data-testid="telegram-panel">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="label-mono flex items-center gap-2">
                Telegram Bot
                {tgStatus.enabled ? (
                  <span className="chip" style={{ color: "#10b981", borderColor: "#10b98155" }}>connesso</span>
                ) : (
                  <span className="chip" style={{ color: "#a1a1aa" }}>disattivato</span>
                )}
              </div>
              <h3 className="font-display font-bold text-xl">Domande dal pubblico</h3>
            </div>
            <MessageCircle className="w-5 h-5 text-cyan-400" />
          </div>
          {tgStatus.enabled ? (
            <div className="space-y-2">
              <div className="text-sm text-zinc-300">
                Bot attivo come <span className="font-mono text-cyan-400">@{tgStatus.username}</span>.
                Gli ascoltatori possono scrivere direttamente al bot e le domande arrivano nella coda.
              </div>
              {tgStatus.link && (
                <a href={tgStatus.link} target="_blank" rel="noopener noreferrer" className="btn-outline text-sm inline-flex items-center gap-2 mt-2">
                  Apri Telegram <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
          ) : (
            <div className="text-sm text-zinc-400 leading-relaxed">
              <p>Per accendere il bot Telegram: 1) crea un bot con <span className="font-mono text-cyan-400">@BotFather</span> su Telegram, 2) copia il token nel file <span className="font-mono text-cyan-400">/app/backend/.env</span> alla riga <span className="font-mono">TELEGRAM_BOT_TOKEN=...</span>, 3) riavvia il backend.</p>
              <p className="mt-2 text-xs font-mono text-zinc-500">Il polling parte automatico allo startup, ricevi le domande nella coda con <code className="text-cyan-400">source=telegram</code>.</p>
            </div>
          )}
        </section>

        {/* LLM orchestration */}
        <section className="lg:col-span-2 card-surface p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="label-mono">Orchestrazione multi-LLM</div>
              <h3 className="font-display font-bold text-xl">Chi ha scritto cosa</h3>
            </div>
            <Cpu className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="space-y-3">
            {Object.keys(analytics.segments_by_provider || {}).length === 0 && (
              <div className="text-sm text-zinc-500">Genera un segmento per vedere l'attività degli LLM.</div>
            )}
            {Object.entries(analytics.segments_by_provider || {}).map(([prov, count]) => (
              <div key={prov} className="flex items-center gap-3">
                <span className="font-mono text-xs uppercase tracking-widest w-24 text-cyan-400">{prov}</span>
                <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full" style={{ width: `${Math.min(100, count * 12)}%`, background: prov === "openai" ? "#10b981" : prov === "anthropic" ? "#FF1493" : "#007AFF" }} />
                </div>
                <span className="font-mono text-xs text-zinc-400 w-8 text-right">{count}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Segment kinds distribution */}
        <section className="lg:col-span-2 card-surface p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="label-mono">Distribuzione palinsesto</div>
              <h3 className="font-display font-bold text-xl">Tipi di segmento</h3>
            </div>
            <RefreshCw className="w-5 h-5 text-zinc-500 cursor-pointer" onClick={refresh} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {["music","talk","news","answer"].map(k => (
              <div key={k} className="rounded-lg border border-white/8 bg-[#181820] p-3">
                <div className="label-mono">{k}</div>
                <div className="font-display font-bold text-2xl">{(analytics.segments_by_kind || {})[k] || 0}</div>
              </div>
            ))}
          </div>
        </section>

        {/* DJ management */}
        <section className="lg:col-span-2 card-surface p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="label-mono">Team DJ</div>
              <h3 className="font-display font-bold text-xl">Personas AI</h3>
            </div>
            <Users className="w-5 h-5 text-zinc-500" />
          </div>
          <div className="space-y-3 max-h-72 overflow-auto pr-1">
            {djs.map(dj => (
              <div key={dj.id} className="flex items-start gap-3 border border-white/8 rounded-lg p-3" data-testid={`admin-dj-${dj.id}`}>
                <div className="w-10 h-10 rounded-md bg-zinc-800 overflow-hidden shrink-0 border border-white/10">
                  {dj.avatar_url && <img src={dj.avatar_url} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display font-semibold" style={{ color: dj.accent_color }}>{dj.name}</div>
                  <div className="font-mono text-xs text-cyan-400 uppercase">{dj.llm_provider} · {dj.llm_model}</div>
                  <div className="text-xs text-zinc-500 mt-1 line-clamp-2">{dj.personality}</div>
                </div>
                <button onClick={() => deleteDj(dj.id)} className="text-zinc-500 hover:text-pink-500 transition-colors duration-200" title="Rimuovi DJ" data-testid={`delete-dj-${dj.id}`}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <form onSubmit={submitDj} className="mt-4 space-y-2" data-testid="new-dj-form">
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Nome DJ" value={newDj.name} onChange={e => setNewDj({ ...newDj, name: e.target.value })} className="bg-[#0F0F14] border border-white/10 rounded px-3 py-2 text-sm focusable" data-testid="new-dj-name" />
              <select value={newDj.voice_key} onChange={e => setNewDj({ ...newDj, voice_key: e.target.value })} className="bg-[#0F0F14] border border-white/10 rounded px-3 py-2 text-sm focusable">
                <option value="female-1">Voce femminile 1</option>
                <option value="female-2">Voce femminile 2</option>
                <option value="female-3">Voce femminile 3</option>
                <option value="female-4">Voce femminile 4</option>
                <option value="female-5">Voce femminile 5</option>
                <option value="male-1">Voce maschile 1</option>
                <option value="male-2">Voce maschile 2</option>
                <option value="male-3">Voce maschile 3</option>
                <option value="male-4">Voce maschile 4</option>
                <option value="male-5">Voce maschile 5</option>
              </select>
            </div>
            <textarea placeholder="Personalità (es. energica, ironica, nostalgica…)" value={newDj.personality} onChange={e => setNewDj({ ...newDj, personality: e.target.value })} rows={2} className="w-full bg-[#0F0F14] border border-white/10 rounded px-3 py-2 text-sm focusable" data-testid="new-dj-personality" />
            <div className="grid grid-cols-2 gap-2">
              <select value={newDj.llm_provider} onChange={e => {
                const p = e.target.value;
                const models = { openai: "gpt-5.2", anthropic: "claude-sonnet-4-5-20250929", gemini: "gemini-3-flash-preview" };
                setNewDj({ ...newDj, llm_provider: p, llm_model: models[p] });
              }} className="bg-[#0F0F14] border border-white/10 rounded px-3 py-2 text-sm focusable">
                <option value="openai">OpenAI · GPT-5.2</option>
                <option value="anthropic">Anthropic · Claude Sonnet 4.5</option>
                <option value="gemini">Google · Gemini 3 Flash</option>
              </select>
              <input type="color" value={newDj.accent_color} onChange={e => setNewDj({ ...newDj, accent_color: e.target.value })} className="bg-[#0F0F14] border border-white/10 rounded px-1 h-10 focusable" />
            </div>
            <button className="btn-primary text-sm w-full" data-testid="add-dj-button">Aggiungi DJ</button>
          </form>
        </section>

        {/* Questions queue */}
        <section className="lg:col-span-2 card-surface p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="label-mono">Coda domande ascoltatori</div>
              <h3 className="font-display font-bold text-xl">Da rispondere in diretta</h3>
            </div>
            <MessageCircle className="w-5 h-5 text-zinc-500" />
          </div>
          <div className="space-y-3 max-h-96 overflow-auto pr-1">
            {questions.length === 0 && <div className="text-sm text-zinc-500">Nessuna domanda ricevuta.</div>}
            {questions.map(q => (
              <div key={q.id} className="border border-white/8 rounded-lg p-3" data-testid={`question-${q.id}`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="font-display font-semibold text-sm flex items-center gap-2"><User className="w-3.5 h-3.5 text-cyan-400" /> {q.name}</div>
                  <span className="chip">{q.source}</span>
                </div>
                <div className="text-sm text-zinc-300">{q.question}</div>
                {q.answered ? (
                  <div className="mt-2 text-xs text-zinc-500">
                    <span className="text-pink-400">Risposto da {q.answering_dj}:</span> {q.answer}
                  </div>
                ) : (
                  <button onClick={() => answerQuestion(q)} disabled={busy} className="btn-outline text-xs mt-2 flex items-center gap-1" data-testid={`answer-${q.id}`}>
                    <Send className="w-3 h-3" /> Genera risposta in onda <ChevronRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Tracks library */}
        <section className="lg:col-span-2 card-surface p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="label-mono">Libreria tracce inventate</div>
              <h3 className="font-display font-bold text-xl">Musica AI</h3>
            </div>
            <button onClick={generateTrack} disabled={busy} className="btn-primary text-sm flex items-center gap-2" data-testid="generate-track-button"><Sparkles className="w-4 h-4" /> Inventa traccia</button>
          </div>
          <div className="space-y-2 max-h-72 overflow-auto pr-1">
            {tracks.length === 0 && <div className="text-sm text-zinc-500">Nessuna traccia ancora. Clicca "Inventa traccia".</div>}
            {tracks.map(t => (
              <div key={t.id} className="border border-white/8 rounded-lg p-3 flex items-start gap-3" data-testid={`track-${t.id}`}>
                <div className="w-10 h-10 rounded-md shrink-0" style={{ background: `linear-gradient(135deg, hsl(${(parseInt(t.cover_seed, 16) || 0) % 360}, 80%, 55%), hsl(${((parseInt(t.cover_seed, 16) || 0) + 60) % 360}, 80%, 45%))` }} />
                <div className="flex-1 min-w-0">
                  <div className="font-display font-semibold truncate">{t.title}</div>
                  <div className="text-xs font-mono text-zinc-500">{t.artist} · {t.genre} · {t.mood} · {t.duration_sec}s</div>
                  <div className="text-xs text-zinc-500 mt-1 whitespace-pre-wrap line-clamp-2">{t.lyrics_excerpt}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Recent segments */}
        <section className="lg:col-span-4 card-surface p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="label-mono">Timeline recente</div>
              <h3 className="font-display font-bold text-xl">Ultimi 30 segmenti</h3>
            </div>
            <button onClick={clearSegments} className="btn-outline text-xs flex items-center gap-1" data-testid="clear-segments"><Trash2 className="w-3 h-3" /> Pulisci</button>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {segments.slice(-20).reverse().map(s => (
              <div key={s.id} className="border border-white/8 rounded-lg p-3 bg-[#0F0F14]">
                <div className="flex items-center gap-2 mb-1">
                  <span className="chip">{s.kind}</span>
                  <span className="chip" style={{ color: "#fff", borderColor: "rgba(255,255,255,0.15)" }}>{s.dj_name}</span>
                  <span className="chip">{s.llm_provider}</span>
                </div>
                <div className="font-display font-semibold text-sm">{s.title}</div>
                {s.script && <div className="text-xs text-zinc-500 line-clamp-2 mt-1">{s.script}</div>}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function KPI({ label, value, icon: Icon }) {
  return (
    <div className="card-surface p-5">
      <div className="flex items-center justify-between">
        <div className="label-mono">{label}</div>
        <Icon className="w-4 h-4 text-cyan-400" />
      </div>
      <div className="font-display font-black text-3xl mt-2">{value}</div>
    </div>
  );
}

function LibraryDownloader() {
  const [manifest, setManifest] = React.useState(null);
  const [tracks, setTracks] = React.useState([]);
  const [segments, setSegments] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState("all");
  const [zipping, setZipping] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [m, t, s] = await Promise.all([
          api.get("/admin/export/manifest").then(r => r.data).catch(() => null),
          api.get("/tracks", { params: { limit: 500 } }).then(r => r.data).catch(() => []),
          api.get("/segments/list", { params: { limit: 500 } }).then(r => r.data).catch(() => []),
        ]);
        if (!alive) return;
        setManifest(m);
        setTracks(Array.isArray(t) ? t : []);
        setSegments(Array.isArray(s) ? s : []);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const trackCategoryOf = (t) => {
    const tags = t.tags || [];
    if (t.is_anthem) return "song_anthem";
    if (t.is_jingle) return "song_jingle";
    if (t.is_seed) return "song_seed";
    if (t.status === "retired") return "song_retired";
    if (tags.includes("english_pop_dance")) return "song_english";
    if (tags.includes("italian_lean_v2") || tags.includes("summer_it") || tags.includes("tech_house_lean")) return "song_italian";
    return "song_other";
  };

  const SEG_KIND_LABELS = {
    news: "Notiziari (dal futuro)",
    ad_spot: "Pubblicita' surreali",
    talk: "Talk DJ",
    interview: "Interviste immaginarie",
    history: "Storia dal futuro",
    horoscope: "Oroscopi cosmici",
    motivation: "Pillole filosofiche",
    joke: "Battute",
    weather: "Meteo cosmico",
    time_signal: "Segnali orari",
  };
  const SONG_LABELS = {
    song_english: "Song · English pop/dance",
    song_italian: "Song · Italiane",
    song_jingle: "Song · Jingle R-A.I.",
    song_anthem: "Song · Anthem",
    song_seed: "Song · Seed",
    song_retired: "Song · Ritirate",
    song_other: "Song · Altre",
  };
  const ALL_LABELS = { ...SONG_LABELS };
  Object.entries(SEG_KIND_LABELS).forEach(([k, v]) => { ALL_LABELS[`seg_${k}`] = v; });

  // Merge tracks + segments in un'unica lista con category e download_url
  const allItems = React.useMemo(() => {
    const backend = process.env.REACT_APP_BACKEND_URL;
    const asUrl = (path) => !path ? null : (path.startsWith("/api/") ? `${backend}${path}` : path);
    const items = [];
    tracks.forEach(t => {
      if (!t.audio_url) return;
      items.push({
        key: `t_${t.id}`,
        category: trackCategoryOf(t),
        title: t.title || "(senza titolo)",
        subtitle: `${t.artist || "-"} - ${t.genre || "-"} - ${t.status}`,
        url: asUrl(t.audio_url),
        fname: ((t.title || "untitled").replace(/[^\w\s-]/g, "").trim() || "untitled") + ".mp3",
      });
    });
    segments.forEach(s => {
      if (!s.speech_audio_url) return;
      items.push({
        key: `s_${s.id}`,
        category: `seg_${s.kind || "other"}`,
        title: s.title || `(${s.kind})`,
        subtitle: `Voce DJ: ${s.dj_name || "-"}`,
        url: asUrl(s.speech_audio_url),
        fname: ((s.title || s.kind || "segment").replace(/[^\w\s-]/g, "").trim() || "segment") + ".mp3",
      });
    });
    return items;
  }, [tracks, segments]);

  const filtered = React.useMemo(() => {
    return filter === "all" ? allItems : allItems.filter(i => i.category === filter);
  }, [allItems, filter]);

  const groups = React.useMemo(() => {
    const g = {};
    filtered.forEach(i => { (g[i.category] = g[i.category] || []).push(i); });
    return g;
  }, [filtered]);

  const downloadZip = () => {
    setZipping(true);
    try {
      const backend = process.env.REACT_APP_BACKEND_URL;
      const a = document.createElement("a");
      a.href = `${backend}/api/admin/export`;
      a.rel = "noopener";
      a.download = `rai_export_${new Date().toISOString().slice(0,10)}.zip`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 500);
      toast.success("Download ZIP avviato - includera' musica + rubriche + metadata");
    } catch (e) {
      toast.error("Errore avvio download");
    } finally {
      setTimeout(() => setZipping(false), 1500);
    }
  };

  return (
    <section data-testid="library-downloader" className="lg:col-span-4 card-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <div className="label-mono flex items-center gap-2">
            <Archive className="w-4 h-4 text-emerald-400" /> Libreria contenuti generati
          </div>
          <h2 className="font-display font-black text-2xl mt-1">Download &amp; Archivio</h2>
          {manifest && (
            <p className="text-zinc-400 text-sm mt-1">
              {allItems.length} elementi audio scaricabili - {manifest.suno_mb} MB musica + {manifest.tts_mb} MB voci
            </p>
          )}
        </div>
        <button
          data-testid="download-zip-all"
          onClick={downloadZip}
          disabled={zipping}
          className="btn-primary flex items-center gap-2 whitespace-nowrap"
        >
          <Download className="w-4 h-4" />
          {zipping ? "Preparazione ZIP..." : "Scarica TUTTO come ZIP"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4" data-testid="library-filter-chips">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label={`Tutti (${allItems.length})`} testid="filter-all" />
        {Object.entries(ALL_LABELS).map(([key, label]) => {
          const count = allItems.filter(i => i.category === key).length;
          if (count === 0) return null;
          return (
            <FilterChip
              key={key}
              active={filter === key}
              onClick={() => setFilter(key)}
              label={`${label} (${count})`}
              testid={`filter-${key}`}
            />
          );
        })}
      </div>

      {loading ? (
        <div className="text-zinc-500 text-sm py-8 text-center">Caricamento libreria...</div>
      ) : filtered.length === 0 ? (
        <div className="text-zinc-500 text-sm py-8 text-center">Nessun elemento in questa categoria.</div>
      ) : (
        <div className="space-y-6 max-h-[600px] overflow-y-auto pr-2">
          {Object.entries(groups).map(([cat, list]) => (
            <div key={cat}>
              <div className="label-mono mb-2 text-cyan-400">{ALL_LABELS[cat] || cat} - {list.length}</div>
              <div className="space-y-1">
                {list.map(i => (
                  <div key={i.key} data-testid={`library-row-${i.key}`} className="flex items-center justify-between gap-3 py-2 px-3 rounded bg-white/[0.02] hover:bg-white/[0.05] border border-white/5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-sm">{i.title}</div>
                      <div className="truncate text-xs text-zinc-500">{i.subtitle}</div>
                    </div>
                    {i.url ? (
                      <a href={i.url} download={i.fname} data-testid={`download-${i.key}`} className="btn-outline text-xs flex items-center gap-1 whitespace-nowrap">
                        <Download className="w-3 h-3" /> MP3
                      </a>
                    ) : (
                      <span className="text-xs text-zinc-600">no file</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}


function FilterChip({ active, onClick, label, testid }) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      className={
        "px-3 py-1.5 rounded-full text-xs font-mono uppercase tracking-wider border transition " +
        (active
          ? "bg-emerald-500/20 border-emerald-400 text-emerald-300"
          : "bg-white/[0.02] border-white/10 text-zinc-400 hover:border-white/25")
      }
    >
      {label}
    </button>
  );
}


function ManualModePanel() {
  const [mode, setMode] = React.useState("auto");
  const [pendingStop, setPendingStop] = React.useState(false);
  const [devices, setDevices] = React.useState([]);
  const [selected, setSelected] = React.useState("");
  const [lineActive, setLineActive] = React.useState(false);
  const [gain, setGain] = React.useState(1.0);
  const [level, setLevel] = React.useState(0);
  const [starting, setStarting] = React.useState(false);
  const rafRef = React.useRef(null);

  const refreshMode = React.useCallback(async () => {
    try {
      const r = await api.get("/station/mode");
      setMode(r.data.mode || "auto");
      setPendingStop(!!r.data.pending_graceful_stop);
    } catch (e) {}
  }, []);

  React.useEffect(() => {
    refreshMode();
    const iv = setInterval(refreshMode, 8000);
    return () => clearInterval(iv);
  }, [refreshMode]);

  const loadDevices = async () => {
    const list = await lineInMixer.listDevices();
    setDevices(list);
    if (list.length && !selected) setSelected(list[0].deviceId);
  };

  React.useEffect(() => { loadDevices(); }, []);

  React.useEffect(() => {
    if (!lineActive) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setLevel(0);
      return;
    }
    const tick = () => {
      setLevel(lineInMixer.getLevel());
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [lineActive]);

  const requestGracefulStop = async () => {
    try {
      await api.post("/station/mode", null, { params: { mode: "manual", stop_after_current: true } });
      setPendingStop(true);
      setMode("manual");
      toast.success("Stop programmato. Il player si fermera' dopo il segmento in onda.");
    } catch (e) {
      toast.error("Errore invio comando stop");
    }
  };

  const backToAuto = async () => {
    try {
      await api.post("/station/mode", null, { params: { mode: "auto", stop_after_current: false } });
      setMode("auto");
      setPendingStop(false);
      toast.success("Modalita' automatica riattivata");
    } catch (e) {
      toast.error("Errore");
    }
  };

  const startLineIn = async () => {
    setStarting(true);
    try {
      await lineInMixer.start(selected || undefined);
      setLineActive(true);
      lineInMixer.setGain(gain);
      toast.success("Line-in attivo - qualita' 48kHz stereo");
    } catch (e) {
      toast.error(`Errore attivazione line-in: ${e.message || e}`);
      console.error(e);
    } finally {
      setStarting(false);
    }
  };

  const stopLineIn = async () => {
    await lineInMixer.stop();
    setLineActive(false);
    toast.success("Line-in fermato");
  };

  const changeGain = (v) => {
    setGain(v);
    if (lineActive) lineInMixer.setGain(v);
  };

  const levelPct = Math.min(100, Math.round(level * 300));
  const isClipping = levelPct > 92;

  return (
    <section data-testid="manual-mode-panel" className="lg:col-span-4 card-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <div className="label-mono flex items-center gap-2">
            <Sliders className="w-4 h-4 text-fuchsia-400" /> Trasmissione manuale
          </div>
          <h2 className="font-display font-black text-2xl mt-1">Modalita' Manuale &amp; Line-In</h2>
          <p className="text-zinc-400 text-sm mt-1">
            Ferma la playlist automatica dopo il segmento in onda e trasmetti in diretta
            dalla tua seconda scheda audio. 48 kHz stereo, zero ricodifica, zero crediti.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1.5 rounded-full text-xs font-mono uppercase tracking-wider border ${
            mode === "manual"
              ? "bg-fuchsia-500/20 border-fuchsia-400 text-fuchsia-300"
              : "bg-emerald-500/20 border-emerald-400 text-emerald-300"
          }`} data-testid="mode-badge">
            Mode: {mode}
          </span>
          {pendingStop && mode !== "manual" && (
            <span className="px-3 py-1.5 rounded-full text-xs font-mono uppercase tracking-wider bg-amber-500/20 border border-amber-400 text-amber-300">
              Stop pendente
            </span>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3 mb-6">
        <button
          data-testid="btn-graceful-stop"
          onClick={requestGracefulStop}
          disabled={mode === "manual"}
          className={`p-4 rounded-xl border transition text-left ${
            mode === "manual"
              ? "bg-white/[0.02] border-white/5 opacity-40 cursor-not-allowed"
              : "bg-fuchsia-500/10 border-fuchsia-400/40 hover:border-fuchsia-400 hover:bg-fuchsia-500/20"
          }`}
        >
          <div className="flex items-center gap-3">
            <PauseCircle className="w-6 h-6 text-fuchsia-300" />
            <div>
              <div className="font-bold text-sm">Ferma dopo il segmento in onda</div>
              <div className="text-xs text-zinc-400 mt-0.5">
                Il player finisce il pezzo/parlato corrente poi si mette in pausa. Nessun taglio brusco.
              </div>
            </div>
          </div>
        </button>
        <button
          data-testid="btn-back-to-auto"
          onClick={backToAuto}
          disabled={mode === "auto" && !pendingStop}
          className={`p-4 rounded-xl border transition text-left ${
            mode === "auto" && !pendingStop
              ? "bg-white/[0.02] border-white/5 opacity-40 cursor-not-allowed"
              : "bg-emerald-500/10 border-emerald-400/40 hover:border-emerald-400 hover:bg-emerald-500/20"
          }`}
        >
          <div className="flex items-center gap-3">
            <PlayCircle className="w-6 h-6 text-emerald-300" />
            <div>
              <div className="font-bold text-sm">Torna alla playlist automatica</div>
              <div className="text-xs text-zinc-400 mt-0.5">
                Ricarica la pagina Player pubblica per far ripartire la rotazione AI.
              </div>
            </div>
          </div>
        </button>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Mic className={`w-4 h-4 ${lineActive ? "text-fuchsia-400" : "text-zinc-500"}`} />
            <span className="font-mono uppercase text-xs tracking-wider text-zinc-300">
              Line-In - {lineActive ? "IN ONDA" : "off"}
            </span>
          </div>
          <button
            data-testid="btn-refresh-devices"
            onClick={loadDevices}
            className="btn-outline text-xs flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Aggiorna dispositivi
          </button>
        </div>

        <div className="grid md:grid-cols-[1fr_auto] gap-3 mb-4">
          <select
            data-testid="line-in-device-select"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={lineActive}
            className="bg-black/50 border border-white/10 rounded px-3 py-2 text-sm"
          >
            {devices.length === 0 && <option value="">Nessun dispositivo audio - concedi il permesso al microfono</option>}
            {devices.map(d => (
              <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
            ))}
          </select>
          {!lineActive ? (
            <button
              data-testid="btn-start-line-in"
              onClick={startLineIn}
              disabled={starting || devices.length === 0}
              className="btn-primary text-sm"
            >
              {starting ? "Attivazione..." : "Attiva Line-In"}
            </button>
          ) : (
            <button
              data-testid="btn-stop-line-in"
              onClick={stopLineIn}
              className="btn-outline text-sm border-fuchsia-400 text-fuchsia-300"
            >
              Ferma Line-In
            </button>
          )}
        </div>

        <div className="grid md:grid-cols-[1fr_120px] gap-4 items-center">
          <div>
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
              <span>Gain: {gain.toFixed(2)}x</span>
              <span className="font-mono">{Math.round(gain * 100)}%</span>
            </div>
            <input
              data-testid="line-in-gain-slider"
              type="range"
              min="0"
              max="1.5"
              step="0.01"
              value={gain}
              onChange={(e) => changeGain(parseFloat(e.target.value))}
              className="w-full accent-fuchsia-500"
            />
          </div>
          <div className="h-16 w-full rounded overflow-hidden border border-white/10 bg-black relative" data-testid="line-in-vu">
            <div
              className={`absolute bottom-0 left-0 right-0 transition-[height] duration-75 ${
                isClipping ? "bg-red-500" : levelPct > 70 ? "bg-amber-400" : "bg-emerald-400"
              }`}
              style={{ height: `${levelPct}%` }}
            />
            <div className="absolute inset-0 flex items-end justify-center pb-1 text-[10px] font-mono text-zinc-500">
              {isClipping ? "CLIP!" : `${levelPct}%`}
            </div>
          </div>
        </div>

        <p className="text-xs text-zinc-500 mt-4">
          Suggerimento: seleziona l'ingresso della tua seconda scheda audio (es. "Line In (Focusrite)",
          "USB Audio", "BlackHole 2ch"). L'audio esce direttamente dal browser senza ricodifica intermedia.
          Per trasmettere anche agli ascoltatori pubblici serve un server di streaming (Icecast/Liquidsoap):
          al momento la line-in e' udibile in locale sul tuo PC.
        </p>
      </div>
    </section>
  );
}



// -------------------- UploadMp3Panel --------------------
// Master Plan #1: carica MP3 come nuovo brano OPPURE sostituisci uno esistente
// dando anche un nuovo nome. Il file finisce in /app/backend/static/suno/ e
// (se USE_OBJECT_STORAGE=true) anche sul bucket condiviso Emergent.
function UploadMp3Panel() {
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState("new");
  const [kind, setKind] = useState("song");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("R-A.I.");
  const [targetId, setTargetId] = useState("");
  const [tracksList, setTracksList] = useState([]);
  const [searchQ, setSearchQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (mode !== "replace") return;
    api.get("/admin/tracks/searchable").then(r => setTracksList(r.data?.tracks || [])).catch(() => setTracksList([]));
  }, [mode]);

  const filteredTracks = React.useMemo(() => {
    if (!searchQ.trim()) return tracksList.slice(0, 60);
    const q = searchQ.toLowerCase();
    return tracksList.filter(t =>
      (t.title || "").toLowerCase().includes(q) ||
      (t.artist || "").toLowerCase().includes(q)
    ).slice(0, 60);
  }, [tracksList, searchQ]);

  const upload = async () => {
    if (!file) { toast.error("Seleziona un file .mp3"); return; }
    if (!title.trim()) { toast.error("Il titolo è obbligatorio"); return; }
    if (mode === "replace" && !targetId) { toast.error("Scegli il brano da sostituire"); return; }
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", mode);
      fd.append("title", title.trim());
      fd.append("artist", artist.trim() || "R-A.I.");
      fd.append("kind", kind);
      if (mode === "replace") fd.append("target_id", targetId);
      const backend = process.env.REACT_APP_BACKEND_URL;
      const resp = await fetch(`${backend}/api/admin/tracks/upload`, {
        method: "POST",
        body: fd,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      setResult(data);
      toast.success(mode === "replace" ? `Sostituito: ${data.title}` : `Caricato: ${data.title}`);
      // Reset lightly
      setFile(null);
      setTitle("");
      if (mode === "replace") {
        // refresh list
        api.get("/admin/tracks/searchable").then(r => setTracksList(r.data?.tracks || []));
      }
    } catch (e) {
      toast.error(`Upload fallito: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-testid="upload-mp3-panel" className="lg:col-span-4 card-surface p-6">
      <div className="mb-4">
        <div className="label-mono flex items-center gap-2">
          <Upload className="w-4 h-4 text-pink-400" /> Carica MP3
        </div>
        <h2 className="font-display font-black text-2xl mt-1">Nuovo brano o Sostituzione</h2>
        <p className="text-zinc-400 text-sm mt-1">
          Carica un MP3 dal tuo PC. Puoi aggiungere un nuovo brano alla rotazione oppure
          <strong> sostituire</strong> uno esistente (utile per correggere titolo, autore o audio).
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Mode selector */}
        <div className="flex flex-col gap-2">
          <label className="label-mono">Modalità</label>
          <div className="flex gap-2">
            <button
              data-testid="mode-new"
              onClick={() => setMode("new")}
              className={`btn-outline flex-1 flex items-center justify-center gap-2 ${mode === "new" ? "border-pink-500 text-pink-400" : ""}`}
            >
              <Upload className="w-4 h-4" /> Nuovo brano
            </button>
            <button
              data-testid="mode-replace"
              onClick={() => setMode("replace")}
              className={`btn-outline flex-1 flex items-center justify-center gap-2 ${mode === "replace" ? "border-cyan-400 text-cyan-400" : ""}`}
            >
              <Replace className="w-4 h-4" /> Sostituisci esistente
            </button>
          </div>
        </div>

        {/* Kind selector */}
        <div className="flex flex-col gap-2">
          <label className="label-mono">Tipo</label>
          <select
            data-testid="kind-select"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="bg-zinc-900 border border-white/10 rounded px-3 py-2 text-white"
          >
            <option value="song">🎵 Canzone (rotazione musicale)</option>
            <option value="jingle">📣 Jingle brandizzato R-A.I.</option>
            <option value="anthem">🏆 Inno ufficiale</option>
          </select>
        </div>

        {/* File input */}
        <div className="flex flex-col gap-2 md:col-span-2">
          <label className="label-mono">File MP3</label>
          <input
            data-testid="file-input"
            type="file"
            accept="audio/mpeg,.mp3"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="bg-zinc-900 border border-white/10 rounded px-3 py-2 text-white text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-pink-500/20 file:text-pink-300 file:cursor-pointer"
          />
          {file && (
            <span className="text-xs text-emerald-400 font-mono">
              Selezionato: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
            </span>
          )}
        </div>

        {/* Replace: track picker */}
        {mode === "replace" && (
          <div className="flex flex-col gap-2 md:col-span-2">
            <label className="label-mono">Brano da sostituire ({tracksList.length} disponibili)</label>
            <input
              data-testid="replace-search"
              type="text"
              placeholder="Cerca per titolo o artista…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="bg-zinc-900 border border-white/10 rounded px-3 py-2 text-white text-sm"
            />
            <div className="max-h-56 overflow-y-auto border border-white/5 rounded bg-black/30">
              {filteredTracks.length === 0 && (
                <div className="text-zinc-500 text-xs p-3">Nessun brano trovato.</div>
              )}
              {filteredTracks.map(t => (
                <button
                  key={t.id}
                  data-testid={`replace-pick-${t.id.slice(0,8)}`}
                  onClick={() => setTargetId(t.id)}
                  className={`w-full text-left px-3 py-2 text-sm border-b border-white/5 hover:bg-white/[0.06] transition ${targetId === t.id ? "bg-cyan-500/10 text-cyan-300" : "text-zinc-300"}`}
                >
                  <span className="font-mono text-[10px] uppercase mr-2 opacity-60">{t.kind}</span>
                  <span className="font-semibold">{t.title}</span>
                  <span className="text-zinc-500 ml-2">— {t.artist}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Title */}
        <div className="flex flex-col gap-2">
          <label className="label-mono">Titolo{mode === "replace" ? " (nuovo)" : ""}</label>
          <input
            data-testid="title-input"
            type="text"
            placeholder={mode === "replace" ? "es. Inno_Sfumato" : "Titolo del brano"}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="bg-zinc-900 border border-white/10 rounded px-3 py-2 text-white"
          />
        </div>

        {/* Artist */}
        <div className="flex flex-col gap-2">
          <label className="label-mono">Artista</label>
          <input
            data-testid="artist-input"
            type="text"
            placeholder="R-A.I."
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            className="bg-zinc-900 border border-white/10 rounded px-3 py-2 text-white"
          />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          data-testid="upload-submit"
          onClick={upload}
          disabled={busy || !file || !title.trim() || (mode === "replace" && !targetId)}
          className="btn-primary flex items-center gap-2"
        >
          <Upload className="w-4 h-4" />
          {busy ? "Caricamento…" : (mode === "replace" ? "Sostituisci brano" : "Aggiungi brano")}
        </button>
        {result && (
          <span className="text-xs text-emerald-400 font-mono" data-testid="upload-result">
            ✓ {result.title} — {(result.size_bytes / 1024 / 1024).toFixed(2)} MB
          </span>
        )}
      </div>
    </section>
  );
}


// -------------------- CategorizedExportPanel --------------------
// Master Plan #2: download ZIP per categoria, paginati, così il server non
// crasha al 99% come col monolitico da 1GB.
function CategorizedExportPanel() {
  const [busyKey, setBusyKey] = useState(null);
  const [pages, setPages] = useState({}); // { music: 1, jingles: 1, ... }

  const categories = [
    { key: "music", label: "Musica", icon: Music2, color: "text-pink-400", pageSize: 25 },
    { key: "jingles", label: "Jingle R-A.I.", icon: Sparkles, color: "text-cyan-400", pageSize: 100 },
    { key: "anthem", label: "Inno", icon: Radio, color: "text-yellow-400", pageSize: 100 },
    { key: "retired", label: "Ritirati", icon: Archive, color: "text-zinc-500", pageSize: 50 },
    { key: "talk", label: "Talk (voci)", icon: MessageCircle, color: "text-cyan-300", pageSize: 100 },
    { key: "news", label: "News (voci)", icon: Newspaper, color: "text-purple-400", pageSize: 100 },
    { key: "ad_spot", label: "Spot (voci)", icon: Megaphone, color: "text-emerald-400", pageSize: 100 },
    { key: "weather", label: "Meteo (voci)", icon: Sparkles, color: "text-blue-400", pageSize: 100 },
    { key: "horoscope", label: "Oroscopo (voci)", icon: Sparkles, color: "text-fuchsia-400", pageSize: 100 },
    { key: "history", label: "Storia (voci)", icon: Sparkles, color: "text-amber-400", pageSize: 100 },
    { key: "interview", label: "Interviste (voci)", icon: Users, color: "text-rose-400", pageSize: 100 },
    { key: "motivation", label: "Motivazione (voci)", icon: Sparkles, color: "text-lime-400", pageSize: 100 },
    { key: "joke", label: "Battute (voci)", icon: Sparkles, color: "text-orange-400", pageSize: 100 },
    { key: "time_signal", label: "Segnali orari", icon: Sparkles, color: "text-indigo-400", pageSize: 100 },
    { key: "metadata", label: "Metadata JSON", icon: Package, color: "text-white", pageSize: 999 },
  ];

  const downloadCat = (cat) => {
    const page = pages[cat.key] || 1;
    const backend = process.env.REACT_APP_BACKEND_URL;
    setBusyKey(cat.key);
    try {
      const url = `${backend}/api/admin/export/category/${cat.key}?page=${page}&page_size=${cat.pageSize}`;
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener";
      a.download = `rai_${cat.key}_p${page}.zip`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 500);
      toast.success(`Download ${cat.label} (pag. ${page}) avviato`);
    } catch (e) {
      toast.error(`Errore download ${cat.label}`);
    } finally {
      setTimeout(() => setBusyKey(null), 1200);
    }
  };

  const bumpPage = (key, delta) => {
    setPages(p => ({ ...p, [key]: Math.max(1, (p[key] || 1) + delta) }));
  };

  return (
    <section data-testid="categorized-export-panel" className="lg:col-span-4 card-surface p-6">
      <div className="mb-4">
        <div className="label-mono flex items-center gap-2">
          <Package className="w-4 h-4 text-emerald-400" /> Download ZIP · Pacchetti piccoli
        </div>
        <h2 className="font-display font-black text-2xl mt-1">Archivio per categoria</h2>
        <p className="text-zinc-400 text-sm mt-1">
          Un pacchetto ZIP per categoria — molto più leggero del download totale (che può
          crashare al 99% su librerie grandi). Musica e brani ritirati sono <strong>paginati</strong>:
          usa i pulsanti «‹» e «›» per navigare tra le pagine.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {categories.map(cat => {
          const Icon = cat.icon;
          const page = pages[cat.key] || 1;
          const paginated = cat.pageSize < 200;
          return (
            <div key={cat.key} data-testid={`export-cat-${cat.key}`} className="p-3 rounded bg-white/[0.03] border border-white/5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Icon className={`w-4 h-4 ${cat.color} shrink-0`} />
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{cat.label}</div>
                  {paginated && (
                    <div className="text-[10px] text-zinc-500 font-mono">pag. {page} · {cat.pageSize}/blocco</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {paginated && (
                  <>
                    <button
                      onClick={() => bumpPage(cat.key, -1)}
                      disabled={page <= 1}
                      className="btn-outline px-2 py-1 text-xs disabled:opacity-30"
                      data-testid={`page-prev-${cat.key}`}
                    >‹</button>
                    <button
                      onClick={() => bumpPage(cat.key, 1)}
                      className="btn-outline px-2 py-1 text-xs"
                      data-testid={`page-next-${cat.key}`}
                    >›</button>
                  </>
                )}
                <button
                  onClick={() => downloadCat(cat)}
                  disabled={busyKey === cat.key}
                  data-testid={`download-cat-${cat.key}`}
                  className="btn-primary px-3 py-1 text-xs flex items-center gap-1"
                >
                  <Download className="w-3 h-3" />
                  {busyKey === cat.key ? "…" : "ZIP"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}


// -------------------- DbSyncPanel --------------------
// Sync della libreria "tracks" fra preview e produzione. Non tocca collezioni
// con dati utente (questions, ads, station, djs, users) — quelle restano intatte.
function DbSyncPanel() {
  const [busy, setBusy] = useState(null); // "export" | "import" | null
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState("merge");
  const [result, setResult] = useState(null);
  const [totalTracks, setTotalTracks] = useState(null);

  useEffect(() => {
    api.get("/admin/tracks/searchable")
      .then(r => setTotalTracks(r.data?.total || 0))
      .catch(() => setTotalTracks(null));
  }, [result]);

  const doExport = () => {
    setBusy("export");
    try {
      const backend = process.env.REACT_APP_BACKEND_URL;
      const a = document.createElement("a");
      a.href = `${backend}/api/admin/db/export`;
      a.rel = "noopener";
      a.download = "rai_tracks_export.json";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 500);
      toast.success("Export avviato — controlla i download del browser");
    } catch (e) {
      toast.error("Errore export");
    } finally {
      setTimeout(() => setBusy(null), 1000);
    }
  };

  const doImport = async () => {
    if (!file) { toast.error("Seleziona il file JSON esportato"); return; }
    setBusy("import");
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", mode);
      const backend = process.env.REACT_APP_BACKEND_URL;
      const resp = await fetch(`${backend}/api/admin/db/import`, { method: "POST", body: fd });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      setResult(data);
      const s = data.stats || {};
      toast.success(`Import OK — inseriti: ${s.inserted || 0}, aggiornati: ${s.updated || 0}, totale in DB: ${s.total_in_db_after || 0}`);
    } catch (e) {
      toast.error(`Import fallito: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section data-testid="db-sync-panel" className="lg:col-span-4 card-surface p-6">
      <div className="mb-4">
        <div className="label-mono flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-cyan-400" /> Sync DB Tracce · Preview ↔ Produzione
        </div>
        <h2 className="font-display font-black text-2xl mt-1">Esporta / Importa libreria</h2>
        <p className="text-zinc-400 text-sm mt-1">
          Preview e produzione hanno database separati. Da qui esporti le
          {totalTracks !== null && <> <strong>{totalTracks}+</strong></>} tracce
          in un unico JSON, poi lo carichi sull'ambiente di produzione via il pulsante
          "Importa". Le altre collezioni (domande ascoltatori, DJ, pubblicità, impostazioni)
          <strong> non vengono toccate</strong>.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* ONE-CLICK SYNC TO PRODUCTION */}
        <div className="p-4 rounded bg-gradient-to-br from-pink-500/10 to-cyan-500/10 border border-pink-500/30">
          <div className="text-pink-300 label-mono mb-2 flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Sync automatico → r-ai.it
          </div>
          <p className="text-xs text-zinc-400 mb-3">
            Un click: esporta le tracce locali e le importa direttamente nel database di produzione (r-ai.it).
          </p>
          <SyncToProductionButton />
        </div>

        {/* EXPORT */}
        <div className="p-4 rounded bg-white/[0.03] border border-white/5">
          <div className="text-cyan-300 label-mono mb-2">1 · Esporta da questo ambiente</div>
          <p className="text-xs text-zinc-400 mb-3">
            Scarica un file JSON con tutte le tracce (ready + retired) del database corrente.
          </p>
          <button
            data-testid="db-export-btn"
            onClick={doExport}
            disabled={busy !== null}
            className="btn-primary flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            {busy === "export" ? "Preparazione…" : "Esporta JSON tracce"}
          </button>
        </div>

        {/* IMPORT */}
        <div className="p-4 rounded bg-white/[0.03] border border-white/5">
          <div className="text-pink-300 label-mono mb-2">2 · Importa in questo ambiente</div>
          <p className="text-xs text-zinc-400 mb-3">
            Sull'altro ambiente (es. r-ai.it): carica qui il JSON esportato per popolare
            il database. La modalità <em>merge</em> aggiorna/inserisce senza cancellare nulla.
          </p>
          <div className="flex flex-col gap-2">
            <input
              data-testid="db-import-file"
              type="file"
              accept="application/json,.json"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="bg-zinc-900 border border-white/10 rounded px-3 py-2 text-white text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-cyan-500/20 file:text-cyan-300 file:cursor-pointer"
            />
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio" name="db-import-mode" value="merge"
                  checked={mode === "merge"} onChange={() => setMode("merge")}
                  data-testid="db-import-mode-merge"
                />
                <span>Merge (raccomandato)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer opacity-70">
                <input
                  type="radio" name="db-import-mode" value="replace-all"
                  checked={mode === "replace-all"} onChange={() => setMode("replace-all")}
                  data-testid="db-import-mode-replace"
                />
                <span className="text-red-300">Replace-all (⚠ cancella tutto prima)</span>
              </label>
            </div>
            <button
              data-testid="db-import-btn"
              onClick={doImport}
              disabled={busy !== null || !file}
              className="btn-primary flex items-center gap-2 mt-1"
            >
              <Upload className="w-4 h-4" />
              {busy === "import" ? "Importazione…" : "Importa JSON"}
            </button>
          </div>
          {result && (
            <div data-testid="db-import-result" className="mt-3 text-xs font-mono text-emerald-300 bg-black/30 p-2 rounded">
              ✓ mode={result.mode} · da={result.source_db} · file={result.stats.total_in_file}
              {" "}· inseriti={result.stats.inserted} · aggiornati={result.stats.updated}
              {" "}· totale DB={result.stats.total_in_db_after}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}



// ==================== TrackManagerPanel (single, clean archive) ====================
// Master Plan del 2026-02:
//   • Tabella unica con Nome, Tipo (Song/Jingle/Inno), Preview▶, On-Air toggle,
//     Download, Sostituisci.
//   • Pulsante AGGIUNGI NUOVO: apre modal file + nome + tipo (Song/Jingle).
//   • Pulsante SOSTITUISCI su ogni riga: apre modal file + nuovo nome (obbligatorio).
//     Sostituzione atomica lato server.
function TrackManagerPanel() {
  const [tracks, setTracks] = useState([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all|song|jingle|anthem
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // { kind: 'new'|'replace', target?: track }
  const [previewId, setPreviewId] = useState(null);
  const previewAudioRef = React.useRef(null);
  const [onAirState, setOnAirState] = useState({}); // { [trackId]: true|false }

  const load = React.useCallback(() => {
    setLoading(true);
    api.get("/admin/tracks/searchable")
      .then(r => {
        const list = r.data?.tracks || [];
        setTracks(list);
        // Seed on_air state from track docs (they include on_air field)
        const map = {};
        list.forEach(t => { map[t.id] = t.on_air !== false; });
        setOnAirState(map);
      })
      .catch(() => setTracks([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return tracks.filter(t => {
      if (filter !== "all" && t.kind !== filter) return false;
      if (!q) return true;
      return (t.title || "").toLowerCase().includes(q) ||
             (t.artist || "").toLowerCase().includes(q);
    });
  }, [tracks, search, filter]);

  const backend = process.env.REACT_APP_BACKEND_URL;
  const downloadUrl = (id) => `${backend}/api/suno_audio/track_${id}.mp3`;

  const togglePreview = (id) => {
    if (previewId === id) {
      // Already previewing → stop
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
      setPreviewId(null);
      return;
    }
    // Stop any current preview
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    const a = new Audio(downloadUrl(id));
    a.volume = 0.9;
    a.play().catch(() => toast.error("Preview: impossibile riprodurre"));
    a.addEventListener("ended", () => setPreviewId(null));
    previewAudioRef.current = a;
    setPreviewId(id);
  };

  const toggleOnAir = async (id, current) => {
    const next = !current;
    setOnAirState(s => ({ ...s, [id]: next }));  // optimistic
    try {
      const fd = new FormData();
      fd.append("on_air", next ? "true" : "false");
      const r = await fetch(`${backend}/api/admin/tracks/${id}/on-air`, { method: "POST", body: fd });
      if (!r.ok) throw new Error((await r.json().catch(()=>({}))).detail || r.statusText);
      toast.success(next ? "Brano ON AIR" : "Brano OFF (escluso dalla rotazione)");
    } catch (e) {
      setOnAirState(s => ({ ...s, [id]: current }));  // rollback
      toast.error(`Errore: ${e.message}`);
    }
  };

  // Stop preview when panel unmounts
  useEffect(() => () => {
    if (previewAudioRef.current) {
      try { previewAudioRef.current.pause(); } catch (e) {}
    }
  }, []);

  const typeBadge = (kind) => {
    const styles = {
      song:   { bg: "bg-pink-500/15", txt: "text-pink-300",  label: "Song" },
      jingle: { bg: "bg-cyan-500/15", txt: "text-cyan-300",  label: "Jingle" },
      anthem: { bg: "bg-yellow-500/15", txt: "text-yellow-300", label: "Inno" },
    };
    const s = styles[kind] || { bg: "bg-white/10", txt: "text-white", label: kind };
    return (
      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${s.bg} ${s.txt}`}>
        {s.label}
      </span>
    );
  };

  return (
    <section data-testid="track-manager-panel" className="lg:col-span-4 card-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <div className="label-mono flex items-center gap-2">
            <Music2 className="w-4 h-4 text-pink-400" /> Archivio Brani · Gestione unificata
          </div>
          <h2 className="font-display font-black text-2xl mt-1">
            {loading ? "Carico…" : `${tracks.length} brani in libreria`}
          </h2>
        </div>
        <button
          data-testid="add-new-track-btn"
          onClick={() => setModal({ kind: "new" })}
          className="btn-primary flex items-center gap-2"
        >
          <Upload className="w-4 h-4" /> AGGIUNGI NUOVO
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <input
          data-testid="track-search"
          type="text"
          placeholder="Cerca per nome o artista…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[220px] bg-zinc-900 border border-white/10 rounded px-3 py-2 text-sm text-white"
        />
        <div className="flex gap-1">
          {[
            { k: "all",    label: "Tutti" },
            { k: "song",   label: "Song" },
            { k: "jingle", label: "Jingle" },
            { k: "anthem", label: "Inno" },
          ].map(f => (
            <button
              key={f.k}
              data-testid={`filter-${f.k}`}
              onClick={() => setFilter(f.k)}
              className={`px-3 py-1.5 rounded text-xs font-mono uppercase border transition ${
                filter === f.k
                  ? "border-pink-500 text-pink-300 bg-pink-500/10"
                  : "border-white/10 text-zinc-400 hover:border-white/30"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="text-xs text-zinc-500 mb-2 font-mono">
        Mostrati: {filtered.length} / {tracks.length}
      </div>

      <div className="max-h-[560px] overflow-y-auto rounded border border-white/5">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-zinc-900/95 backdrop-blur">
            <tr className="text-left text-[10px] uppercase tracking-widest text-zinc-500">
              <th className="px-3 py-2 font-mono">Nome</th>
              <th className="px-3 py-2 font-mono w-20">Tipo</th>
              <th className="px-3 py-2 font-mono w-16 text-center">Preview</th>
              <th className="px-3 py-2 font-mono w-24 text-center">In Onda</th>
              <th className="px-3 py-2 font-mono w-24 text-center">Download</th>
              <th className="px-3 py-2 font-mono w-28 text-center">Sostituisci</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-500 text-sm">
                Nessun brano corrisponde ai filtri.
              </td></tr>
            )}
            {filtered.map(t => {
              const isOn = onAirState[t.id] !== false;
              const isPreviewing = previewId === t.id;
              return (
              <tr
                key={t.id}
                data-testid={`track-row-${t.id.slice(0,8)}`}
                className={`border-t border-white/[0.04] hover:bg-white/[0.03] ${!isOn ? "opacity-50" : ""}`}
              >
                <td className="px-3 py-2">
                  <div className="text-white font-medium truncate max-w-[420px]" title={t.title}>{t.title}</div>
                  <div className="text-[10px] text-zinc-500 font-mono">{t.artist} · {t.id.slice(0,8)}</div>
                </td>
                <td className="px-3 py-2">{typeBadge(t.kind)}</td>
                <td className="px-3 py-2 text-center">
                  <button
                    data-testid={`preview-${t.id.slice(0,8)}`}
                    onClick={() => togglePreview(t.id)}
                    className={`inline-flex items-center justify-center w-8 h-8 rounded-full border transition ${
                      isPreviewing
                        ? "bg-emerald-500/25 border-emerald-400 text-emerald-300"
                        : "bg-white/5 border-white/15 text-white hover:bg-white/10"
                    }`}
                    title={isPreviewing ? "Stop preview" : "Ascolta"}
                  >
                    {isPreviewing ? <PauseCircle className="w-4 h-4"/> : <PlayCircle className="w-4 h-4"/>}
                  </button>
                </td>
                <td className="px-3 py-2 text-center">
                  <button
                    data-testid={`onair-${t.id.slice(0,8)}`}
                    onClick={() => toggleOnAir(t.id, isOn)}
                    className={`inline-flex items-center gap-1 px-3 py-1 rounded text-xs font-mono uppercase border transition ${
                      isOn
                        ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/25"
                        : "bg-red-500/10 border-red-500/40 text-red-300 hover:bg-red-500/20"
                    }`}
                    title={isOn ? "Clicca per escludere dalla rotazione" : "Clicca per rimettere in rotazione"}
                  >
                    {isOn ? "ON" : "OFF"}
                  </button>
                </td>
                <td className="px-3 py-2 text-center">
                  <a
                    data-testid={`dl-${t.id.slice(0,8)}`}
                    href={downloadUrl(t.id)}
                    download={`${(t.title||'track').replace(/[^a-z0-9\-_ ]/gi,'_').slice(0,40)}.mp3`}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs hover:bg-cyan-500/20 transition"
                  >
                    <Download className="w-3 h-3" /> MP3
                  </a>
                </td>
                <td className="px-3 py-2 text-center">
                  <button
                    data-testid={`replace-${t.id.slice(0,8)}`}
                    onClick={() => setModal({ kind: "replace", target: t })}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded bg-pink-500/10 border border-pink-500/30 text-pink-300 text-xs hover:bg-pink-500/20 transition"
                  >
                    <Replace className="w-3 h-3" /> Sostituisci
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal && (
        <TrackModal
          mode={modal.kind}
          target={modal.target}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); load(); }}
        />
      )}
    </section>
  );
}


// TrackModal — used both for new upload and for replacement.
function TrackModal({ mode, target, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState(target?.kind === "jingle" ? "jingle" : "song");
  const [busy, setBusy] = useState(false);

  const isReplace = mode === "replace";

  const submit = async () => {
    if (!file)  { toast.error("Seleziona un file .mp3"); return; }
    if (!title.trim()) { toast.error("Il nome è obbligatorio"); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", isReplace ? "replace" : "new");
      fd.append("title", title.trim());
      fd.append("artist", "R-A.I.");
      // Replace preserves original kind; new upload uses user-selected kind.
      fd.append("kind", isReplace ? (target?.kind || "song") : kind);
      if (isReplace) fd.append("target_id", target.id);
      const backend = process.env.REACT_APP_BACKEND_URL;
      const resp = await fetch(`${backend}/api/admin/tracks/upload`, { method: "POST", body: fd });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      toast.success(isReplace
        ? `Sostituito: ${data.title}`
        : `Aggiunto: ${data.title}`);
      onDone();
    } catch (e) {
      toast.error(`Operazione fallita: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="track-modal"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="max-w-lg w-full bg-zinc-950 border border-white/10 rounded-xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4">
          <div className="label-mono flex items-center gap-2 text-pink-400">
            {isReplace ? <Replace className="w-4 h-4"/> : <Upload className="w-4 h-4"/>}
            {isReplace ? "Sostituisci brano" : "Aggiungi nuovo brano"}
          </div>
          <h3 className="font-display font-black text-xl mt-1 text-white">
            {isReplace ? target?.title : "Nuovo file MP3"}
          </h3>
          {isReplace && (
            <p className="text-xs text-zinc-500 mt-1">
              Il vecchio file verrà cancellato fisicamente. Il nuovo nome verrà
              mostrato immediatamente nel Player durante la riproduzione.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className="label-mono mb-1 block">File MP3</label>
            <input
              data-testid="modal-file"
              type="file"
              accept="audio/mpeg,.mp3"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full bg-zinc-900 border border-white/10 rounded px-3 py-2 text-white text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-pink-500/20 file:text-pink-300 file:cursor-pointer"
            />
            {file && (
              <span className="text-xs text-emerald-400 font-mono mt-1 block">
                {file.name} · {(file.size/1024/1024).toFixed(2)} MB
              </span>
            )}
          </div>

          <div>
            <label className="label-mono mb-1 block">
              {isReplace ? "Nuovo nome (obbligatorio)" : "Nome brano"}
            </label>
            <input
              data-testid="modal-title"
              type="text"
              autoFocus
              placeholder={isReplace ? "es. Inno_Sfumato" : "es. Notte Elettrica"}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-zinc-900 border border-white/10 rounded px-3 py-2 text-white"
            />
          </div>

          {!isReplace && (
            <div>
              <label className="label-mono mb-1 block">Tipo</label>
              <div className="flex gap-2">
                <button
                  data-testid="modal-kind-song"
                  onClick={() => setKind("song")}
                  className={`flex-1 py-2 rounded border font-mono text-xs uppercase transition ${
                    kind === "song"
                      ? "border-pink-500 text-pink-300 bg-pink-500/10"
                      : "border-white/10 text-zinc-400"
                  }`}
                >
                  🎵 Song
                </button>
                <button
                  data-testid="modal-kind-jingle"
                  onClick={() => setKind("jingle")}
                  className={`flex-1 py-2 rounded border font-mono text-xs uppercase transition ${
                    kind === "jingle"
                      ? "border-cyan-400 text-cyan-300 bg-cyan-500/10"
                      : "border-white/10 text-zinc-400"
                  }`}
                >
                  📣 Jingle
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            data-testid="modal-cancel"
            onClick={onClose}
            className="btn-outline px-4 py-2"
          >Annulla</button>
          <button
            data-testid="modal-submit"
            onClick={submit}
            disabled={busy || !file || !title.trim()}
            className="btn-primary px-4 py-2 flex items-center gap-2"
          >
            {busy ? "Attendi…" : (isReplace ? "Sostituisci" : "Aggiungi")}
          </button>
        </div>
      </div>
    </div>
  );
}



// ==================== BroadcastControlBar (top of Dashboard) ====================
// Play / Pause / Skip / Jingle NOW — each click propagates to every
// listener's browser via /api/admin/command. Listeners poll every ~3s.
function BroadcastControlBar() {
  const [busy, setBusy] = useState(null);
  const [state, setState] = useState({ command_seq: 0, last_command: null, mode: "auto" });

  const refresh = React.useCallback(async () => {
    try {
      const r = await api.get("/station/mode");
      setState(r.data || {});
    } catch (e) { /* silent */ }
  }, []);
  useEffect(() => { refresh(); const iv = setInterval(refresh, 4000); return () => clearInterval(iv); }, [refresh]);

  const send = async (cmd) => {
    setBusy(cmd);
    try {
      const fd = new FormData();
      fd.append("cmd_type", cmd);
      const backend = process.env.REACT_APP_BACKEND_URL;
      const resp = await fetch(`${backend}/api/admin/command`, { method: "POST", body: fd });
      if (!resp.ok) throw new Error((await resp.json().catch(()=>({}))).detail || resp.statusText);
      const data = await resp.json();
      const labels = { skip: "Skip inviato", pause: "Pause inviato", resume: "Play inviato", jingle_now: "Jingle inviato" };
      toast.success(`${labels[cmd] || cmd} · seq #${data.command_seq}`);
      refresh();
    } catch (e) {
      toast.error(`Errore: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  const isLive = state.mode === "auto";
  const modeLabel = { auto: "PILOTA AI", manual: "MANUAL LINE-IN", live_external: "LIVE ESTERNO" }[state.mode] || state.mode;

  const cmds = [
    { key: "resume",     label: "Play",   icon: PlayCircle,  bg: "bg-emerald-500/15", br: "border-emerald-400/40", tx: "text-emerald-300" },
    { key: "pause",      label: "Pause",  icon: PauseCircle, bg: "bg-amber-500/15",   br: "border-amber-400/40",   tx: "text-amber-300" },
    { key: "skip",       label: "Skip",   icon: ChevronRight,bg: "bg-cyan-500/15",    br: "border-cyan-400/40",    tx: "text-cyan-300" },
    { key: "jingle_now", label: "Jingle", icon: Sparkles,    bg: "bg-pink-500/15",    br: "border-pink-400/40",    tx: "text-pink-300" },
  ];

  return (
    <section data-testid="broadcast-control-bar" className="lg:col-span-4 rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="label-mono text-cyan-300 flex items-center gap-2">
            <Radio className="w-4 h-4" /> Comandi broadcast
          </div>
          <span
            data-testid="broadcast-mode-badge"
            className={`px-3 py-1 rounded-full text-[10px] font-mono uppercase tracking-widest border ${
              isLive
                ? "bg-emerald-500/15 border-emerald-400 text-emerald-300"
                : state.mode === "live_external"
                  ? "bg-cyan-500/15 border-cyan-400 text-cyan-300"
                  : "bg-fuchsia-500/15 border-fuchsia-400 text-fuchsia-300"
            }`}
          >
            {modeLabel}
          </span>
          {state.last_command && (
            <span className="text-xs text-zinc-500 font-mono truncate">
              last: {state.last_command.type} #{state.command_seq}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0" />
        <div className="flex flex-wrap gap-2">
          {cmds.map(c => {
            const Icon = c.icon;
            return (
              <button
                key={c.key}
                data-testid={`broadcast-cmd-${c.key}`}
                onClick={() => send(c.key)}
                disabled={busy === c.key}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition text-sm font-semibold ${c.bg} ${c.br} ${c.tx} hover:brightness-125 disabled:opacity-40`}
              >
                <Icon className="w-4 h-4" />
                {busy === c.key ? "…" : c.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-3 text-[11px] text-zinc-500 font-mono">
        I comandi vengono applicati su tutti i browser ascoltatori entro ~3 secondi (polling).
      </div>
    </section>
  );
}


// ==================== LiveExternalPanel ====================
// Switch listeners to an Icecast/Shoutcast URL so the admin can broadcast
// live voice from a real webcast service (Zeno.FM etc.).
function LiveExternalPanel() {
  const [state, setState] = useState({ mode: "auto", manual_stream_url: "" });
  const [urlDraft, setUrlDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);

  const load = React.useCallback(async () => {
    try {
      const r = await api.get("/station/mode");
      setState(r.data || {});
      setUrlDraft(r.data?.manual_stream_url || "");
    } catch (e) {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveUrl = async () => {
    const url = urlDraft.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      toast.error("URL deve iniziare con http:// o https://");
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("url", url);
      const backend = process.env.REACT_APP_BACKEND_URL;
      const resp = await fetch(`${backend}/api/station/stream-url`, { method: "POST", body: fd });
      if (!resp.ok) throw new Error((await resp.json().catch(()=>({}))).detail || resp.statusText);
      toast.success(url ? "URL streaming salvato" : "URL rimosso");
      load();
    } catch (e) {
      toast.error(`Errore: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const switchMode = async (mode) => {
    if (mode === "live_external" && !state.manual_stream_url) {
      toast.error("Salva prima un URL streaming");
      return;
    }
    setSwitching(true);
    try {
      const params = new URLSearchParams({ mode });
      await api.post(`/station/mode?${params.toString()}`);
      toast.success(mode === "live_external" ? "LIVE MANUALE attivo · listener passano al tuo stream" : "Ritorno a PILOTA AI");
      load();
    } catch (e) {
      toast.error("Errore cambio modalità");
    } finally {
      setSwitching(false);
    }
  };

  const isLive = state.mode === "live_external";

  return (
    <section data-testid="live-external-panel" className="lg:col-span-4 card-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="label-mono flex items-center gap-2">
            <Mic className="w-4 h-4 text-cyan-400" /> Live Manuale · Webcast esterno
          </div>
          <h2 className="font-display font-black text-2xl mt-1">
            {isLive ? "LIVE MANUALE ATTIVO" : "PILOTA AI"}
          </h2>
          <p className="text-zinc-400 text-sm mt-1 max-w-xl">
            Quando attivi <strong>LIVE MANUALE</strong>, i listener passano allo stream Icecast/Shoutcast
            che indichi qui sotto. La rotazione AI (Leo, Aria, Max, Suno) si ferma
            per tutti fino a quando torni su <strong>PILOTA AI</strong>.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            data-testid="switch-to-ai"
            onClick={() => switchMode("auto")}
            disabled={switching || state.mode === "auto"}
            className={`px-4 py-2 rounded-lg border text-sm font-semibold transition ${
              state.mode === "auto"
                ? "bg-emerald-500/20 border-emerald-400 text-emerald-300"
                : "border-white/15 text-zinc-300 hover:border-emerald-400/60"
            }`}
          >
            🤖 PILOTA AI
          </button>
          <button
            data-testid="switch-to-live"
            onClick={() => switchMode("live_external")}
            disabled={switching}
            className={`px-4 py-2 rounded-lg border text-sm font-semibold transition ${
              isLive
                ? "bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-lg shadow-cyan-500/20"
                : "border-white/15 text-zinc-300 hover:border-cyan-400/60"
            }`}
          >
            🎙️ LIVE MANUALE
          </button>
        </div>
      </div>

      <div className="p-4 rounded-lg bg-black/30 border border-white/5">
        <label className="label-mono block mb-2">URL streaming (Icecast/Shoutcast)</label>
        <div className="flex flex-wrap gap-2">
          <input
            data-testid="stream-url-input"
            type="url"
            placeholder="es. https://stream.zeno.fm/xxxxxxxxxx"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            className="flex-1 min-w-[280px] bg-zinc-900 border border-white/10 rounded px-3 py-2 text-sm font-mono text-white"
          />
          <button
            data-testid="stream-url-save"
            onClick={saveUrl}
            disabled={saving}
            className="btn-primary px-4 py-2 text-sm"
          >
            {saving ? "Salvo…" : "Salva URL"}
          </button>
        </div>
        <div className="mt-3 text-[11px] text-zinc-500 font-mono">
          Corrente: <span className="text-cyan-300">{state.manual_stream_url || "(non impostato)"}</span>
        </div>
      </div>

      <details className="mt-4 rounded-lg bg-cyan-500/[0.04] border border-cyan-500/20 p-4 text-sm">
        <summary className="cursor-pointer text-cyan-300 font-semibold">
          💡 Come ottenere un URL streaming gratuito (Zeno.FM)
        </summary>
        <ol className="mt-3 space-y-2 text-zinc-300 list-decimal list-inside">
          <li>Vai su <a className="underline text-cyan-300" href="https://zeno.fm" target="_blank" rel="noopener noreferrer">zeno.fm</a> e registra un account (gratis, no carta).</li>
          <li>Clicca "<em>Create station</em>", scegli un nome (es. "R-A.I. Live") e completa il wizard.</li>
          <li>Nella tua station dashboard trovi il campo <em>"Stream URL"</em> — copialo. Formato: <code className="text-cyan-300 bg-black/40 px-1 rounded">https://stream.zeno.fm/xxxxxxxxxx</code></li>
          <li>Incolla quell'URL nel campo qui sopra e clicca <strong>"Salva URL"</strong>.</li>
          <li>Per trasmettere in diretta usa <strong>Zeno Studio</strong> (app web dalla loro dashboard) oppure un client come <strong>BUTT / Mixxx / OBS</strong> con le credenziali <em>source</em> che Zeno ti dà.</li>
          <li>Quando sei in onda su Zeno, clicca <strong>"LIVE MANUALE"</strong> qui sopra: tutti i listener di r-ai.it sentiranno la tua voce entro pochi secondi.</li>
          <li>Per tornare alla musica AI clicca <strong>"PILOTA AI"</strong>.</li>
        </ol>
        <div className="mt-3 text-[11px] text-zinc-500">
          Alternative: <em>Radio.co</em> (trial 7 gg), <em>AzuraCast</em> (self-hosted, gratis se hai un VPS), <em>Shoutcast Directory</em> (gratis, richiede software).
        </div>
      </details>
    </section>
  );
}



// One-click sync from preview → production (r-ai.it)
function SyncToProductionButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [target, setTarget] = useState("https://r-ai.it");

  const doSync = async () => {
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("target_url", target);
      const backend = process.env.REACT_APP_BACKEND_URL;
      const resp = await fetch(`${backend}/api/admin/db/sync-to-production`, { method: "POST", body: fd });
      if (!resp.ok) throw new Error((await resp.json().catch(()=>({}))).detail || resp.statusText);
      const data = await resp.json();
      setResult(data);
      const s = data.production_response?.stats || {};
      toast.success(`Sync OK: inseriti ${s.inserted||0}, aggiornati ${s.updated||0}, totale prod ${s.total_in_db_after||"?"}`);
    } catch (e) {
      toast.error(`Sync fallito: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <input
        data-testid="sync-target-url"
        type="url"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        className="w-full bg-zinc-900 border border-white/10 rounded px-2 py-1 text-xs font-mono text-white mb-2"
      />
      <button
        data-testid="sync-to-prod-btn"
        onClick={doSync}
        disabled={busy}
        className="w-full btn-primary py-2 text-sm flex items-center justify-center gap-2"
      >
        <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Sincronizzo…" : "SINCRONIZZA CON R-AI.IT"}
      </button>
      {result && (
        <div data-testid="sync-result" className="mt-2 text-[11px] font-mono text-emerald-300">
          ✓ inviati {result.sent_tracks} record
        </div>
      )}
    </div>
  );
}


// Rotation rules — jingle_every_n / dj_talk_every_n
function RotationRulesPanel() {
  const [j, setJ] = useState(2);
  const [d, setD] = useState(4);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/admin/rotation-rules")
      .then(r => {
        setJ(r.data?.jingle_every_n_songs ?? 2);
        setD(r.data?.dj_talk_every_n_songs ?? 4);
        setLoaded(true);
      });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("jingle_every_n_songs", String(j));
      fd.append("dj_talk_every_n_songs", String(d));
      const backend = process.env.REACT_APP_BACKEND_URL;
      const r = await fetch(`${backend}/api/admin/rotation-rules`, { method: "POST", body: fd });
      if (!r.ok) throw new Error((await r.json().catch(()=>({}))).detail || r.statusText);
      toast.success(`Regole salvate: jingle ogni ${j}, DJ ogni ${d}`);
    } catch (e) {
      toast.error(`Errore: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section data-testid="rotation-rules-panel" className="lg:col-span-4 card-surface p-6">
      <div className="mb-4">
        <div className="label-mono flex items-center gap-2">
          <Sliders className="w-4 h-4 text-amber-400" /> Impostazioni Rotazione · Palinsesto
        </div>
        <h2 className="font-display font-black text-2xl mt-1">Cadenze automatiche</h2>
        <p className="text-zinc-400 text-sm mt-1">
          Il palinsesto rispetta queste due regole in tempo reale. Il time signal all'ora piena è sempre incluso.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="p-4 rounded bg-white/[0.03] border border-white/5">
          <label className="label-mono block mb-2">Jingle ogni <span className="text-pink-300">N</span> brani</label>
          <input
            data-testid="rule-jingle-n"
            type="number" min={1} max={20}
            value={j}
            onChange={(e) => setJ(Number(e.target.value)||1)}
            className="w-full bg-zinc-900 border border-white/10 rounded px-3 py-2 text-2xl font-mono text-pink-300 text-center"
          />
          <div className="text-xs text-zinc-500 mt-1">Attuale: 1 jingle brandizzato ogni {j} brani musicali</div>
        </div>
        <div className="p-4 rounded bg-white/[0.03] border border-white/5">
          <label className="label-mono block mb-2">DJ parla ogni <span className="text-cyan-300">Y</span> brani</label>
          <input
            data-testid="rule-dj-n"
            type="number" min={1} max={20}
            value={d}
            onChange={(e) => setD(Number(e.target.value)||1)}
            className="w-full bg-zinc-900 border border-white/10 rounded px-3 py-2 text-2xl font-mono text-cyan-300 text-center"
          />
          <div className="text-xs text-zinc-500 mt-1">Attuale: 1 rubrica DJ (Leo/Aria/Max) ogni {d} brani musicali</div>
        </div>
      </div>
      <div className="mt-4">
        <button
          data-testid="rules-save"
          onClick={save}
          disabled={!loaded || saving}
          className="btn-primary px-4 py-2 flex items-center gap-2"
        >
          {saving ? "Salvo…" : "Applica al palinsesto"}
        </button>
      </div>
    </section>
  );
}



// ==================== CommunityPanel — "A.I. Vs Umani" ====================
function CommunityPanel() {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await endpoints.communityList();
      setTracks(r?.tracks || []);
    } catch (e) {
      toast.error("Impossibile caricare i brani community");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const onToggle = async (id) => {
    setBusyId(id);
    try {
      const r = await endpoints.communityToggle(id);
      setTracks(prev => prev.map(t => t.id === id ? { ...t, status: r.status } : t));
      toast.success(`Brano ora ${r.status.toUpperCase()}`);
    } catch (e) {
      toast.error("Errore toggle");
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (id, title) => {
    if (!window.confirm(`Eliminare definitivamente "${title}"?`)) return;
    setBusyId(id);
    try {
      await endpoints.communityDelete(id);
      setTracks(prev => prev.filter(t => t.id !== id));
      toast.success("Brano eliminato");
    } catch (e) {
      toast.error("Errore eliminazione");
    } finally {
      setBusyId(null);
    }
  };

  const audioUrl = (path) => endpoints.audioUrl(path);
  const fmtDate = (iso) => {
    try { return new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch { return iso; }
  };

  return (
    <section data-testid="community-panel" className="lg:col-span-4 card-surface p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-display font-black text-xl flex items-center gap-2">
            <Users className="w-5 h-5 text-pink-400" />
            A.I. Vs Umani — Brani Community
          </h3>
          <div className="text-xs text-zinc-500 mt-1 font-mono">
            {tracks.length} brani caricati · {tracks.filter(t => t.status === "on").length} attivi
          </div>
        </div>
        <button
          data-testid="community-refresh-btn"
          onClick={load}
          className="btn-outline text-xs px-3 py-1.5 flex items-center gap-1"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Aggiorna
        </button>
      </div>

      {loading ? (
        <div className="text-zinc-500 text-sm py-8 text-center">Caricamento…</div>
      ) : tracks.length === 0 ? (
        <div
          data-testid="community-empty"
          className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500 text-sm"
        >
          Nessun brano caricato dalla community.
          <br />
          Il pulsante "Inviaci il tuo brano" in home apre il form di upload pubblico.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full text-sm" data-testid="community-tracks-table">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-zinc-500 border-b border-zinc-800">
                <th className="py-2 pr-3">Stato</th>
                <th className="py-2 pr-3">Titolo</th>
                <th className="py-2 pr-3">Autore</th>
                <th className="py-2 pr-3">Ascolto</th>
                <th className="py-2 pr-3">Dimensione</th>
                <th className="py-2 pr-3">Inviato</th>
                <th className="py-2 pr-3 text-right">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {tracks.map(t => (
                <tr key={t.id} className="border-b border-zinc-900" data-testid={`community-row-${t.id}`}>
                  <td className="py-3 pr-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold tracking-widest ${
                        t.status === "on"
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                          : "bg-zinc-800 text-zinc-500 border border-zinc-700"
                      }`}
                    >
                      {t.status === "on" ? "ON AIR" : "OFF"}
                    </span>
                  </td>
                  <td className="py-3 pr-3 font-semibold text-white max-w-[220px] truncate" title={t.title}>
                    {t.title}
                  </td>
                  <td className="py-3 pr-3 text-zinc-300 max-w-[160px] truncate" title={t.author}>
                    {t.author}
                  </td>
                  <td className="py-3 pr-3">
                    <audio
                      controls
                      preload="none"
                      src={audioUrl(t.audio_url)}
                      data-testid={`community-audio-${t.id}`}
                      style={{ height: 32, maxWidth: 260 }}
                    />
                  </td>
                  <td className="py-3 pr-3 text-xs text-zinc-500 font-mono">
                    {(t.file_size / 1024 / 1024).toFixed(2)} MB
                  </td>
                  <td className="py-3 pr-3 text-xs text-zinc-500 font-mono whitespace-nowrap">
                    {fmtDate(t.submitted_at)}
                  </td>
                  <td className="py-3 pr-0 text-right whitespace-nowrap">
                    <button
                      data-testid={`community-toggle-${t.id}`}
                      onClick={() => onToggle(t.id)}
                      disabled={busyId === t.id}
                      className={`text-xs px-3 py-1.5 rounded-full font-semibold mr-2 disabled:opacity-40 ${
                        t.status === "on"
                          ? "bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700"
                          : "bg-emerald-500 text-black hover:bg-emerald-400"
                      }`}
                    >
                      {t.status === "on" ? "Metti OFF" : "Metti ON"}
                    </button>
                    <button
                      data-testid={`community-delete-${t.id}`}
                      onClick={() => onDelete(t.id, t.title)}
                      disabled={busyId === t.id}
                      className="text-xs px-3 py-1.5 rounded-full font-semibold bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30 disabled:opacity-40 inline-flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Elimina
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
