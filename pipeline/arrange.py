#!/usr/bin/env python3
"""
Turn a bass MIDI file (from Basic Pitch) into alphaTex that alphaTab shows as tab and notation.

Pipeline position:
    bass stem (WAV) -> detect.py (MIDI) -> THIS SCRIPT (song.atex) -> web page (alphaTab)

Usage:
    python pipeline/arrange.py bass.mid --bpm 83 --offset 0.52 --title "My song" --out song.atex

What it does, in order. Each step is a small function, so each can be tested on its own.
    1. clean_notes     drop very quiet / very short notes, join a held note that the detector
                       split into pieces, absorb tiny glitches into the note before them
    2. to_grid         snap note starts and ends to a 16th-note grid, using the tempo (BPM)
                       and the time of beat 1 (offset)
    3. monophonic      keep one note at a time (a bass line), lowest note wins
    4. fill_gaps       close tiny gaps so the score doesn't fill up with 16th rests
    5. choose_fingering pick a string and fret for every note (dynamic programming)
    6. detect_key      guess the key (Krumhansl-Schmuckler + which notes land on beat 1)
    7. to_alphatex     split notes at barlines into tied notes, use dotted lengths, write text

This is an algorithm, not machine learning. Every threshold is a setting you can change.
"""
import argparse
import json
import math
import sys
from dataclasses import dataclass, asdict

# ---------------------------------------------------------------------------
# Instrument
# ---------------------------------------------------------------------------
OPEN_STRINGS = [28, 33, 38, 43]  # standard 4-string bass: E1 A1 D2 G2 (low to high), MIDI numbers
MAX_FRET = 20
SIXTEENTHS_PER_BAR = 16  # 4/4 only in this prototype

NOTE_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


@dataclass
class Note:
    """A note as the detector gives it: times in seconds."""
    start: float
    end: float
    pitch: int
    velocity: int = 100


@dataclass
class GridNote:
    """A note on the 16th-note grid: start and end counted in 16ths from beat 1 of bar 1."""
    start: int
    end: int
    pitch: int


@dataclass
class Settings:
    """Cleanup thresholds. Defaults were chosen by ear on one song, so treat them as a starting point."""
    min_velocity: int = 20          # drop notes quieter than this (MIDI velocity 0-127)
    min_note_ms: float = 50.0       # drop notes shorter than this: they are almost always detector noise
    merge_gap_ms: float = 30.0      # same pitch, gap shorter than this: one held note, not two
    merge_short_fraction: float = 0.5  # notes shorter than this part of a 16th are folded into the note before
    gap_fill: int = 2               # close silent gaps of up to this many 16ths (bass lines are mostly connected)
    merge_repeats: bool = True      # same pitch, touching on the grid: write one held (tied) note


# ---------------------------------------------------------------------------
# Reading MIDI
# ---------------------------------------------------------------------------
def read_midi(path):
    """Return a list of Note from every track of a MIDI file (times in seconds)."""
    import mido  # imported here so the rest of the module (and its tests) works without mido

    mid = mido.MidiFile(path)
    notes, open_notes, t = [], {}, 0.0
    for msg in mid:  # iterating a MidiFile yields messages with delta times already in seconds
        t += msg.time
        if msg.type == "note_on" and msg.velocity > 0:
            open_notes.setdefault(msg.note, []).append((t, msg.velocity))
        elif msg.type in ("note_off", "note_on"):
            starts = open_notes.get(msg.note)
            if starts:
                start, vel = starts.pop(0)
                notes.append(Note(start, t, msg.note, vel))
    return sorted(notes, key=lambda n: (n.start, n.pitch))


# ---------------------------------------------------------------------------
# 1. Cleanup (in seconds, before snapping to the grid)
# ---------------------------------------------------------------------------
def clean_notes(notes, bpm, settings=Settings()):
    """Drop noise, join split held notes, fold tiny glitches into their neighbour."""
    sixteenth = 60.0 / bpm / 4.0
    kept = [
        n for n in notes
        if n.velocity >= settings.min_velocity and (n.end - n.start) * 1000.0 >= settings.min_note_ms
    ]
    kept.sort(key=lambda n: (n.start, n.pitch))

    out = []
    gap_limit = settings.merge_gap_ms / 1000.0
    short_limit = settings.merge_short_fraction * sixteenth
    for n in kept:
        n = Note(n.start, n.end, n.pitch, n.velocity)
        prev = out[-1] if out else None
        if prev is not None:
            gap = n.start - prev.end
            if n.pitch == prev.pitch and gap <= gap_limit:
                # The detector re-attacked a note that was really held: join them.
                prev.end = max(prev.end, n.end)
                continue
            if (n.end - n.start) < short_limit and gap <= gap_limit:
                # A tiny note right after another one is usually a slide or a harmonic, not a new note.
                prev.end = max(prev.end, n.end)
                continue
        out.append(n)
    return out


# ---------------------------------------------------------------------------
# 2-4. Grid, one note at a time, gap filling
# ---------------------------------------------------------------------------
def to_grid(notes, bpm, offset=0.0):
    """Snap to 16ths. offset = the time in seconds of beat 1 of bar 1."""
    sixteenth = 60.0 / bpm / 4.0
    out = []
    for n in notes:
        s = round((n.start - offset) / sixteenth)
        e = round((n.end - offset) / sixteenth)
        e = max(s + 1, e)  # every note lasts at least one 16th
        if e <= 0:
            continue  # entirely before beat 1 (lead-in)
        out.append(GridNote(max(0, s), e, n.pitch))
    return out


def monophonic(grid_notes):
    """One note at a time. Same start: keep the lowest. Overlap: cut the earlier note short."""
    events = sorted(grid_notes, key=lambda g: (g.start, g.pitch))
    mono = []
    for g in events:
        g = GridNote(g.start, g.end, g.pitch)
        if mono and mono[-1].start == g.start:
            continue
        if mono and mono[-1].end > g.start:
            mono[-1].end = g.start
        mono.append(g)
    # Snapping can make two same-pitch notes touch; that stays two notes (a real re-attack).
    return mono


def merge_repeats(mono):
    """
    Join a note to the previous one when it has the same pitch and starts exactly where the
    previous one ends. Basic Pitch often re-detects one held note as several; written as separate
    notes they look like a busy 16th-note figure. Joined, a long note shows as one note (tied
    across the barline when needed). The cost: a bassist really re-plucking the same note with no
    gap will also be joined. Turn this off with --keep-repeats for songs with fast repeated notes.
    """
    out = []
    for g in mono:
        if out and out[-1].pitch == g.pitch and out[-1].end == g.start:
            out[-1].end = g.end
        else:
            out.append(GridNote(g.start, g.end, g.pitch))
    return out


def fill_gaps(mono, gap_fill):
    """Extend a note to the next one if the silence between them is gap_fill 16ths or less."""
    out = [GridNote(g.start, g.end, g.pitch) for g in mono]
    for a, b in zip(out, out[1:]):
        if 0 < b.start - a.end <= gap_fill:
            a.end = b.start
    return out


# ---------------------------------------------------------------------------
# 5. Fingering (string and fret) by dynamic programming
# ---------------------------------------------------------------------------
def candidates(pitch):
    """All (string_index, fret) pairs that can play this pitch. string_index 0 = low E."""
    return [(i, pitch - o) for i, o in enumerate(OPEN_STRINGS) if 0 <= pitch - o <= MAX_FRET]


def move_cost(prev, cur):
    """How awkward it is to go from one (string, fret) to the next."""
    ps, pf = prev
    cs, cf = cur
    cost = 0.0
    if pf > 0 and cf > 0:
        cost += abs(pf - cf)       # hand shifts along the neck
    elif cf > 0:
        cost += 1.0                # coming from an open string: small cost to place the hand
    cost += 1.5 * abs(ps - cs)     # string jumps are awkward
    cost += 0.05 * cf              # slight preference for low positions
    return cost


def fit_range(pitch):
    """Move a pitch by octaves until the bass can play it (so the tab still shows something)."""
    q = pitch
    while not candidates(q) and q < OPEN_STRINGS[0]:
        q += 12
    while not candidates(q) and q > OPEN_STRINGS[-1] + MAX_FRET:
        q -= 12
    return q


def choose_fingering(pitches):
    """Viterbi search: the cheapest path of (string, fret) choices over the whole song."""
    if not pitches:
        return []
    layers = [candidates(fit_range(p)) for p in pitches]
    best = [{c: (0.05 * c[1], None) for c in layers[0]}]
    for k in range(1, len(layers)):
        layer = {}
        for c in layers[k]:
            layer[c] = min(((best[k - 1][pc][0] + move_cost(pc, c), pc) for pc in layers[k - 1]),
                           key=lambda x: x[0])
        best.append(layer)
    cur = min(best[-1], key=lambda c: best[-1][c][0])
    path = [cur]
    for k in range(len(layers) - 1, 0, -1):
        cur = best[k][cur][1]
        path.append(cur)
    return list(reversed(path))


# ---------------------------------------------------------------------------
# 6. Key detection
# ---------------------------------------------------------------------------
# Krumhansl-Kessler key profiles: how strongly each scale step "belongs" to a major / minor key.
MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

# Key name per tonic pitch class, spelled with the fewest accidentals.
MAJOR_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
MINOR_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"]
# Number of sharps (+) or flats (-) in each key signature.
MAJOR_ACC = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5]
MINOR_ACC = [-3, 4, -1, -6, 1, -4, 3, -2, 5, 0, -5, 2]

ROOT_WEIGHT = 0.5  # how much the "which note is on beat 1" check counts next to the profile match


def _pearson(a, b):
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    den = math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))
    return num / den if den else 0.0


def key_info(tonic, mode):
    """Everything the page and the alphaTex need to know about one key."""
    names = MAJOR_NAMES if mode == "major" else MINOR_NAMES
    acc = (MAJOR_ACC if mode == "major" else MINOR_ACC)[tonic]
    name = names[tonic]
    if acc == 0:
        sig = "no sharps or flats"
    else:
        count = abs(acc)
        sig = f"{count} {'flat' if acc < 0 else 'sharp'}{'s' if count > 1 else ''}"
    return {
        "alphatex": f"{name.lower()}{mode}",  # e.g. "fminor", the value alphaTab's \ks expects
        "name": f"{name} {mode}",              # e.g. "F minor"
        "signature": sig,                      # e.g. "4 flats"
        "accidentals": acc,
        "tonic": tonic,
        "mode": mode,
    }


def detect_key(grid_notes):
    """
    Guess the key from the notes.

    1. Pitch-class weights: how long each of the 12 notes sounds in total.
    2. Krumhansl-Schmuckler: correlate those weights with the major and minor profile for each of
       the 12 possible tonics (24 keys).
    3. Root check from the bass: in a bass line the tonic tends to land on beat 1. This splits keys
       that share the same notes, like F minor and A-flat major.
    Returns the best key plus the ranked list, so the page can show alternatives.
    """
    weights = [0.0] * 12
    root = [0.0] * 12
    for g in grid_notes:
        length = g.end - g.start
        pc = g.pitch % 12
        weights[pc] += length
        pos = g.start % SIXTEENTHS_PER_BAR
        if pos == 0:
            root[pc] += length * 2.0  # beat 1
        elif pos == 8:
            root[pc] += length * 1.0  # beat 3
    total_root = sum(root) or 1.0
    root_share = [r / total_root for r in root]

    scored = []
    for tonic in range(12):
        for mode, profile in (("major", MAJOR_PROFILE), ("minor", MINOR_PROFILE)):
            rotated = [profile[(pc - tonic) % 12] for pc in range(12)]
            corr = _pearson(weights, rotated)
            score = corr + ROOT_WEIGHT * root_share[tonic]
            scored.append((score, corr, tonic, mode))
    scored.sort(reverse=True)

    best_score, best_corr, tonic, mode = scored[0]
    margin = best_score - scored[1][0]
    confidence = "high" if margin > 0.15 else "medium" if margin > 0.05 else "low"
    result = key_info(tonic, mode)
    result["confidence"] = confidence
    result["margin"] = round(margin, 3)
    result["alternatives"] = [key_info(t, m)["name"] for _, _, t, m in scored[1:4]]
    return result


# ---------------------------------------------------------------------------
# 7. Writing alphaTex: barlines, ties, dotted notes
# ---------------------------------------------------------------------------
# Note lengths in 16ths, longest first. Dotted lengths are 1.5x a plain one.
PLAIN = {16: 1, 8: 2, 4: 4, 2: 8, 1: 16}         # 16ths -> alphaTex duration
DOTTED = {12: 2, 6: 4, 3: 8}                     # 16ths -> alphaTex duration of the plain base
ORDER = [16, 12, 8, 6, 4, 3, 2, 1]


def split_length(pos, length):
    """
    Split a length (in 16ths) that starts at `pos` within a bar into written note values.

    Rule, in plain words: a note value starts on a beat that matches its size (a quarter on a
    beat, an eighth on an eighth, and so on). A dotted value is only used when it finishes the
    note or ends on a beat; otherwise it would leave an awkward 16th-note remainder.
    The caller makes sure pos + length never crosses a barline.
    """
    out = []
    end = pos + length
    while pos < end:
        remaining = end - pos
        for size in ORDER:
            if size > remaining:
                continue
            if size in PLAIN:
                if pos % size == 0:
                    break
            else:
                base = size * 2 // 3
                lands_well = (pos + size == end) or ((pos + size) % 4 == 0)
                if pos % base == 0 and lands_well:
                    break
        out.append(size)
        pos += size
    return out


def written(size):
    """alphaTex duration and whether it is dotted, for a size in 16ths."""
    if size in PLAIN:
        return PLAIN[size], False
    return DOTTED[size], True


def split_at_barlines(start, end):
    """Yield (bar_index, pos_in_bar, length) pieces of a span, cut at each barline."""
    pos = start
    while pos < end:
        bar = pos // SIXTEENTHS_PER_BAR
        bar_end = (bar + 1) * SIXTEENTHS_PER_BAR
        piece_end = min(end, bar_end)
        yield bar, pos - bar * SIXTEENTHS_PER_BAR, piece_end - pos
        pos = piece_end


def beat_text(size, fret=None, string=None, tied=False):
    """One alphaTex beat. string is the alphaTex string number (1 = highest, G)."""
    dur, dotted = written(size)
    beat_fx = "{d}" if dotted else ""
    if fret is None:
        return f"r.{dur}{beat_fx}"
    note_fx = "{t}" if tied else ""
    return f"{fret}.{string}{note_fx}.{dur}{beat_fx}"


def build_bars(notes, fingering, total_bars=None):
    """Turn grid notes plus their (string, fret) into a list of bars, each a list of beat texts."""
    if total_bars is None:
        last_end = max((n.end for n in notes), default=0)
        total_bars = max(1, math.ceil(last_end / SIXTEENTHS_PER_BAR))
    limit = total_bars * SIXTEENTHS_PER_BAR
    bars = [[] for _ in range(total_bars)]

    def add_rest(start, end):
        for bar, pos, length in split_at_barlines(start, end):
            for size in split_length(pos, length):
                bars[bar].append(beat_text(size))

    cursor = 0
    for note, (string_idx, fret) in zip(notes, fingering):
        if note.start >= limit:
            break
        end = min(note.end, limit)
        if note.start > cursor:
            add_rest(cursor, note.start)
        alphatex_string = len(OPEN_STRINGS) - string_idx  # alphaTex counts strings from the top
        first = True
        for bar, pos, length in split_at_barlines(note.start, end):
            for size in split_length(pos, length):
                bars[bar].append(beat_text(size, fret, alphatex_string, tied=not first))
                first = False
        cursor = end
    if cursor < limit:
        add_rest(cursor, limit)
    return bars


def to_alphatex(bars, title, artist="", bpm=120, key=None):
    """Assemble the full alphaTex document."""
    def q(text):
        return '"' + str(text).replace('"', "'") + '"'

    header = [f"\\title {q(title)}"]
    if artist:
        header.append(f"\\artist {q(artist)}")
    header += [
        f"\\tempo {int(round(bpm))}",
        "\\instrument 33",            # General MIDI: electric bass (finger)
        "\\tuning G2 D2 A1 E1",
        "\\clef F4",
        ".",
    ]
    lines = []
    for i, beats in enumerate(bars):
        prefix = ""
        if i == 0:
            prefix = "\\ts 4 4 " + (f"\\ks {key} " if key else "")
        lines.append(prefix + " ".join(beats))
    return "\n".join(header) + "\n" + " |\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# The whole arranger
# ---------------------------------------------------------------------------
def arrange(notes, bpm, offset=0.0, settings=Settings(), title="Bass transcription", artist="",
            key=None, bars=None):
    """Run steps 1-7. Returns (alphatex_text, info_dict)."""
    cleaned = clean_notes(notes, bpm, settings)
    grid = to_grid(cleaned, bpm, offset)
    mono = monophonic(grid)
    if settings.merge_repeats:
        mono = merge_repeats(mono)
    mono = fill_gaps(mono, settings.gap_fill)
    if bars:
        limit = bars * SIXTEENTHS_PER_BAR
        mono = [GridNote(g.start, min(g.end, limit), g.pitch) for g in mono if g.start < limit]
    if not mono:
        raise ValueError("No notes left after cleanup. Check the offset, tempo and thresholds.")
    fingering = choose_fingering([g.pitch for g in mono])
    detected = detect_key(mono)
    chosen_key = key or detected["alphatex"]
    bar_list = build_bars(mono, fingering, bars)
    text = to_alphatex(bar_list, title, artist, bpm, chosen_key)

    pitches = [g.pitch for g in mono]
    info = {
        "notes_in": len(notes),
        "notes_after_cleanup": len(cleaned),
        "notes_written": len(mono),
        "bars": len(bar_list),
        "key": chosen_key,
        "detected_key": detected,
        "range": [_name(min(pitches)), _name(max(pitches))],
        "settings": asdict(settings),
    }
    return text, info


def _name(pitch):
    return f"{NOTE_NAMES_FLAT[pitch % 12]}{pitch // 12 - 1}"


def add_settings_args(ap):
    """Cleanup flags, shared with build_song.py."""
    d = Settings()
    ap.add_argument("--min-velocity", type=int, default=d.min_velocity, help="drop notes quieter than this (0-127)")
    ap.add_argument("--min-note-ms", type=float, default=d.min_note_ms, help="drop notes shorter than this")
    ap.add_argument("--merge-gap-ms", type=float, default=d.merge_gap_ms,
                    help="join same-pitch notes with a gap shorter than this")
    ap.add_argument("--merge-short-fraction", type=float, default=d.merge_short_fraction,
                    help="fold notes shorter than this part of a 16th into the note before")
    ap.add_argument("--gap-fill", type=int, default=d.gap_fill, help="close gaps of up to this many 16ths")
    ap.add_argument("--keep-repeats", action="store_true", help="do not join same-pitch notes that touch")


def settings_from_args(args):
    return Settings(args.min_velocity, args.min_note_ms, args.merge_gap_ms,
                    args.merge_short_fraction, args.gap_fill, not args.keep_repeats)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("midi", help="bass MIDI file, for example from Basic Pitch")
    ap.add_argument("--bpm", type=float, required=True, help="song tempo (use tempo.py to estimate it)")
    ap.add_argument("--offset", type=float, default=0.0, help="time in seconds of beat 1 of bar 1")
    ap.add_argument("--title", default="Bass transcription")
    ap.add_argument("--artist", default="")
    ap.add_argument("--key", default=None, help="override the key, e.g. fminor, abmajor")
    ap.add_argument("--bars", type=int, default=None, help="keep only this many bars (default: whole song)")
    ap.add_argument("--out", default="song.atex")
    ap.add_argument("--info", default=None, help="also write a JSON summary here")
    add_settings_args(ap)
    args = ap.parse_args(argv)

    settings = settings_from_args(args)
    notes = read_midi(args.midi)
    if not notes:
        sys.exit("No notes found in the MIDI file.")
    text, info = arrange(notes, args.bpm, args.offset, settings, args.title, args.artist, args.key, args.bars)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(text)
    if args.info:
        with open(args.info, "w", encoding="utf-8") as f:
            json.dump(info, f, indent=2)
    k = info["detected_key"]
    print(f"Wrote {args.out}: {info['notes_written']} notes in {info['bars']} bars "
          f"({info['notes_in']} detected, {info['notes_after_cleanup']} after cleanup).")
    print(f"Key: {k['name']} ({k['signature']}), confidence {k['confidence']}. "
          f"Other candidates: {', '.join(k['alternatives'])}.")
    print(f"Range: {info['range'][0]} to {info['range'][1]}.")


if __name__ == "__main__":
    main()
