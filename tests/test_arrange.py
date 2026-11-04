"""
Unit tests for the arranger. Every input here is a tiny made-up note list, not a real song.

Run from the repo root:  python -m pytest
"""
import random

import pytest

from arrange import (
    GridNote, Note, Settings, arrange, beat_text, build_bars, choose_fingering, clean_notes,
    detect_key, fill_gaps, merge_repeats, monophonic, split_at_barlines, split_length, to_grid,
)

BPM = 120.0                 # at 120 BPM a 16th note lasts exactly 0.125 s, which keeps the maths readable
S16 = 60.0 / BPM / 4.0


def n(start16, len16, pitch, vel=90, jitter=0.0):
    """A detector-style Note built from grid positions (plus optional timing jitter, in seconds)."""
    return Note(start16 * S16 + jitter, (start16 + len16) * S16 + jitter, pitch, vel)


# ---------------------------------------------------------------------------
# Grid snap
# ---------------------------------------------------------------------------
def test_grid_snap_rounds_to_nearest_16th():
    notes = [Note(0.01, 0.24, 40), Note(0.26, 0.49, 41)]  # slightly off the grid
    grid = to_grid(notes, BPM)
    assert [(g.start, g.end) for g in grid] == [(0, 2), (2, 4)]


def test_grid_snap_uses_offset_for_beat_one():
    notes = [Note(1.0, 1.25, 40)]  # first note 1 second into the audio
    grid = to_grid(notes, BPM, offset=1.0)
    assert (grid[0].start, grid[0].end) == (0, 2)


def test_grid_snap_drops_lead_in_and_keeps_minimum_length():
    notes = [Note(0.0, 0.2, 40), Note(1.0, 1.02, 41)]  # first ends before beat 1; second is very short
    grid = to_grid(notes, BPM, offset=0.5)
    assert len(grid) == 1
    assert grid[0].end - grid[0].start == 1


def test_monophonic_keeps_lowest_and_cuts_overlaps():
    grid = [GridNote(0, 4, 45), GridNote(0, 4, 33), GridNote(2, 6, 36)]
    mono = monophonic(grid)
    assert [(g.start, g.end, g.pitch) for g in mono] == [(0, 2, 33), (2, 6, 36)]


def test_fill_gaps_closes_small_gaps_only():
    mono = [GridNote(0, 3, 40), GridNote(4, 6, 41), GridNote(12, 14, 42)]
    filled = fill_gaps(mono, gap_fill=2)
    assert filled[0].end == 4      # 1-16th gap closed
    assert filled[1].end == 6      # 6-16th gap left as a rest


# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
def test_cleanup_drops_quiet_and_very_short_notes():
    notes = [n(0, 4, 40), Note(1.0, 1.02, 41, 90), n(8, 4, 42, vel=5)]
    out = clean_notes(notes, BPM, Settings(min_velocity=20, min_note_ms=50))
    assert [x.pitch for x in out] == [40]


def test_cleanup_joins_a_held_note_split_by_the_detector():
    # One long F, detected as two pieces with a 10 ms hole
    notes = [Note(0.0, 0.40, 41), Note(0.41, 1.0, 41)]
    out = clean_notes(notes, BPM, Settings(merge_gap_ms=30))
    assert len(out) == 1 and out[0].end == pytest.approx(1.0)


def test_cleanup_keeps_real_repeated_notes_with_a_gap():
    notes = [Note(0.0, 0.20, 41), Note(0.25, 0.45, 41)]  # 50 ms of silence: a real re-pluck
    out = clean_notes(notes, BPM, Settings(merge_gap_ms=30))
    assert len(out) == 2


def test_cleanup_folds_tiny_glitch_into_previous_note():
    # A 55 ms blip of another pitch right after a note (a slide or harmonic)
    notes = [Note(0.0, 0.5, 40), Note(0.5, 0.555, 52), Note(1.0, 1.5, 43)]
    out = clean_notes(notes, BPM, Settings(min_note_ms=50, merge_short_fraction=0.5))
    assert [x.pitch for x in out] == [40, 43]
    assert out[0].end == pytest.approx(0.555)


def test_merge_repeats_joins_touching_same_pitch():
    mono = [GridNote(0, 4, 41), GridNote(4, 8, 41), GridNote(8, 10, 43)]
    out = merge_repeats(mono)
    assert [(g.start, g.end) for g in out] == [(0, 8), (8, 10)]


# ---------------------------------------------------------------------------
# Note lengths, dots and ties
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("pos,length,expected", [
    (0, 16, [16]),          # whole note
    (0, 12, [12]),          # dotted half
    (0, 6, [6]),            # dotted quarter
    (4, 6, [6]),            # dotted quarter on beat 2
    (0, 3, [3]),            # dotted eighth
    (2, 6, [2, 4]),         # off-beat: eighth tied to quarter, not dotted-eighth + 16th + eighth
    (0, 5, [4, 1]),         # quarter tied to a 16th
    (1, 3, [1, 2]),         # 16th then eighth, each on its own grid
    (4, 8, [4, 4]),         # a half note does not start on beat 2
    (0, 14, [12, 2]),       # dotted half then an eighth
])
def test_split_length(pos, length, expected):
    pieces = split_length(pos, length)
    assert pieces == expected
    assert sum(pieces) == length


def test_split_at_barlines():
    assert list(split_at_barlines(12, 24)) == [(0, 12, 4), (1, 0, 8)]


def test_note_across_barline_becomes_tied_notes():
    # A note from beat 4 of bar 1 to the middle of bar 2 (12 16ths long)
    notes = [GridNote(12, 24, 41)]
    bars = build_bars(notes, [(0, 1)], total_bars=2)
    assert bars[0][-1] == "1.4.4"              # first part: plain quarter on the E string, fret 1
    assert bars[1][0] == "1.4{t}.2"            # second part, tied: half note
    assert bars[1][1:] == ["r.2"]              # rest of bar 2


def test_every_bar_adds_up_to_four_beats():
    rng = random.Random(1)
    t, notes = 0, []
    while t < 16 * 8:
        length = rng.choice([1, 2, 3, 4, 6, 8, 12])
        gap = rng.choice([0, 0, 0, 1, 3])
        notes.append(GridNote(t + gap, t + gap + length, 40 + rng.randint(0, 7)))
        t += gap + length
    notes = [x for x in notes if x.start < 16 * 8]
    bars = build_bars(notes, choose_fingering([x.pitch for x in notes]), total_bars=8)
    sizes = {1: 16, 2: 8, 4: 4, 8: 2, 16: 1}
    for beats in bars:
        total = 0
        for b in beats:
            dur = int(b.split(".")[-1].split("{")[0])
            length = sizes[dur]
            total += length * 1.5 if "{d}" in b else length
        assert total == 16


def test_beat_text_formats():
    assert beat_text(4, fret=3, string=3) == "3.3.4"
    assert beat_text(6, fret=3, string=3, tied=True) == "3.3{t}.4{d}"
    assert beat_text(3) == "r.8{d}"


# ---------------------------------------------------------------------------
# Key detection
# ---------------------------------------------------------------------------
def scale_line(tonic_midi, steps, bars=4):
    """A simple bass line: tonic on beat 1 of every bar, then walk through scale degrees."""
    notes, t = [], 0
    for _ in range(bars):
        notes.append(GridNote(t, t + 6, tonic_midi))
        pos = t + 6
        for step in steps:
            notes.append(GridNote(pos, pos + 2, tonic_midi + step))
            pos += 2
        t += 16
    return notes


def test_key_f_minor():
    # F minor: F G Ab Bb C Db Eb. Tonic F1 = 29, lots of F on beat 1, the minor third (Ab) present.
    line = scale_line(29, [3, 5, 7, 8])  # Ab, Bb, C, Db
    key = detect_key(line)
    assert key["alphatex"] == "fminor"
    assert key["signature"] == "4 flats"


def test_key_relative_major_decided_by_the_bass_root():
    # Same notes as F minor, but the bass sits on Ab on beat 1: A-flat major.
    line = scale_line(32, [2, 4, 5, 7])  # Ab Bb C Db Eb
    key = detect_key(line)
    assert key["alphatex"] == "abmajor"
    assert key["signature"] == "4 flats"


def test_key_e_minor_uses_sharps():
    line = scale_line(28, [3, 5, 7, 10])  # E G A B D
    key = detect_key(line)
    assert key["alphatex"] == "eminor"
    assert key["signature"] == "1 sharp"


# ---------------------------------------------------------------------------
# Fingering
# ---------------------------------------------------------------------------
def test_fingering_stays_in_range_and_prefers_small_moves():
    pitches = [28, 33, 38, 43, 45]  # open E A D G, then A2
    path = choose_fingering(pitches)
    assert path[:4] == [(0, 0), (1, 0), (2, 0), (3, 0)]
    assert path[4] == (3, 2)


def test_fingering_moves_out_of_range_notes_by_octave():
    path = choose_fingering([20])  # below the low E
    assert path[0] == (0, 4)       # played as G#1 on the E string


# ---------------------------------------------------------------------------
# End to end on a synthetic, messy line
# ---------------------------------------------------------------------------
def test_demo_song_messy_midi_gives_same_tab_as_clean_original():
    """
    Regression test on the original demo song (demo/, made by pipeline/make_demo.py).
    The "detected" file has simulated detector mistakes; after cleanup the tab must match the
    tab made from the clean original. This checks the cleanup on the mistakes WE simulated only.
    """
    pytest.importorskip("mido")
    import os
    from arrange import read_midi
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    messy = read_midi(os.path.join(root, "demo", "demo-groove-detected.mid"))
    clean = read_midi(os.path.join(root, "demo", "demo-groove-truth.mid"))
    a, _ = arrange(messy, 96, offset=1.0, title="Demo")
    b, _ = arrange(clean, 96, offset=1.0, title="Demo")
    assert a == b


def test_end_to_end_messy_input():
    rng = random.Random(7)
    clean = scale_line(29, [3, 5, 7, 8], bars=4)
    notes = []
    for g in clean:
        j = rng.uniform(-0.015, 0.015)
        notes.append(Note(g.start * S16 + 0.5 + j, g.end * S16 + 0.5 + j - 0.02, g.pitch, 80))
    notes.append(Note(0.5 + 0.30, 0.5 + 0.32, 60, 80))   # 20 ms glitch: dropped
    notes.append(Note(0.5 + 1.0, 0.5 + 1.1, 70, 8))      # very quiet: dropped
    text, info = arrange(notes, BPM, offset=0.5, title="Test")
    assert "\\ks fminor" in text
    assert info["bars"] == 4
    assert info["notes_written"] == len(clean)
