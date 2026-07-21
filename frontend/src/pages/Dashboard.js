import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Radio, Power, Trash2, Sparkles, Zap, Music2, Newspaper, MessageCircle, LogOut, LogIn, Send, User, ChevronRight, Cpu, Users, RefreshCw, Megaphone, Euro, ExternalLink, Download, Archive } from "lucide-react";
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

        {/* Library downloader — lista brani + tasto Scarica ZIP + MP3 singolo */}
        <LibraryDownloader />

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
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState("all");
  const [zipping, setZipping] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [m, t] = await Promise.all([
          api.get("/admin/export/manifest").then(r => r.data).catch(() => null),
          api.get("/tracks").then(r => r.data).catch(() => []),
        ]);
        if (!alive) return;
        setManifest(m);
        setTracks(Array.isArray(t) ? t : []);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const categoryOf = (t) => {
    const tags = t.tags || [];
    if (t.is_anthem) return "anthem";
    if (t.is_jingle) return "jingles";
    if (t.is_seed) return "seed";
    if (t.status === "retired") return "retired";
    if (tags.includes("english_pop_dance")) return "english_pop_dance";
    if (tags.includes("italian_lean_v2") || tags.includes("summer_it") || tags.includes("tech_house_lean")) return "italian";
    return "other";
  };

  const CAT_LABELS = {
    english_pop_dance: "English Pop/Dance",
    italian: "Italiane",
    jingles: "Jingle R-A.I.",
    anthem: "Anthem",
    seed: "Seed",
    retired: "Ritirate",
    other: "Altre",
  };

  const filtered = React.useMemo(() => {
    return tracks
      .filter(t => t.audio_url && t.status !== "pending")
      .filter(t => filter === "all" || categoryOf(t) === filter);
  }, [tracks, filter]);

  const groups = React.useMemo(() => {
    const g = {};
    filtered.forEach(t => {
      const c = categoryOf(t);
      (g[c] = g[c] || []).push(t);
    });
    return g;
  }, [filtered]);

  const downloadZip = async () => {
    setZipping(true);
    try {
      const backend = process.env.REACT_APP_BACKEND_URL;
      const url = `${backend}/api/admin/export`;
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener";
      a.download = `rai_export_${new Date().toISOString().slice(0,10)}.zip`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 500);
      toast.success("Download ZIP avviato - attendi il completamento (puo' richiedere minuti)");
    } catch (e) {
      toast.error("Errore avvio download");
      console.error(e);
    } finally {
      setTimeout(() => setZipping(false), 1500);
    }
  };

  const singleDownloadUrl = (t) => {
    if (!t.audio_url) return null;
    const backend = process.env.REACT_APP_BACKEND_URL;
    return t.audio_url.startsWith("/api/")
      ? `${backend}${t.audio_url}`
      : t.audio_url;
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
              {manifest.suno_files} file audio ({manifest.suno_mb} MB) - {manifest.tracks_ready} tracce ready - {manifest.segments_total} segmenti registrati
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
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label={`Tutti (${tracks.filter(t => t.audio_url).length})`} testid="filter-all" />
        {Object.entries(CAT_LABELS).map(([key, label]) => {
          const count = tracks.filter(t => categoryOf(t) === key && t.audio_url).length;
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
        <div className="text-zinc-500 text-sm py-8 text-center">Nessun brano in questa categoria.</div>
      ) : (
        <div className="space-y-6 max-h-[600px] overflow-y-auto pr-2">
          {Object.entries(groups).map(([cat, list]) => (
            <div key={cat}>
              <div className="label-mono mb-2 text-cyan-400">{CAT_LABELS[cat] || cat} - {list.length}</div>
              <div className="space-y-1">
                {list.map(t => {
                  const url = singleDownloadUrl(t);
                  const fname = ((t.title || "untitled").replace(/[^\w\s-]/g, "").trim() || "untitled") + ".mp3";
                  return (
                    <div key={t.id} data-testid={`library-row-${t.id}`} className="flex items-center justify-between gap-3 py-2 px-3 rounded bg-white/[0.02] hover:bg-white/[0.05] border border-white/5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-sm">{t.title || "(senza titolo)"}</div>
                        <div className="truncate text-xs text-zinc-500">
                          {t.artist || "-"} - {t.genre || "-"} - {t.status}
                        </div>
                      </div>
                      {url ? (
                        <a
                          href={url}
                          download={fname}
                          data-testid={`download-mp3-${t.id}`}
                          className="btn-outline text-xs flex items-center gap-1 whitespace-nowrap"
                        >
                          <Download className="w-3 h-3" /> MP3
                        </a>
                      ) : (
                        <span className="text-xs text-zinc-600">no file</span>
                      )}
                    </div>
                  );
                })}
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

