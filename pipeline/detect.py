#!/usr/bin/env python3
"""
Step 3: find the notes in a bass stem with Basic Pitch (Spotify's open-source note detector,
Apache-2.0 licence). Output is a MIDI file with note starts and ends in seconds.

Install:  pip install basic-pitch
(Check Basic Pitch's README for the Python versions it supports; 3.11 is a safe choice on Windows.)

Usage:
    python pipeline/detect.py bass.wav --out bass.mid

Bass-friendly settings: we tell Basic Pitch to ignore anything above ~400 Hz (bass notes, even
high on the neck, are below that; higher content is mostly harmonics and bleed from other
instruments) and below 30 Hz (rumble).
"""
import argparse
import os


def detect(stem_path, out_path, min_freq=30.0, max_freq=400.0, onset_threshold=0.5,
           frame_threshold=0.3, min_note_ms=58.0):
    """Run Basic Pitch on a stem and write a MIDI file. Returns out_path."""
    try:
        from basic_pitch.inference import predict
        from basic_pitch import ICASSP_2022_MODEL_PATH
    except ImportError:
        raise SystemExit("Basic Pitch is not installed. Run: pip install basic-pitch")

    _, midi_data, _ = predict(
        stem_path,
        ICASSP_2022_MODEL_PATH,
        onset_threshold=onset_threshold,
        frame_threshold=frame_threshold,
        minimum_note_length=min_note_ms,
        minimum_frequency=min_freq,
        maximum_frequency=max_freq,
        multiple_pitch_bends=False,
        melodia_trick=True,
    )
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    midi_data.write(out_path)
    return out_path


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stem", help="bass stem audio (WAV is safest)")
    ap.add_argument("--out", default="bass.mid")
    ap.add_argument("--max-freq", type=float, default=400.0)
    ap.add_argument("--onset-threshold", type=float, default=0.5)
    args = ap.parse_args()
    detect(args.stem, args.out, max_freq=args.max_freq, onset_threshold=args.onset_threshold)
    print("Wrote", args.out)


if __name__ == "__main__":
    main()
