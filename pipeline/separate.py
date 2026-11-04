#!/usr/bin/env python3
"""
Step 2: separate the bass from the full song.

Two backends:
    manual  You already have a bass stem (for example made with StemKit, a Windows desktop app).
            We just check the file exists and use it. Nothing is run.
    demucs  Run Demucs (Meta's open-source separation model, MIT licence) on the full song.
            Install first:  pip install demucs
            It downloads model weights on first use and runs much faster with a GPU.

Usage:
    python pipeline/separate.py --backend demucs --audio my_song.wav --out work/my-song
    python pipeline/separate.py --backend manual --stem my_bass.wav
"""
import argparse
import os
import shutil
import subprocess
import sys


def separate(backend, audio=None, stem=None, out_dir="work"):
    """Return the path to a bass stem audio file."""
    if backend == "manual":
        if not stem:
            raise SystemExit("The manual backend needs --stem: the bass stem file you made (e.g. with StemKit).")
        if not os.path.isfile(stem):
            raise SystemExit(f"Bass stem not found: {stem}")
        return stem

    if backend == "demucs":
        if not audio or not os.path.isfile(audio):
            raise SystemExit(f"Song audio not found: {audio}")
        os.makedirs(out_dir, exist_ok=True)
        model = "htdemucs"
        # --two-stems=bass writes bass.wav and no_bass.wav. We only need bass.wav.
        cmd = [sys.executable, "-m", "demucs", "--two-stems=bass", "-n", model, "-o", out_dir, audio]
        print("   Running:", " ".join(cmd))
        try:
            subprocess.run(cmd, check=True)
        except FileNotFoundError:
            raise SystemExit("Could not start Python to run Demucs.")
        except subprocess.CalledProcessError as e:
            raise SystemExit(f"Demucs failed (exit code {e.returncode}). Is it installed? pip install demucs")
        name = os.path.splitext(os.path.basename(audio))[0]
        result = os.path.join(out_dir, model, name, "bass.wav")
        if not os.path.isfile(result):
            raise SystemExit(f"Demucs finished but {result} is missing.")
        return result

    raise SystemExit(f"Unknown backend: {backend} (use manual or demucs)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--backend", choices=["manual", "demucs"], default="manual")
    ap.add_argument("--audio", help="the full song (for demucs)")
    ap.add_argument("--stem", help="your bass stem (for manual)")
    ap.add_argument("--out", default="work", help="folder for Demucs output")
    args = ap.parse_args()
    path = separate(args.backend, args.audio, args.stem, args.out)
    print("Bass stem:", path)
    if args.backend == "manual" and args.out != "work":
        os.makedirs(args.out, exist_ok=True)
        shutil.copy(path, args.out)


if __name__ == "__main__":
    main()
