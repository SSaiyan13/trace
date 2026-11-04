#!/usr/bin/env python3
"""
Make the public demo song: "Demo Groove", an ORIGINAL bass line written for this repo.
It is not a real song, so it is safe to publish.

It writes:
    demo/demo-groove-truth.mid       the line as written (the "answer key" for tests and checks)
    demo/demo-groove-detected.mid    the same line with typical detector mistakes added on purpose
                                     (timing wobble, a held note split in two, short glitches,
                                     quiet ghost notes), so the cleanup step has real work to do
    demo/demo-groove-stem.wav        the line played by a simple synthesized bass, standing in for
                                     a separated bass stem

Then build it like any other song:
    python pipeline/build_song.py --midi demo/demo-groove-detected.mid --stem demo/demo-groove-stem.wav
           --id demo-groove --title "Demo Groove" --artist "Original demo" --bpm 96 --offset 1.0 --public

Honest note: because the "detected" MIDI is simulated, this demo shows how the page and the
cleanup work. It says nothing about how accurate Basic Pitch is on real recordings.
"""
import math
import os
import random
import struct
import wave

BPM = 96
LEAD_IN = 1.0      # seconds of silence before beat 1 (this is the demo's offset)
RATE = 11025       # bass needs little high end; a low sample rate keeps the file small
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "demo")

# Pitches (MIDI): F1=29 G1=31 Ab1=32 Bb1=34 C2=36 Db2=37 Eb2=39 F2=41 Ab2=44
# Each riff is one bar of (start, length, pitch) in 16ths. Written for this demo.
VERSE = [(0, 6, 29), (6, 2, 36), (8, 3, 32), (11, 1, 34), (12, 2, 36), (14, 2, 39)]
VERSE_END = [(0, 6, 29), (6, 2, 36), (8, 3, 32), (11, 1, 34), (12, 4, 31)]
LIFT = [(0, 6, 37), (6, 2, 44), (8, 4, 41), (12, 4, 39)]
TURN = [(0, 3, 36), (3, 3, 36), (6, 2, 39), (8, 2, 41), (10, 2, 39), (12, 4, 36)]


def chorus(start_bar):
    """Long notes that cross barlines, to show ties: Ab held over the bar, then Bb, C, F."""
    b = start_bar * 16
    return [(b + 0, 12, 32), (b + 12, 8, 34), (b + 20, 4, 36), (b + 24, 8, 29),
            (b + 32, 6, 37), (b + 38, 2, 36), (b + 40, 4, 34), (b + 44, 4, 32),
            (b + 48, 12, 36), (b + 60, 4, 36)]


def song():
    """28 bars: verse x2, lift, chorus x2, verse again, ending on a long F."""
    events, bar = [], 0

    def put(riff):
        nonlocal bar
        events.extend((bar * 16 + s, l, p) for s, l, p in riff)
        bar += 1

    for _ in range(2):
        for riff in (VERSE, VERSE, VERSE, VERSE_END):
            put(riff)
    for riff in (LIFT, LIFT, TURN, VERSE_END):
        put(riff)
    for _ in range(2):
        events.extend(chorus(bar))
        bar += 4
    for riff in (VERSE, VERSE, VERSE, VERSE_END, VERSE, VERSE, TURN):
        put(riff)
    events.append((bar * 16, 16, 29))  # final bar: one whole-note F
    bar += 1
    return events, bar


def to_seconds(events):
    s16 = 60.0 / BPM / 4.0
    return [(LEAD_IN + s * s16, LEAD_IN + (s + l) * s16, p) for s, l, p in events]


def add_detector_mistakes(notes, seed=11):
    """Imitate what an automatic note detector typically gets wrong. Seeded, so it is repeatable."""
    rng = random.Random(seed)
    out = []
    for start, end, pitch in notes:
        j = rng.uniform(-0.018, 0.018)
        start, end = start + j, end + j - rng.uniform(0.01, 0.05)  # wobble; ends a little early
        vel = rng.randint(55, 100)
        if end - start > 0.6 and rng.random() < 0.5:
            mid = start + (end - start) * rng.uniform(0.4, 0.6)
            out.append((start, mid, pitch, vel))                      # a held note split in two
            out.append((mid + 0.012, end, pitch, vel - 10))
        else:
            out.append((start, end, pitch, vel))
        r = rng.random()
        if r < 0.10:
            out.append((end, end + 0.04, pitch + 12, 40))             # a short octave glitch
        elif r < 0.16:
            out.append((start + 0.05, start + 0.20, pitch + 7, 12))   # a very quiet ghost note
    return out


def write_midi(path, notes):
    import mido

    tpb = 480
    mid = mido.MidiFile(ticks_per_beat=tpb)
    track = mido.MidiTrack()
    mid.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(BPM)))
    msgs = []
    for n in notes:
        start, end, pitch = n[:3]
        vel = n[3] if len(n) > 3 else 90
        msgs.append((mido.second2tick(start, tpb, mido.bpm2tempo(BPM)), 1, "note_on", pitch, vel))
        msgs.append((mido.second2tick(end, tpb, mido.bpm2tempo(BPM)), 0, "note_off", pitch, 0))
    msgs.sort()
    last = 0
    for tick, _, kind, pitch, vel in msgs:
        track.append(mido.Message(kind, note=pitch, velocity=vel, time=max(0, tick - last)))
        last = max(last, tick)
    mid.save(path)


def render_wav(path, notes, total_seconds):
    """A simple plucked-bass sound: a few harmonics with a fast attack and a slow fade."""
    n = int(total_seconds * RATE)
    buf = [0.0] * n
    rng = random.Random(5)
    for start, end, pitch in notes:
        start += rng.uniform(-0.008, 0.008)  # tiny human timing, like a real player
        f = 440.0 * 2 ** ((pitch - 69) / 12.0)
        i0, i1 = int(start * RATE), min(n, int((end + 0.03) * RATE))
        for i in range(i0, i1):
            t = (i - i0) / RATE
            env = min(1.0, t / 0.004) * math.exp(-t * 2.2)
            if i > int(end * RATE):
                env *= max(0.0, 1.0 - (i - end * RATE) / (0.03 * RATE))  # quick release
            x = 2 * math.pi * f * t
            buf[i] += env * (math.sin(x) + 0.5 * math.sin(2 * x) + 0.25 * math.sin(3 * x))
    peak = max(abs(v) for v in buf) or 1.0
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(32000 * 0.8 * v / peak)) for v in buf))


def main():
    os.makedirs(OUT, exist_ok=True)
    events, bars = song()
    truth = to_seconds(events)
    write_midi(os.path.join(OUT, "demo-groove-truth.mid"), truth)
    write_midi(os.path.join(OUT, "demo-groove-detected.mid"), add_detector_mistakes(truth))
    total = LEAD_IN + bars * 4 * 60.0 / BPM + 1.0
    render_wav(os.path.join(OUT, "demo-groove-stem.wav"), truth, total)
    print(f"Wrote demo/ files: {len(events)} notes, {bars} bars at {BPM} BPM, {total:.1f} s of audio.")


if __name__ == "__main__":
    main()
