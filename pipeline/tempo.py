#!/usr/bin/env python3
"""
Guess the tempo (BPM) and the time of beat 1 from a bass MIDI file.

Usage:
    python pipeline/tempo.py bass.mid

IMPORTANT: these are guesses. Tempo detection often lands on a wrong but related tempo
(twice or half as fast) or on a nearby one. On the first real song we tried, early guesses were
108 and 75 BPM; the real tempo was 83. Always check by ear and override with --bpm / --offset.

How it works, in plain words:
    Tempo  - Bass lines repeat. We turn the note starts into a pulse signal and ask, for every
             tempo between 60 and 180 BPM, "if the beat were this long, how often would a note
             start one beat, two beats and one bar later?" (autocorrelation). The tempo with the
             strongest repetition wins. Confidence compares the winner with the runner-up.
    Beat 1 - With the tempo fixed, slide a beat grid over the notes and keep the position where
             the most (and the loudest, longest) notes land on beats, with extra credit for
             notes on the first beat of a bar (bass players love beat 1).
"""
import argparse

import numpy as np

FRAME = 0.01  # seconds per step of the pulse signal


def onset_signal(notes, frame=FRAME):
    """A pulse at each note start, weighted by loudness and (capped) length, lightly smoothed."""
    if not notes:
        return np.zeros(1)
    end = max(n.start for n in notes) + 1.0
    sig = np.zeros(int(end / frame) + 1)
    for n in notes:
        weight = (n.velocity / 127.0) * min(1.0, 0.5 + (n.end - n.start))
        sig[int(round(n.start / frame))] += weight
    kernel = np.array([0.25, 0.5, 1.0, 0.5, 0.25])
    return np.convolve(sig, kernel, mode="same")


def estimate_tempo(notes, low=60.0, high=180.0, step=0.5):
    """Return a list of (bpm, score) for the best tempos, best first, plus a confidence label."""
    sig = onset_signal(notes)
    sig = sig - sig.mean()
    n = len(sig)
    # Autocorrelation through the FFT: ac[k] = how similar the pulse is to itself shifted by k frames.
    spec = np.fft.rfft(sig, 2 * n)
    ac = np.fft.irfft(spec * np.conj(spec))[:n]
    ac = ac / (ac[0] or 1.0)

    def at(seconds):
        k = seconds / FRAME
        i = int(k)
        if i + 1 >= n:
            return 0.0
        frac = k - i
        return float(ac[i] * (1 - frac) + ac[i + 1] * frac)

    results = []
    for bpm in np.arange(low, high + step, step):
        beat = 60.0 / bpm
        # one beat, two beats and one bar later; the bar counts most because bass riffs repeat by bar
        score = at(beat) + at(2 * beat) + 1.5 * at(4 * beat)
        results.append((float(bpm), score))
    results.sort(key=lambda r: r[1], reverse=True)

    # Keep distinct candidates (at least 3% apart), so alternatives are useful.
    distinct = []
    for bpm, score in results:
        if all(abs(bpm - b) / b > 0.03 for b, _ in distinct):
            distinct.append((bpm, score))
        if len(distinct) == 4:
            break
    best, second = distinct[0][1], distinct[1][1] if len(distinct) > 1 else 0.0
    ratio = (best - second) / abs(best) if best else 0.0
    confidence = "high" if ratio > 0.25 else "medium" if ratio > 0.10 else "low"
    return distinct, confidence, round(ratio, 3)


def estimate_offset(notes, bpm, step=0.002):
    """
    Time in seconds of beat 1 of bar 1 (the "first-note offset"), plus a confidence label.

    Assumption: the first bass note falls on beat 1. That is true for most songs, but not for a
    song that starts with a pickup; then set --offset by hand to the time of the first beat 1.

    We do not take the first note's time as-is, because the detector can be a few milliseconds
    early or late. Instead we find where a 16th-note grid fits all the notes best, and use the
    grid line closest to the first note. Confidence says how much better that fit is than the
    average fit (a sharp peak means the notes clearly sit on one grid).
    """
    if not notes:
        return 0.0, "low", 0.0
    sixteenth = 60.0 / bpm / 4.0
    starts = np.array([n.start for n in notes])
    weights = np.array([(n.velocity / 127.0) * min(1.0, 0.5 + (n.end - n.start)) for n in notes])
    sigma = 0.02  # 20 ms tolerance

    def score(phase):
        d = (starts - phase) / sixteenth
        d = (d - np.round(d)) * sixteenth  # distance to the nearest 16th line, in seconds
        return float(np.sum(weights * np.exp(-0.5 * (d / sigma) ** 2)))

    phases = np.arange(0.0, sixteenth, step)
    scores = np.array([score(p) for p in phases])
    best_i = int(np.argmax(scores))
    phase = float(phases[best_i])
    first = float(starts.min())
    offset = phase + round((first - phase) / sixteenth) * sixteenth
    ratio = (scores[best_i] - scores.mean()) / (scores[best_i] or 1.0)
    confidence = "high" if ratio > 0.5 else "medium" if ratio > 0.25 else "low"
    return round(max(0.0, float(offset)), 3), confidence, round(float(ratio), 3)


def main(argv=None):
    import os
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from arrange import read_midi

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("midi")
    ap.add_argument("--bpm", type=float, default=None, help="skip the tempo guess and only find beat 1")
    args = ap.parse_args(argv)
    notes = read_midi(args.midi)
    if args.bpm:
        bpm = args.bpm
    else:
        cands, conf, ratio = estimate_tempo(notes)
        bpm = cands[0][0]
        others = ", ".join(f"{b:g}" for b, _ in cands[1:])
        print(f"Tempo guess: {bpm:g} BPM (confidence {conf}). Other possibilities: {others}.")
    offset, oconf, _ = estimate_offset(notes, bpm)
    print(f"Beat 1 guess at {bpm:g} BPM: {offset:.3f} s (confidence {oconf}).")
    print("These are guesses. Check by ear, then pass --bpm and --offset to build_song.py.")


if __name__ == "__main__":
    main()
