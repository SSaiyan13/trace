"""Tests for the tempo and beat-1 guesses, on a synthetic line with a known answer."""
import random

from arrange import Note
from tempo import estimate_offset, estimate_tempo


def synthetic_line(bpm, offset, bars=24, seed=3):
    """A made-up funk-style bass riff that repeats every bar, with small human timing errors."""
    rng = random.Random(seed)
    s16 = 60.0 / bpm / 4.0
    riff = [(0, 3, 29), (4, 1, 29), (6, 2, 32), (8, 3, 34), (12, 1, 32), (14, 2, 29)]
    notes = []
    for b in range(bars):
        for start, length, pitch in riff:
            t = offset + (b * 16 + start) * s16 + rng.uniform(-0.01, 0.01)
            notes.append(Note(t, t + length * s16 * 0.9, pitch, rng.randint(60, 100)))
    return notes


def test_tempo_guess_finds_the_known_tempo_or_lists_it():
    notes = synthetic_line(83, 0.4)
    cands, confidence, _ = estimate_tempo(notes)
    best = cands[0][0]
    assert abs(best - 83) <= 1.0
    assert confidence in ("high", "medium", "low")


def test_offset_guess_finds_beat_one():
    notes = synthetic_line(83, 0.4)
    offset, confidence, _ = estimate_offset(notes, 83)
    assert abs(offset - 0.4) < 0.03
