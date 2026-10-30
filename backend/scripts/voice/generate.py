"""Anlatım seslerini ses klonuyla üretir (30 Ekim kararı; bkz. docs/SES_KAYDI.md). Ses ortamında çalışır (Chatterbox +
Whisper, `~/vakifname-voice/.venv`), backend'i içe aktarmaz.

Her cümle: okunuşa çevrilir (`vktext.speakable`) → cümlelere bölünür → her parça üretilir, Whisper ile yazıya dökülüp
metinle karşılaştırılır; tutmazsa yeniden üretilir, sona uydurma eklenmişse kesilir → parçalar kısa duraksamayla
birleşir → ses seviyesi eşitlenip MP3 olarak `<çıktı>/<dosya>` yazılır. Denetimden geçemeyen cümle yazılmaz (sunucu
o cümlede tarayıcı sesine düşer) ve rapora girer.

    HF_HUB_DISABLE_XET=1 ~/vakifname-voice/.venv/bin/python generate.py /tmp/vk-voice-jobs.json \\
        --ref ~/vakifname-voice/ref/talha-tr.wav [--ref-en ~/vakifname-voice/ref/talha-en.wav] --out ~/vakifname-voice/out/talha-1
"""

import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vktext import best_cut, compare, sentences, speakable  # noqa: E402

ACCEPT = 0.92  # bu benzerlik ve üstü: kabul
KEEP = 0.82  # denemeler bitince en iyisi bunun üstündeyse yazılır ve "gözden geçir" diye işaretlenir
WHISPER = "mlx-community/whisper-large-v3-turbo"
PAUSE_S = {".": 0.38, "!": 0.38, "?": 0.38, "…": 0.38, ";": 0.28, ":": 0.28, ",": 0.2}


def trim_silence(wav, sr: int, threshold: float = 0.03, margin_s: float = 0.06):
    """Baştaki ve sondaki sessizliği atar (tepe seviyenin %3'ünün altı sessiz sayılır)."""
    import torch

    level = wav.abs().squeeze(0)
    idx = torch.nonzero(level > threshold * level.max().clamp(min=1e-6)).squeeze(-1)
    if idx.numel() == 0:
        return wav
    a = max(0, int(idx[0]) - int(margin_s * sr))
    b = min(wav.shape[-1], int(idx[-1]) + int(margin_s * sr))
    return wav[..., a:b]


class Voice:
    def __init__(self, device: str, exaggeration: float, cfg: float, temperature: float):
        import torch
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS

        self.torch = torch
        self.model = ChatterboxMultilingualTTS.from_pretrained(device=device)
        self.sr = self.model.sr
        self.params = {"exaggeration": exaggeration, "cfg_weight": cfg, "temperature": temperature}
        self._ref = None

    def say(self, text: str, lang: str, ref: str, seed: int, cfg: float | None = None):
        self.torch.manual_seed(seed)
        params = dict(self.params)
        if cfg is not None:
            params["cfg_weight"] = cfg
        if ref != self._ref:  # referans bir kez hazırlanır
            self.model.prepare_conditionals(ref, exaggeration=params["exaggeration"])
            self._ref = ref
        return self.model.generate(text, language_id=lang, **params)


def transcribe(path: Path, lang: str) -> tuple[str, list[tuple[str, float]]]:
    import mlx_whisper

    r = mlx_whisper.transcribe(str(path), path_or_hf_repo=WHISPER, language=lang, word_timestamps=True)
    words = [(w["word"].strip(), float(w["end"])) for seg in r.get("segments", []) for w in seg.get("words", [])]
    return r["text"].strip(), words


def make_piece(voice: Voice, text: str, lang: str, ref: str, attempts: int, tmp: Path, cfg: float | None):
    """Bir parçayı üretir ve denetler: (ses, benzerlik, duyulan, deneme sayısı)."""
    import torchaudio as ta

    spoken = speakable(text, lang)
    best = None
    for n in range(1, attempts + 1):
        wav = trim_silence(voice.say(spoken, lang, ref, seed=1000 + n, cfg=cfg), voice.sr)
        path = tmp / "piece.wav"
        ta.save(str(path), wav, voice.sr)
        heard, words = transcribe(path, lang)
        sim, length = compare(text, heard, lang)
        if length > 1.08 and words:  # sona uydurma eklenmiş olabilir: en iyi karşılayan yerden kes
            k, cut_sim = best_cut(text, words, lang)
            if k < len(words) and cut_sim >= sim:
                end = min(wav.shape[-1], int((words[k - 1][1] + 0.12) * voice.sr))
                wav, sim = wav[..., :end], cut_sim
                heard = " ".join(w for w, _ in words[:k]) + " [kesildi]"
        if best is None or sim > best[1]:
            best = (wav, sim, heard, n)
        if sim >= ACCEPT:
            break
    return best


def to_mp3(wav, sr: int, target: Path, tmp: Path) -> None:
    import torchaudio as ta

    raw = tmp / "full.wav"
    ta.save(str(raw), wav, sr)
    part = target.with_suffix(".part.mp3")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(raw), "-af", "loudnorm=I=-18:TP=-1.5:LRA=11",
                    "-ac", "1", "-ar", "24000", "-codec:a", "libmp3lame", "-b:a", "64k", str(part)], check=True)
    part.replace(target)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Anlatım seslerini ses klonuyla üretir.")
    ap.add_argument("jobs", type=Path, help="python -m app.tts_export çıktısı")
    ap.add_argument("--ref", required=True, help="Türkçe referans (≈10 sn, wav)")
    ap.add_argument("--ref-en", help="İngilizce referans; yoksa --ref (aksan için cfg 0 kullanılır)")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--lang", choices=["tr", "en"])
    ap.add_argument("--only", help="yalnızca bu eser (ör. BUR-0001)")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--attempts", type=int, default=3)
    ap.add_argument("--device", default="mps")
    ap.add_argument("--exaggeration", type=float, default=0.5)
    ap.add_argument("--cfg", type=float, default=0.5)
    ap.add_argument("--temperature", type=float, default=0.8)
    a = ap.parse_args(argv)

    data = json.loads(a.jobs.read_text(encoding="utf-8"))
    todo = [j for j in data["jobs"] if (not a.lang or j["lang"] == a.lang) and (not a.only or j["monument_id"] == a.only)
            and not (a.out / j["file"]).exists()]
    if a.limit:
        todo = todo[: a.limit]
    a.out.mkdir(parents=True, exist_ok=True)
    print(f"{len(todo)} cümle üretilecek → {a.out}", flush=True)
    if not todo:
        return 0
    import torch

    voice = Voice(a.device if a.device != "mps" or torch.backends.mps.is_available() else "cpu",
                  a.exaggeration, a.cfg, a.temperature)
    report_path = a.out / "rapor.json"
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else {}
    t_all = time.time()
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        for i, job in enumerate(todo, 1):
            t = time.time()
            lang = job["lang"]
            ref = a.ref_en if (lang == "en" and a.ref_en) else a.ref
            cfg = 0.0 if (lang == "en" and not a.ref_en) else None  # farklı dilde referans: aksan taşınmasın
            pieces, worst, notes, tries = [], 1.0, [], 0
            # Önce okunuşa çevrilir, sonra bölünür: "II. Murad" ya da "19. yüzyıl" cümle sonu sanılmasın.
            for text in sentences(speakable(job["text"], lang)):
                wav, sim, heard, n = make_piece(voice, text, lang, ref, a.attempts, tmp, cfg)
                tries += n
                worst = min(worst, sim)
                if sim < ACCEPT:
                    notes.append({"metin": text, "duyulan": heard, "benzerlik": round(sim, 3)})
                pause = int(PAUSE_S.get(text.rstrip()[-1:], 0.3) * voice.sr)
                pieces += [wav, torch.zeros(1, pause)]
            status = "ok" if worst >= ACCEPT else ("gozden-gecir" if worst >= KEEP else "reddedildi")
            if status != "reddedildi":
                to_mp3(torch.cat(pieces[:-1], dim=-1), voice.sr, a.out / job["file"], tmp)
            report[job["file"]] = {"eser": job["monument_id"], "dil": lang, "durum": status, "benzerlik": round(worst, 3),
                                   "deneme": tries, "metin": job["text"], "sorunlar": notes}
            report_path.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"[{i}/{len(todo)}] {job['monument_id']} {lang} {status} {worst:.2f} ({tries} deneme, "
                  f"{time.time() - t:.0f} sn)", flush=True)
    counts = {}
    for r in report.values():
        counts[r["durum"]] = counts.get(r["durum"], 0) + 1
    print(f"Bitti: {counts} · {time.time() - t_all:.0f} sn · rapor {report_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
