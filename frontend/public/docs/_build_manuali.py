# Genera i 3 manuali HTML da testo (contenuto fornito dal Direttore, non riscritto) · v13.79
import html, re, os
D="/app/frontend/public/docs"
CSS = """
:root{--cyan:#007A8A;--ink:#0B1320;--muted:#5B6B7F;--line:#E2E8F0}
*{box-sizing:border-box}body{margin:0;font-family:Georgia,"Times New Roman",serif;color:var(--ink);background:#fff;line-height:1.6}
.toolbar{position:sticky;top:0;background:#02040A;color:#fff;padding:10px 16px;display:flex;gap:12px;align-items:center;font-family:"Courier New",monospace;font-size:12px;flex-wrap:wrap}
.toolbar a{color:#7DF9FF;text-decoration:none;border:1px solid #7DF9FF55;padding:4px 10px;border-radius:999px}
.wrap{max-width:880px;margin:0 auto;padding:44px 40px 80px}
.kicker{font-family:"Courier New",monospace;letter-spacing:.25em;text-transform:uppercase;color:var(--cyan);font-size:12px}
h1{font-size:32px;margin:6px 0 4px;line-height:1.1;border-bottom:3px solid var(--cyan);padding-bottom:14px}
h2{font-size:20px;margin:36px 0 8px;color:var(--cyan);page-break-after:avoid}
h3{font-size:16px;margin:26px 0 6px;page-break-after:avoid}
p,li{font-size:14.5px}ul{padding-left:22px}li{margin:4px 0}
.meta{color:var(--muted);font-size:13px}
figure{margin:18px 0;page-break-inside:avoid}figure img{width:100%;border:1px solid var(--line);border-radius:8px;display:block}
figcaption{font-size:13px;color:var(--muted);margin-top:6px}
footer{margin-top:48px;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
@media print{.toolbar{display:none}.wrap{padding:0;max-width:none}}
"""
def inline(t):
    t=html.escape(t)
    return re.sub(r"^([^:]{2,60}):", r"<b>\1</b>:", t) if ":" in t else t
def body_from_text(txt):
    out=[]; in_ul=False
    for raw in txt.strip("\n").split("\n"):
        line=raw.rstrip()
        if not line.strip():
            if in_ul: out.append("</ul>"); in_ul=False
            continue
        if line.startswith("- "):
            if not in_ul: out.append("<ul>"); in_ul=True
            out.append(f"<li>{inline(line[2:])}</li>"); continue
        if in_ul: out.append("</ul>"); in_ul=False
        if re.match(r"^\d+\. ", line): out.append(f"<h2>{html.escape(line)}</h2>"); continue
        if line.isupper() and len(line)<40: out.append(f"<h2>{html.escape(line.title())}</h2>"); continue
        out.append(f"<p>{html.escape(line)}</p>")
    if in_ul: out.append("</ul>")
    return "\n".join(out)
def page(slug,kicker,title,body,others):
    nav=" ".join(f'<a href="{o[0]}.html">→ {o[1]}</a>' for o in others)
    return f"""<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>R-A.I. Radio · {html.escape(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>{CSS}</style></head><body>
<div class="toolbar">R-A.I. RADIO · MANUALI <a href="{slug}.pdf" download>⬇ Scarica PDF</a> <a href="javascript:window.print()">🖨 Stampa</a> {nav}</div>
<div class="wrap"><div class="kicker">{html.escape(kicker)}</div><h1>{html.escape(title)}</h1>
<p class="meta">R-A.I. Radio · la prima radio italiana diretta da un'intelligenza artificiale · ottobre 2026</p>
{body}
<footer>R-A.I. Radio · {html.escape(title)} · Powered by L&amp;C Project</footer></div></body></html>"""

M1 = open(f"{D}/_src_manuale1.txt").read()
M2 = open(f"{D}/_src_manuale2.txt").read()
shots=[("01-broadcast-control-bar","BroadcastControlBar","La barra in cima alla Regia: Go Live, FM Mode, Automazione attiva, Live Command e LedWall mini-preview."),
("02-ai-master","AI Master","Dual Brain Leo vs Max, AI Speaker (ElevenLabs) e DJ Talk every N songs."),
("03-palinsesto","Palinsesto · Smart Flow Timeline","Fasce orarie, Appuntamenti Liberi, Segnale orario, Pre-segnale orario e cadenza jingle."),
("04-archivio-brani","Archivio Brani · Controllo Totale","Toggle ON/OFF, categorie, copertina e video, modifica con approvazione, Cestino."),
("05-ledwall","LedWall · InOverride","Libreria video/foto, monitor preview, Manda in diretta, Rimuovi override con conferma, indicatore di stato."),
("06-modalita-demo","Modalità Demo","Riproduce i vocali DJ registrati ogni 2-3 brani senza attivare API esterne."),
("07-club-notte","Club Notte","Sezione separata per la musica da DJ notturni, non collegata a Umani vs Algoritmo."),
("08-magazzino","Magazzino","Tutto il materiale caricato: upload MP3/MP4, Cestino, Segmenti vocali DJ.")]
M3 = "<p>Screenshot automatici delle sezioni principali della Regia (preview, ottobre 2026), ciascuno con il titolo della sezione e una riga descrittiva.</p>\n" + "\n".join(
  f'<h2>{i+1}. {html.escape(t)}</h2><figure><img src="shots/{f}.jpg" alt="{html.escape(t)}"><figcaption>{html.escape(d)}</figcaption></figure>' for i,(f,t,d) in enumerate(shots))
docs=[("manuale-1-tecnico-regia","Manuale 1","Manuale Tecnico Regia",body_from_text(M1)),
      ("manuale-2-presentazione","Manuale 2","Presentazione del Progetto",body_from_text(M2)),
      ("manuale-3-guida-visiva","Manuale 3","Guida Visiva con Screenshot",M3)]
for slug,k,t,b in docs:
    others=[(s,tt) for s,_,tt,_ in docs if s!=slug]
    open(f"{D}/{slug}.html","w").write(page(slug,k,t,b,others))
print("ok")
