"""Voice 2 test audio (training/README.md "runR … voice 2"): SYNTHETIC speech of the hand-written spoken commands,
mixed with door noise. Test audio only — never shipped, never trained on.

Each item's `say` (training/assistant/voice*.jsonl) is spoken by each voice of its language, placed in a 5.0 s clip
(speech from 0.4 s; a longer sentence gets 0.8 s after it), 16 kHz mono int16, and written clean and with door noise
at SNR 10 dB and 5 dB. Door noise = babble of six FLEURS test clips (CC BY 4.0; 3 TR + 3 EN, summed at random
offsets) plus pink noise 10 dB below the babble. SNR = speech RMS (over the spoken part) / noise RMS.

  python -I tools/local-voice/make-voice-set.py --out DIR --fleurs FLEURS_WAV_DIR --piper PIPER_DIR --mms MMS_DIR \
      --sets voicetr,voiceen,voicedevtr,voicedeven [--seed 7]
Voices: tr = piper tr_TR-dfki-medium (CC BY-NC-SA 4.0), facebook/mms-tts-tur (CC BY-NC 4.0);
        en = piper en_US-libritts_r-medium (CC BY 4.0) speakers 20 and 100.
"""
import argparse
import json
import os
import random
import subprocess
import sys
import wave
import zlib

import numpy as np

SR = 16000
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))


def resample(x, sr):
    if sr == SR:
        return x.astype(np.float32)
    p = subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "pipe:0", "-f", "f32le", "-ar", str(SR), "-ac", "1", "pipe:1"],
                       input=x.astype(np.float32).tobytes(), capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.float32).copy()


def read_wav(path):
    p = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-f", "f32le", "-ar", str(SR), "-ac", "1", "pipe:1"], capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.float32).copy()


def write_wav(path, x):
    x = np.clip(x, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())


def rms(x):
    return float(np.sqrt(np.mean(np.square(x)) + 1e-12))


def pink(n, rng):
    # Voss-McCartney-ish: filtered white noise (1/f) via FFT shaping
    f = np.fft.rfftfreq(n, 1 / SR)
    spec = (rng.standard_normal(len(f)) + 1j * rng.standard_normal(len(f))) / np.sqrt(np.maximum(f, 20.0))
    x = np.fft.irfft(spec, n)
    return (x / (rms(x) + 1e-12)).astype(np.float32)


class Voices:
    def __init__(self, piper_dir, mms_dir):
        from piper import PiperVoice, SynthesisConfig
        self.SC = SynthesisConfig
        self.dfki = PiperVoice.load(os.path.join(piper_dir, "tr_TR-dfki-medium.onnx"))
        self.libri = PiperVoice.load(os.path.join(piper_dir, "en_US-libritts_r-medium.onnx"))
        self.mms_dir = mms_dir
        self.mms = None

    def piper(self, v, text, speaker=None):
        chunks = list(v.synthesize(text, syn_config=self.SC(speaker_id=speaker)))
        x = np.concatenate([c.audio_float_array for c in chunks])
        return resample(x, chunks[0].sample_rate)

    def mms_tur(self, text):
        import torch
        from transformers import AutoTokenizer, VitsModel
        if self.mms is None:
            self.mms = (AutoTokenizer.from_pretrained(self.mms_dir), VitsModel.from_pretrained(self.mms_dir).eval())
        tok, model = self.mms
        torch.manual_seed(0)
        with torch.no_grad():
            y = model(**tok(text.lower(), return_tensors="pt")).waveform[0].numpy()
        return resample(y, model.config.sampling_rate)

    def speak(self, voice, text):
        if voice == "tr-dfki":
            return self.piper(self.dfki, text)
        if voice == "tr-mms":
            return self.mms_tur(text)
        if voice.startswith("en-libri"):
            return self.piper(self.libri, text, int(voice.split("-")[-1]))
        raise ValueError(voice)


VOICES = {"tr": ["tr-dfki", "tr-mms"], "en": ["en-libri-20", "en-libri-100"]}
CONDS = [("clean", None), ("door10", 10.0), ("door5", 5.0)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True); ap.add_argument("--fleurs", required=True); ap.add_argument("--piper", required=True); ap.add_argument("--mms", required=True)
    ap.add_argument("--sets", default="voicetr,voiceen,voicedevtr,voicedeven"); ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    fl = {l: sorted(os.path.join(a.fleurs, l, f) for f in os.listdir(os.path.join(a.fleurs, l)) if f.endswith(".wav")) for l in ("tr", "en")}
    V = Voices(a.piper, a.mms)
    man = []
    for s in a.sets.split(","):
        for line in open(os.path.join(REPO, "training/assistant", s + ".jsonl"), encoding="utf8"):
            it = json.loads(line)
            for voice in VOICES[it["lang"]]:
                rng = np.random.default_rng(zlib.crc32(f"{a.seed}-{it['id']}-{voice}".encode()))
                sp = V.speak(voice, it["say"])
                sp = sp / (rms(sp[np.abs(sp) > 0.02 * np.max(np.abs(sp))]) + 1e-9) * 0.08  # spoken part at ~-22 dBFS RMS
                n = max(int(5.0 * SR), int(0.4 * SR) + len(sp) + int(0.8 * SR))
                clean = np.zeros(n, dtype=np.float32)
                clean[int(0.4 * SR):int(0.4 * SR) + len(sp)] = sp
                act = sp[np.abs(sp) > 0.02 * np.max(np.abs(sp))]
                babble = np.zeros(n, dtype=np.float32)
                r2 = random.Random(f"{a.seed}-{it['id']}-{voice}")
                for src in r2.sample(fl["tr"], 3) + r2.sample(fl["en"], 3):
                    b = read_wav(src)
                    b = b / (rms(b) + 1e-9)
                    reps = np.tile(b, int(np.ceil((n + len(b)) / len(b))))
                    off = r2.randrange(len(b))
                    babble += reps[off:off + n]
                babble = babble / (rms(babble) + 1e-9)
                noise = babble + pink(n, rng) * 10 ** (-10 / 20)
                noise = noise / (rms(noise) + 1e-9)
                for cond, snr in CONDS:
                    x = clean if snr is None else clean + noise * (rms(act) / 10 ** (snr / 20))
                    if np.max(np.abs(x)) > 0.99:
                        x = x * (0.99 / np.max(np.abs(x)))
                    f = f"{it['id']}-{voice}-{cond}.wav"
                    write_wav(os.path.join(a.out, f), x)
                    man.append({"set": s, "id": it["id"], "lang": it["lang"], "voice": voice, "cond": cond, "file": f, "say": it["say"], "text": it["text"], "seconds": round(n / SR, 2)})
            print(s, it["id"], file=sys.stderr)
    json.dump({"note": "synthetic speech + FLEURS babble; test audio only", "seed": a.seed, "clips": man}, open(os.path.join(a.out, "manifest.json"), "w"), ensure_ascii=False, indent=0)
    print(len(man), "clips")


if __name__ == "__main__":
    main()
