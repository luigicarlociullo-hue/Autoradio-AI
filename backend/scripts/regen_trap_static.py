"""Re-render the 5 Italian trap tracks with HAND-WRITTEN full-structure lyrics.
The Emergent LLM budget is exhausted, so we bypass the LLM and use curated
lyrics inline. Each set of lyrics matches the requested structure:
    [Intro] [Verse 1] [Pre-Chorus] [Chorus] [Verse 2] [Pre-Chorus] [Chorus] [Bridge] [Outro]
"""
import asyncio
import sys
import os
from datetime import datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")

from motor.motor_asyncio import AsyncIOMotorClient
import httpx
import suno_service

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
SUNO_AUDIO_DIR = Path("/app/backend/static/suno")

# ---------- 5 hand-written lyrics (Italian trap, full structure) ----------

SILICIO_BLU = """[Intro]
Fra', c'è la città che respira in blu
Ogni finestra un cuore accesso lassù
Silicio blu, silicio blu

[Verse 1]
Cammino sul bordo di un display che si spegne
Ho un sogno nel palmo, la mano che regge
Palazzoni di vetro, la luna li specchia
Milano di notte è un'onda che pesca
Fra le luci del tram, fra i fumi del bar
Io scrivo il mio nome sull'asfalto che tarda
Cintura di sicurezza, ma il cuore va libero
Il freddo mi bacia, il domani è più tiepido

[Pre-Chorus]
E se il segnale non arriva
Io mi trasmetto lo stesso
Batteria quasi finita
Ma io ti prometto adesso

[Chorus]
Silicio blu, silicio blu
Sotto la pelle una luce che sai anche tu
Silicio blu, silicio blu
Il mondo è una foto, la vita di più
Se cade la rete io ti chiamo giù
Silicio blu, siamo noi due, siamo noi due

[Verse 2]
Portafoglio leggero, ma la testa è pesante
Ho i miei fra' nel passeggero, dietro un ricordo importante
La mia bimba mi scrive che le manca la voce
Le rispondo con un vocale che pesa più della croce
La periferia parla piano ma dice tutto
Ogni muro un testo che nessuno ha mai letto tutto
Io lo canto per loro, per chi accende la sera
Per chi tiene la giacca anche quando la strada libera

[Pre-Chorus]
E se il segnale si spezza
Io mi ricostruisco intero
Ogni cicatrice è una carezza
Che il passato non mi ha tolto per intero

[Chorus]
Silicio blu, silicio blu
Sotto la pelle un motore che sanno anche loro
Silicio blu, silicio blu
Il mondo è un filtro, l'anima è oro
Se cade la rete io ti tengo su
Silicio blu, siamo noi due, siamo noi due

[Bridge]
Fra', spegnilo il telefono
Guarda gli occhi che ho stanotte
Non è un colore, è un tempo
È il posto dove non hai porte

[Outro]
Silicio blu, silicio blu
Ogni finestra un cuore che batte lassù
Silicio blu
Silicio blu"""

PIOVE_RAM = """[Intro]
Estate che scorre, l'asfalto è un mare
Piove RAM, piove RAM
Nel telefono un cielo che sa nuotare

[Verse 1]
Ho lasciato il costume nel sedile posteriore
Nel gruppo un audio da tre minuti d'amore
Salerno riflette il sole come una moneta
Le tue foto girano, ma tu sei più segreta
Cuffie nell'orecchio, sabbia dentro le scarpe
Il tuo nome ritorna come le canzoni sparse
Io ti ho scritto "vieni", ma poi ho tolto il messaggio
La paura fra' è la vela del più grande viaggio

[Pre-Chorus]
Quando cade la connessione
Rimane solo la tua voce
Quando finisce la stagione
Io ho salvato la nostra rotta atroce

[Chorus]
Piove RAM sul lungomare
Ogni goccia una cosa da salvare
Piove RAM, tu mi vuoi chiamare
Ma il segnale è un ponte che sa crollare
Estate che dura, non ci fa dormire
Piove RAM, piove RAM, non vuole finire

[Verse 2]
Cabriolet aperto, tetto scoperto, cash sul cruscotto
Ma la ricchezza vera è come tu ridi di sotto
Ombrellone bianco, mojito che scioglie il ghiaccio
Tu che dici "resta" e io che resto in ostaggio
Ho un tatuaggio nuovo con la tua data d'ingresso
La mia crew mi dice "fra', sei diverso adesso"
Certo che son diverso, chi ti trova non torna indietro
La marea sale in fretta, io la guardo dallo specchio

[Pre-Chorus]
Quando parte la stagione
Rimane solo il tuo profumo
Quando spegnamo il navigatore
Tu resti l'unica strada che assumo

[Chorus]
Piove RAM sull'autostrada
Ogni goccia una promessa strana
Piove RAM, tu mi guardi e stana
Ogni pensiero, ogni parte umana
Estate che gira, ci fa impazzire
Piove RAM, piove RAM, non sa finire

[Bridge]
Fra', se il mondo poi cade
Io ti tengo la mano
Sotto la pioggia digitale
Restiamo veri, restiamo umani

[Outro]
Piove RAM sul lungomare
Estate che scorre, l'asfalto è un mare
Piove RAM
Piove RAM"""

MARTE_IN_DO_MINORE = """[Intro]
Marte in do minore, la notte non risponde
Guardo il satellite che orbita e nasconde
Il tuo nome tra le stelle, il mio cuore tra le onde

[Verse 1]
Ti ho persa in un aeroporto senza gate d'imbarco
Ora dormo con la luce accesa, non è un caso
Il tuo profumo sull'asciugamano è ancora un varco
Ti chiamo Marte perché sei distante e ti abbraccio
La mia stanza è un pianeta senza atmosfera
Cardigan sulla sedia dove tu ti mettevi la sera
Ho il tuo film preferito in pausa da settembre
Ogni volta che lo apro mi si spezza una lente

[Pre-Chorus]
E se torni dallo spazio
Io ti aspetto senza radio
Il silenzio è il mio saluto
Il mio cuore è un astro muto

[Chorus]
Marte in do minore, la mia voce ti scrive
Un messaggio che nessun'antenna riceve
Marte in do minore, io ti amo per sette vite
Anche se la gravità delle scelte ci divide
Se tu piangi, piove qui
Se tu ridi, io sopravvivo così

[Verse 2]
Ho comprato la tua giacca in un negozio uguale
Ma l'odore non è mai lo stesso, non è mai reale
La mia crew mi dice "fra', devi voltare pagina"
Io rispondo "questa pagina è la mia magia gitana"
Ho un tatuaggio a forma di orbita sul polso
Un cerchio che non si chiude, come il nostro discorso
Le tue lettere in una scatola sotto il letto
Ogni riga un pianeta, ogni pianeta un rimpianto stretto

[Pre-Chorus]
E se rispondi dallo spazio
Io ti prometto senza radio
Il silenzio è il mio saluto
Il mio cuore è ancora acuto

[Chorus]
Marte in do minore, la mia voce ti chiama
Nessun segnale ma io sento la fiamma
Marte in do minore, io ti tengo la mano
Anche a milioni di chilometri lontano
Se tu piangi, piove qui
Se tu ridi, io respiro così

[Bridge]
Guardo il cielo di gennaio, tu sei il punto più rosso
Guardo il cielo di dicembre, tu sei sempre nel focus
Non è mania, non è ossessione
È solo un cuore che segue una traiezione

[Outro]
Marte in do minore, la notte non risponde
Ma il tuo nome tra le stelle mi risponde
Marte in do minore
Marte in do minore"""

NEON_RIVIERE = """[Intro]
Neon Rivière, la strada è un flipper
Luci che tremano, la crew che spinge
Neon Rivière, brr

[Verse 1]
Rimini che vibra, sabbia sulle sneakers
Ho i miei fra' nel van, cassa che spara i bpm
Ristorante di pesce, ma dopo il locale
Aperitivo alle sei e la festa non ha finale
La tipa che balla ha gli occhi di gioielleria
Mi guarda, mi sorride, poi torna sulla via
Cash nel calzino, sorriso nel taschino
Estate italiana, la nostra medicina

[Pre-Chorus]
Se sale il volume, sale la febbre
Se scende la luce, sale la lepre
Non c'è freno, non c'è confine
Neon Rivière, siamo divine

[Chorus]
Neon Rivière, dance sulla passerella
Ogni riva è una promessa più bella
Neon Rivière, la notte è una fella
Che ci prende e ci porta alla stella
Balla, balla, non fermare mai
Neon Rivière, che vita che fai

[Verse 2]
Prosecco che scorre, coriandoli falsi
Ma il momento è vero, il ricordo si accumula altrove
Autoradio impazzita con una nostra vecchia hit
La mia crew canta a squarciagola, "bro, tu sei il vip"
Skrrt sul lungomare, moto rombante
Il mio giubbotto Iuventus regalo di un fan importante
Non è arroganza, è la voglia di essere qui
Ogni notte estiva è un altro sì

[Pre-Chorus]
Se sale il beat, sale il cuore
Se scende la paura, sale il valore
Non c'è freno, non c'è dogana
Neon Rivière, la vita galleggia sana

[Chorus]
Neon Rivière, dance sotto la palma
Ogni onda è un'altra storia calma
Neon Rivière, la notte è una salma
Che rinasce col sole in maglia più larga
Balla, balla, non stancare mai
Neon Rivière, che vita che fai

[Bridge]
Fra', domani è un altro giorno
Ma stanotte è il nostro trono
Guarda le luci, non contare i minuti
La memoria è un tesoro che non si è mai perduto

[Outro]
Neon Rivière, la strada è un flipper
Luci che tremano, ma noi non svanivamo
Neon Rivière
Neon Rivière"""

ECOLALIA = """[Intro]
Ecolalia, ecolalia
La mia voce ripete finché non è più mia
Ecolalia

[Verse 1]
Mi ripeto le stesse parole per capire
Chi sono io, chi resta dopo aver dovuto mentire
Lo specchio del bagno di casa è un vecchio giudice
Mi guarda mentre parlo, sorride e non risponde
Ho un audio nel drafts da tre settimane
Non lo mando perché ho paura del mio stesso nome
Cammino di notte sul lungotevere
La città dorme ma i pensieri no, quelli non cedere

[Pre-Chorus]
E se dico "sto bene"
È un mantra, non una verità
Se dico "ti amo ancora"
Forse è solo eco, forse è già vetà

[Chorus]
Ecolalia, ecolalia
La mia voce ripete finché non è più mia
Le stesse parole in una filastrocca notturna
Io le canto, ma è il mio silenzio che le governa
Ecolalia, ecolalia
Chi mi sente, mi restituisce la mia poesia

[Verse 2]
Ho una scatola in soffitta con i miei quaderni di scuola
Le stesse frasi ripetute, la stessa mano che vola
Ero già io da bambino, solo con più coraggio
Ora c'è più struttura, ma meno passaggio
Il mio terapeuta dice "prova a dirlo diverso"
Ma se lo cambio, ho paura che si sposti l'universo
Ogni parola è un mattone, non posso spostarli
Ho paura che la casa cada se provo a girarli

[Pre-Chorus]
E se ripeto "sto vivendo"
Forse è solo un promemoria
Se ripeto "non mi arrendo"
Forse è già la mia vittoria

[Chorus]
Ecolalia, ecolalia
La mia voce ripete e forse è terapia
Le stesse parole diventano bussola vera
Io le canto e finalmente arriva la sera
Ecolalia, ecolalia
Chi mi sente, cammina in questa poesia

[Bridge]
E se un giorno la smettessi
Di ripetere all'infinito
Forse resterebbe solo il mio silenzio
Ma il silenzio ha un altro colore da capire

[Outro]
Ecolalia, ecolalia
La mia voce ripete finché non è più mia
Ma è tornata mia
Ecolalia"""


LYRICS_BY_ID_PREFIX = {
    "caae0af2": ("Silicio Blu", SILICIO_BLU),
    "003b9f74": ("Piove RAM", PIOVE_RAM),
    "71962f7f": ("Marte in Do minore", MARTE_IN_DO_MINORE),
    "784f449d": ("Neon Rivière", NEON_RIVIERE),
    "3b3e062a": ("Ecolalia", ECOLALIA),
}


async def download_mp3(url: str, dest: Path) -> bool:
    try:
        async with httpx.AsyncClient(timeout=180, follow_redirects=True) as h:
            r = await h.get(url)
            r.raise_for_status()
            dest.write_bytes(r.content)
        return True
    except Exception as e:
        print(f"      download failed: {e}", flush=True)
        return False


async def regen_one(db, track: dict, lyrics: str) -> dict:
    tid = track["id"]
    title = track["title"]
    genre = track["genre"]
    print(f"\n=== {tid[:8]} · {title} ===", flush=True)
    print(f"    genre: {genre}", flush=True)
    print(f"    lyrics: {len(lyrics)} chars, {lyrics.count(chr(10))+1} lines", flush=True)

    print("    [1/3] submitting Suno task with custom_lyrics…", flush=True)
    task_id = await suno_service.create_task(
        prompt=lyrics,
        style=genre,
        title=title,
        instrumental=False,
        custom_lyrics=lyrics,
    )
    if not task_id:
        return {"id": tid, "status": "suno_submit_failed", "title": title}
    print(f"    suno taskId: {task_id}", flush=True)

    print("    [2/3] polling Suno (up to 6min)…", flush=True)
    song = await suno_service.poll_task(task_id, timeout_sec=420, interval_sec=10)
    if not song or not song.get("audio_url"):
        return {"id": tid, "status": "suno_render_failed", "title": title, "task_id": task_id}
    suno_url = song["audio_url"]
    print(f"    suno ready: {suno_url}", flush=True)

    print("    [3/3] downloading + updating Mongo…", flush=True)
    local_name = f"track_{tid}.mp3"
    local_path = SUNO_AUDIO_DIR / local_name
    if local_path.exists():
        local_path.unlink()
    if not await download_mp3(suno_url, local_path):
        return {"id": tid, "status": "download_failed", "title": title, "suno_url": suno_url}
    local_url = f"/api/suno_audio/{local_name}"

    update = {
        "audio_url": local_url,
        "original_audio_url": suno_url,
        "lyrics_excerpt": lyrics,
        "suno_task_id": task_id,
        "downloaded_at": datetime.utcnow().isoformat(),
        "last_played_at": None,  # reset rotation
    }
    if song.get("duration"):
        update["duration_sec"] = int(song["duration"])
    await db.tracks.update_one({"id": tid}, {"$set": update})
    size = local_path.stat().st_size
    print(f"    ✅ done — {size:,} bytes, mongo updated", flush=True)
    return {"id": tid, "status": "ok", "title": title, "bytes": size}


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    # Submit all 5 in parallel to speed up (Suno usually allows a few concurrent tasks)
    tasks_meta = []
    for pfx, (expected_title, lyrics) in LYRICS_BY_ID_PREFIX.items():
        d = await db.tracks.find_one(
            {"id": {"$regex": f"^{pfx}"}},
            {"_id": 0, "id": 1, "title": 1, "genre": 1},
        )
        if not d:
            print(f"WARN: no track for prefix {pfx}", flush=True)
            continue
        tasks_meta.append((d, lyrics))

    print(f"Regenerating {len(tasks_meta)} tracks (sequential w/ 3s gap)…\n", flush=True)
    results = []
    for track, lyrics in tasks_meta:
        try:
            r = await regen_one(db, track, lyrics)
        except Exception as e:
            r = {"id": track["id"], "status": "exception", "error": str(e), "title": track["title"]}
        results.append(r)
        await asyncio.sleep(3)

    print("\n=========== SUMMARY ===========", flush=True)
    ok = [r for r in results if r.get("status") == "ok"]
    fail = [r for r in results if r.get("status") != "ok"]
    print(f"OK: {len(ok)}/{len(results)}", flush=True)
    for r in ok:
        print(f"  ✅ {r['title']} — {r['bytes']:,} bytes", flush=True)
    for r in fail:
        print(f"  ❌ {r['title']} — {r.get('status')} {r.get('error','')}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
