"""Uzun ses kaydından en iyi referansı seçmek için adaylar (30 Ekim; bkz. docs/SES_KAYDI.md). Ses ortamında çalışır.

Model referansın yalnızca ilk ~10 sn'sini kullanır; kalite o 10 sn'ye bağlıdır. Bu betik:
1. Kaydı 24 kHz tek kanala çevirir (70 Hz altı uğultu kesilir, seviye eşitlenir; gürültü azaltma yok).
2. Duraksamalardan bölünmüş 7–10,5 sn'lik adaylar keser (cümle başında başlar, duraksamada biter).
3. Her adayın dilini ve metnini Whisper ile çıkarır; izin cümlesini ve dil dışı parçaları atar.
4. Her adayla aynı deneme cümlelerini üretir; (a) Whisper benzerliği (anlaşılırlık), (b) üretilen sesin kayıttaki sese
   benzerliği (ses kodlayıcısı, kosinüs) ölçülür.
5. `liste.md` (puanlı) ve kör dinleme için `dinle/` (en iyi üç aday, harfler karışık; eşleşme `anahtar.json`) yazar.

    HF_HUB_DISABLE_XET=1 ~/vakifname-voice/.venv/bin/python candidates.py ~/Downloads/ses-talha.m4a \\
        --out ~/vakifname-voice/aday/talha
"""

import argparse
import json
import random
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate import Voice, transcribe, trim_silence  # noqa: E402
from vktext import compare  # noqa: E402

SR = 24000
FRAME = 0.02
TESTS = {
    "tr": ["Hoş geldin! Ben buranın rehberiyim. Sana Bursa Ulu Camii hakkında kaynakların anlattıklarını aktaracağım.",
           "Aktarılan bir rivayete göre: halk arasında yirmi kubbenin bir adağa dayandığı anlatılır."],
    "en": ["Welcome! I am your guide here. Let me share what the sources tell us about Bursa Grand Mosque."],
}


def load_clean(src: Path, out: Path) -> None:
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(src), "-af", "highpass=f=70,loudnorm=I=-20:TP=-2",
                    "-ac", "1", "-ar", str(SR), str(out)], check=True)


def pauses(wav, min_pause: float = 0.3):
    """Sessiz aralıklar [(başlangıç sn, bitiş sn)]: kare enerjisi konuşma seviyesinin çok altındaysa sessiz."""
    import torch

    x = wav.squeeze(0)
    n = int(FRAME * SR)
    frames = x[: len(x) // n * n].reshape(-1, n)
    db = 20 * torch.log10(frames.pow(2).mean(dim=1).sqrt().clamp(min=1e-6))
    speech = torch.quantile(db, 0.9)
    silent = (db < speech - 30).tolist()
    out, start = [], None
    for i, s in enumerate(silent + [False]):
        if s and start is None:
            start = i
        elif not s and start is not None:
            if (i - start) * FRAME >= min_pause:
                out.append((start * FRAME, i * FRAME))
            start = None
    return out, float(speech), float(torch.quantile(db, 0.05))


def windows(gaps, total: float, lo: float = 7.0, hi: float = 10.5):
    starts = [0.0] + [b for _, b in gaps]
    ends = [a for a, _ in gaps] + [total]
    out = []
    for s in starts:
        fit = [e for e in ends if lo <= e - s <= hi]
        if fit:
            out.append((max(0.0, s - 0.05), max(fit) + 0.05))
    chosen = []  # çakışmayanlar önce
    for w in out:
        if all(w[1] <= c[0] or w[0] >= c[1] for c in chosen):
            chosen.append(w)
    return chosen


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Uzun kayıttan referans adayları ve puanları.")
    ap.add_argument("recording", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--max", type=int, default=8, help="dil başına en fazla aday")
    ap.add_argument("--device", default="mps")
    a = ap.parse_args(argv)
    import numpy as np
    import torch
    import torchaudio as ta

    a.out.mkdir(parents=True, exist_ok=True)
    clean = a.out / "kayit-temiz.wav"
    load_clean(a.recording, clean)
    wav, sr = ta.load(str(clean))
    total = wav.shape[-1] / sr
    gaps, speech_db, floor_db = pauses(wav)
    print(f"Kayıt {total:.0f} sn · konuşma {speech_db:.0f} dB · zemin gürültüsü {floor_db:.0f} dB "
          f"(fark {speech_db - floor_db:.0f} dB; 45+ iyi) · {len(gaps)} duraksama", flush=True)

    found = {"tr": [], "en": []}
    for i, (s, e) in enumerate(windows(gaps, total), 1):
        clip = wav[..., int(s * sr): int(e * sr)]
        path = a.out / f"aday-{i:02d}.wav"
        ta.save(str(path), clip, sr)
        import mlx_whisper

        r = mlx_whisper.transcribe(str(path), path_or_hf_repo="mlx-community/whisper-large-v3-turbo")
        lang, text = r.get("language"), r["text"].strip()
        peak = float(clip.abs().max())
        if "izin veriyorum" in text.lower() or lang not in found:
            path.unlink()
            continue
        found[lang].append({"no": i, "dosya": path.name, "bas": round(s, 2), "sure": round(e - s, 2), "metin": text,
                            "kirpma": peak > 0.99})
    for lang in found:  # kayıt boyunca yayılmış en fazla --max aday
        c = found[lang]
        if len(c) > a.max:
            step = len(c) / a.max
            found[lang] = [c[int(k * step)] for k in range(a.max)]

    voice = Voice(a.device if a.device != "mps" or torch.backends.mps.is_available() else "cpu", 0.5, 0.5, 0.8)
    ve = voice.model.ve

    def embed(w):
        w16 = ta.functional.resample(w, voice.sr, 16000).squeeze(0).numpy()
        return ve.embeds_from_wavs([w16], sample_rate=16000, as_spk=True)

    results = []
    for lang, cands in found.items():
        if not cands:
            continue
        refs = [ta.load(str(a.out / c["dosya"]))[0] for c in cands]
        target = np.mean([embed(ta.functional.resample(r, sr, voice.sr)) for r in refs], axis=0)
        target /= np.linalg.norm(target)
        for c in cands:
            sims, voices, outs = [], [], []
            for k, text in enumerate(TESTS[lang], 1):
                g = trim_silence(voice.say(text, lang, str(a.out / c["dosya"]), seed=7 + k), voice.sr)
                out = a.out / f"aday-{c['no']:02d}-ornek-{k}.wav"
                ta.save(str(out), g, voice.sr)
                heard, _ = transcribe(out, lang)
                sims.append(compare(text, heard, lang)[0])
                voices.append(float(np.dot(embed(g), target)))
                outs.append(out)
            c.update(dil=lang, anlasilirlik=round(sum(sims) / len(sims), 3), ses_benzerligi=round(sum(voices) / len(voices), 3),
                     ornekler=[o.name for o in outs])
            c["puan"] = round(0.5 * c["anlasilirlik"] + 0.5 * c["ses_benzerligi"], 3)
            results.append(c)
            print(f"{lang} aday {c['no']:02d}: anlaşılırlık {c['anlasilirlik']:.2f} · ses benzerliği "
                  f"{c['ses_benzerligi']:.2f} · {c['metin'][:60]}", flush=True)

    results.sort(key=lambda c: (c["dil"], -c["puan"]))
    blind = a.out / "dinle"
    shutil.rmtree(blind, ignore_errors=True)
    blind.mkdir()
    key, lines = {}, ["# Referans adayları", "", "| dil | aday | puan | anlaşılırlık | ses benzerliği | kırpma | metin |",
                      "|---|---|---|---|---|---|---|"]
    rng = random.SystemRandom()
    for lang in ("tr", "en"):
        top = [c for c in results if c["dil"] == lang][:3]
        rng.shuffle(top)  # kör dinleme: harf puan sırasını ele vermesin (eşleşme anahtar.json'da)
        for letter, c in zip("ABC", top):
            joined = torch.cat([ta.load(str(a.out / o))[0] for o in c["ornekler"]], dim=-1)
            ta.save(str(blind / f"{lang}-{letter}.wav"), joined, voice.sr)
            key[f"{lang}-{letter}"] = c["dosya"]
    for c in results:
        lines.append(f"| {c['dil']} | {c['dosya']} | {c['puan']} | {c['anlasilirlik']} | {c['ses_benzerligi']} | "
                     f"{'evet' if c['kirpma'] else ''} | {c['metin'][:80]} |")
    (a.out / "liste.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (a.out / "anahtar.json").write_text(json.dumps(key, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Kör dinleme: {blind} (tr-A/B/C, en-A/B/C) · puanlar {a.out / 'liste.md'}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
