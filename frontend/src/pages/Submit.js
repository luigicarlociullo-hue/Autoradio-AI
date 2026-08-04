import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { endpoints } from "@/lib/api";
import { Button } from "@/components/ui/button";

export default function Submit() {
  const navigate = useNavigate();
  const [author, setAuthor] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState(null);
  const [copyrightOk, setCopyrightOk] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ok, setOk] = useState(false);

  const MAX_MB = 15;

  const onFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) { setFile(null); return; }
    if (!f.name.toLowerCase().endsWith(".mp3")) {
      toast.error("Solo file .mp3 sono accettati");
      e.target.value = "";
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      toast.error(`File troppo grande (max ${MAX_MB} MB)`);
      e.target.value = "";
      return;
    }
    setFile(f);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!author.trim() || author.trim().length < 2) {
      toast.error("Inserisci il tuo nome (2-60 caratteri)");
      return;
    }
    if (!title.trim() || title.trim().length < 2) {
      toast.error("Inserisci il titolo del brano");
      return;
    }
    if (!file) {
      toast.error("Seleziona un file MP3");
      return;
    }
    if (!copyrightOk) {
      toast.error("Devi accettare la dichiarazione di copyright");
      return;
    }

    const fd = new FormData();
    fd.append("author", author.trim());
    fd.append("title", title.trim());
    fd.append("copyright_ok", "true");
    fd.append("file", file);

    setSubmitting(true);
    try {
      const res = await endpoints.communitySubmit(fd);
      if (res?.ok) {
        setOk(true);
        toast.success("Brano ricevuto! L'admin lo valuterà a breve.");
      } else {
        toast.error("Errore durante l'invio, riprova.");
      }
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || "Errore di rete";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="max-w-4xl mx-auto flex items-center justify-between px-6 py-6">
        <Link to="/" data-testid="submit-back-home" className="text-sm text-zinc-400 hover:text-white transition">
          &larr; Torna a R-A.I.
        </Link>
        <div className="text-xs font-mono tracking-widest text-pink-500">A.I. VS UMANI · UPLOAD</div>
      </header>

      <main className="max-w-2xl mx-auto px-6 pb-24">
        <h1 className="text-4xl sm:text-5xl font-black mt-8 leading-none">
          <span className="text-white">Inviaci il tuo brano.</span>
          <br />
          <span className="text-pink-500">Sfida le A.I.</span>
        </h1>
        <p className="mt-6 text-zinc-400 leading-relaxed">
          Sei un umano che fa musica? Manda il tuo brano MP3.
          Se supera la selezione lo mettiamo in onda su R-A.I. dentro il segmento
          <strong className="text-pink-400"> "A.I. Vs Umani"</strong> — la sfida tra
          intelligenze artificiali e artisti in carne e ossa.
        </p>

        {ok ? (
          <div
            data-testid="submit-success-panel"
            className="mt-10 rounded-2xl border border-pink-500/40 bg-pink-500/10 p-8 text-center"
          >
            <div className="text-2xl font-bold text-pink-400 mb-3">Grazie!</div>
            <div className="text-zinc-300 mb-6">
              Il tuo brano è arrivato. L'admin lo ascolta e decide se metterlo in onda.
            </div>
            <div className="flex gap-3 justify-center">
              <Button
                data-testid="submit-another-btn"
                onClick={() => { setOk(false); setAuthor(""); setTitle(""); setFile(null); setCopyrightOk(false); }}
                className="bg-pink-500 hover:bg-pink-400 text-black font-semibold"
              >
                Invia un altro brano
              </Button>
              <Button
                data-testid="submit-go-home"
                variant="outline"
                onClick={() => navigate("/")}
                className="border-zinc-700 text-zinc-200"
              >
                Torna alla radio
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-10 space-y-6" data-testid="submit-form">
            <div>
              <label className="block text-xs font-mono tracking-widest text-zinc-400 mb-2 uppercase">
                Nome autore
              </label>
              <input
                data-testid="submit-author-input"
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                maxLength={60}
                placeholder="Il tuo nome / nome d'arte"
                className="w-full rounded-xl bg-zinc-900 border border-zinc-800 focus:border-pink-500 outline-none px-4 py-3 text-white placeholder:text-zinc-600 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-mono tracking-widest text-zinc-400 mb-2 uppercase">
                Titolo del brano
              </label>
              <input
                data-testid="submit-title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={100}
                placeholder="Es. Notte a Milano"
                className="w-full rounded-xl bg-zinc-900 border border-zinc-800 focus:border-pink-500 outline-none px-4 py-3 text-white placeholder:text-zinc-600 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-mono tracking-widest text-zinc-400 mb-2 uppercase">
                File MP3 (max {MAX_MB} MB)
              </label>
              <input
                data-testid="submit-file-input"
                type="file"
                accept=".mp3,audio/mpeg"
                onChange={onFileChange}
                className="w-full text-sm text-zinc-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-pink-500 file:text-black hover:file:bg-pink-400 cursor-pointer"
              />
              {file && (
                <div className="mt-2 text-xs text-zinc-500 font-mono">
                  {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
                </div>
              )}
            </div>

            <label
              data-testid="submit-copyright-label"
              className="flex items-start gap-3 rounded-xl bg-zinc-900/60 border border-zinc-800 p-4 cursor-pointer hover:border-pink-500/50 transition"
            >
              <input
                data-testid="submit-copyright-checkbox"
                type="checkbox"
                checked={copyrightOk}
                onChange={(e) => setCopyrightOk(e.target.checked)}
                className="mt-1 h-4 w-4 accent-pink-500"
              />
              <span className="text-sm text-zinc-300 leading-relaxed">
                <strong className="text-white">Dichiaro sotto la mia responsabilità</strong> di
                essere l'autore/titolare dei diritti su questo brano oppure di avere
                l'autorizzazione a caricarlo, e concedo a R-A.I. il diritto di
                trasmetterlo gratuitamente nel palinsesto. Se non hai i diritti,
                <span className="text-pink-400"> NON caricare</span>.
              </span>
            </label>

            <Button
              type="submit"
              data-testid="submit-send-btn"
              disabled={submitting}
              className="w-full bg-pink-500 hover:bg-pink-400 text-black font-bold py-6 text-base tracking-wide disabled:opacity-50"
            >
              {submitting ? "Invio in corso..." : "Invia il brano"}
            </Button>

            <p className="text-xs text-zinc-500 text-center">
              I brani inviati vengono valutati dall'admin. Nessuna garanzia di messa in onda.
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
