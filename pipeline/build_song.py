#!/usr/bin/env python3
"""
One command from a song to a page-ready bass tab. Runs the same four steps the web page's
"Wait" screen shows, times each one, and writes everything into web/songs/<id>/.

Start from whatever you have:

  A full song, separated automatically with Demucs (pip install demucs basic-pitch):
    python pipeline/build_song.py --audio my_song.wav --id my-song --title "My Song" --artist "Me" --bpm 83

  A bass stem you made yourself (e.g. with StemKit):
    python pipeline/build_song.py --stem my_bass.wav --id my-song --title "My Song" --artist "Me"

  A MIDI file you already have (detection skipped). Add --stem to get the "real bass" button:
    python pipeline/build_song.py --midi bass.mid --stem my_bass.wav --id my-song --title "My Song"

Tempo (--bpm) and beat 1 (--offset) are optional. If you leave them out, they are guessed and the
guess is printed with a confidence level. Guesses can be wrong: check by ear and pass the values.

Privacy default: songs are listed in web/songs/manifest.local.json, which git ignores, and the
song folder is ignored too. Add --public ONLY for material you have the right to publish
(your own original music, public-domain music, or synthetic test material).
"""
import argparse
import json
import os
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from arrange import add_settings_args, arrange, read_midi, settings_from_args  # noqa: E402
from tempo import estimate_offset, estimate_tempo  # noqa: E402

SONGS_DIR = os.path.join(ROOT, "web", "songs")
STEPS = ["Getting the song", "Separating the bass", "Finding the notes", "Writing the tab"]


class StepLog:
    """Prints the four steps and records how long each really took."""

    def __init__(self):
        self.steps = []

    def run(self, index, func, skipped_reason=None):
        label = f"[{index + 1}/4] {STEPS[index]}"
        if skipped_reason:
            print(f"{label}: skipped ({skipped_reason})")
            self.steps.append({"name": STEPS[index], "seconds": None, "note": skipped_reason})
            return None
        print(f"{label}...")
        t0 = time.perf_counter()
        result = func()
        took = time.perf_counter() - t0
        print(f"      done in {took:.1f} s")
        self.steps.append({"name": STEPS[index], "seconds": round(took, 2), "note": None})
        return result


def update_manifest(entry, public):
    name = "manifest.json" if public else "manifest.local.json"
    path = os.path.join(SONGS_DIR, name)
    data = {"songs": []}
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    data["songs"] = [s for s in data["songs"] if s["id"] != entry["id"]] + [entry]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    return path


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_argument_group("what you start from (pick one or more)")
    src.add_argument("--audio", help="the full song; the bass is separated with --backend")
    src.add_argument("--stem", help="a bass stem you already have (also used for the page's 'real bass' button)")
    src.add_argument("--midi", help="a bass MIDI file you already have (skips note detection)")
    ap.add_argument("--backend", choices=["manual", "demucs"], default=None,
                    help="how to separate the bass: demucs (automatic) or manual (you give --stem). "
                         "Default: manual if --stem is given, otherwise demucs")
    ap.add_argument("--id", required=True, help="short name for the folder and the URL, e.g. my-song")
    ap.add_argument("--title", required=True)
    ap.add_argument("--artist", default="")
    ap.add_argument("--bpm", type=float, help="tempo; guessed if left out")
    ap.add_argument("--offset", type=float, help="time in seconds of beat 1 of bar 1; guessed if left out")
    ap.add_argument("--key", help="override the detected key, e.g. fminor")
    ap.add_argument("--public", action="store_true", help="list in the committed manifest (only for material you may publish)")
    ap.add_argument("--work", default=os.path.join(ROOT, "work"), help="scratch folder for big files")
    add_settings_args(ap)
    args = ap.parse_args(argv)

    if not (args.audio or args.stem or args.midi):
        ap.error("give at least one of --audio, --stem or --midi")
    song_dir = os.path.join(SONGS_DIR, args.id)
    work_dir = os.path.join(args.work, args.id)
    os.makedirs(song_dir, exist_ok=True)
    os.makedirs(work_dir, exist_ok=True)
    log = StepLog()
    print(f"Building '{args.title}' into {os.path.relpath(song_dir, ROOT)}")

    # Step 1: get the song. In this prototype that means: you give us a file you have the right to use.
    def get_song():
        path = args.audio or args.stem or args.midi
        if not os.path.isfile(path):
            raise SystemExit(f"File not found: {path}")
        return path
    log.run(0, get_song)

    # Step 2: separate the bass
    stem = args.stem
    backend = args.backend or ("manual" if args.stem else "demucs")
    if args.midi and not args.audio:
        log.run(1, None, "you gave a MIDI file" + (" and a stem" if stem else ""))
    elif backend == "manual":
        from separate import separate
        stem = log.run(1, lambda: separate("manual", stem=args.stem))
    else:
        from separate import separate
        stem = log.run(1, lambda: separate("demucs", audio=args.audio, out_dir=work_dir))

    # Step 3: find the notes
    if args.midi:
        midi = args.midi
        log.run(2, None, "you gave a MIDI file")
    else:
        from detect import detect
        midi = log.run(2, lambda: detect(stem, os.path.join(work_dir, "bass.mid")))

    # Step 4: write the tab (tempo guess, beat-1 guess, cleanup, key, ties, fingering)
    def write_tab():
        notes = read_midi(midi)
        if not notes:
            raise SystemExit("No notes found. Check the stem: is the bass audible?")
        tempo = {"source": "given", "bpm": args.bpm}
        if not args.bpm:
            cands, conf, _ = estimate_tempo(notes)
            tempo = {"source": "guessed", "bpm": cands[0][0], "confidence": conf,
                     "alternatives": [c[0] for c in cands[1:]]}
            print(f"      Tempo guess: {tempo['bpm']:g} BPM (confidence {conf}); "
                  f"other possibilities: {', '.join(f'{b:g}' for b in tempo['alternatives'])}")
        offset = {"source": "given", "seconds": args.offset}
        if args.offset is None:
            secs, conf, _ = estimate_offset(notes, tempo["bpm"])
            offset = {"source": "guessed", "seconds": secs, "confidence": conf}
            print(f"      Beat 1 guess: {secs:.3f} s (confidence {conf})")
        text, info = arrange(notes, tempo["bpm"], offset["seconds"], settings_from_args(args),
                             args.title, args.artist, args.key)
        with open(os.path.join(song_dir, "song.atex"), "w", encoding="utf-8") as f:
            f.write(text)
        return tempo, offset, info
    tempo, offset, info = log.run(3, write_tab)

    # Copy the stem next to the tab so the page can play it.
    stem_name = None
    if stem:
        stem_name = "stem" + os.path.splitext(stem)[1].lower()
        shutil.copy(stem, os.path.join(song_dir, stem_name))

    k = info["detected_key"]
    entry = {
        "id": args.id,
        "title": args.title,
        "artist": args.artist,
        "bpm": tempo["bpm"],
        "offset": offset["seconds"],
        "key": info["key"],
        "bars": info["bars"],
        "atex": f"songs/{args.id}/song.atex",
        "stem": f"songs/{args.id}/{stem_name}" if stem_name else None,
        "build": f"songs/{args.id}/build.json",
    }
    build = {
        "steps": log.steps,
        "tempo": tempo,
        "offset": offset,
        "key": {"used": info["key"], "detected": k},
        "notes": {"detected": info["notes_in"], "after_cleanup": info["notes_after_cleanup"],
                  "written": info["notes_written"]},
        "range": info["range"],
        "settings": info["settings"],
        "built_at": time.strftime("%Y-%m-%d %H:%M"),
    }
    with open(os.path.join(song_dir, "build.json"), "w", encoding="utf-8") as f:
        json.dump(build, f, indent=2)
        f.write("\n")
    manifest = update_manifest(entry, args.public)

    print(f"\nDone: {info['bars']} bars, {info['notes_written']} notes, key {k['name']} "
          f"({k['signature']}, confidence {k['confidence']}).")
    print(f"Listed in {os.path.relpath(manifest, ROOT)}" + ("" if args.public else " (private, not committed)"))
    print("See it:  cd web  then  python -m http.server 8000  and open http://localhost:8000")


if __name__ == "__main__":
    main()
