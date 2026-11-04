# Decisions, and why

Short answers to "why did you do it this way?" Each one names what we gave up.

## Product

**Bass first.** A bass line is mostly one note at a time, which is the easiest case for automatic transcription. Bassists are also badly served by free sheet music. *Gave up:* the bigger guitar and piano audience, for now.

**The real bass is the default sound, not the synthesized tab.** The synthesized tab always sounds "right" to itself, so playing it alone can't reveal its own mistakes. The real bass from the recording is the answer key. With the marker moving over the tab, a person can hear where the two disagree. *Gave up:* a perfectly synced A/B, because two separate players can drift a little over a long song.

**Honest Wait screen.** The steps ran ahead of time, so the page says so and shows the real build timings instead of a fake progress bar. A fake wait would make any usability test of waiting meaningless. *Gave up:* some "magic".

**Fake-door "Request this song".** It measures demand before we build anything, and it costs nothing to run. Requests stay in the browser for privacy, and testers export them as JSON. *Gave up:* automatic collection, since there's no server.

**"First draft" warnings everywhere.** People trust printed music. Without a clear warning, a wrong tab could teach someone the wrong part.

## Pipeline

**Basic Pitch for notes, Demucs for separation.** Both are open source, with permissive licences (Apache-2.0 and MIT), run locally, and are widely used. StemKit is documented as the manual Windows route, but it's a GUI app and its documented input is YouTube, so it can't be the scripted path.

**Cleanup before everything else.** Detectors make predictable mistakes: tiny blips, quiet ghost notes, one held note split in two, and slides read as extra notes. Each mistake type gets one simple rule with one setting. That makes each rule easy to explain and test, and easy to turn off. *Gave up:* a learned model that might do better but couldn't be explained line by line.

**Same-pitch notes that touch become one held note (tied if it crosses a barline).** Split held notes were the most visible problem in the first prototype: a long note looked like a busy 16th-note figure. *Gave up:* real fast repeated notes with no gap also get joined. `--keep-repeats` turns it off.

**16th-note grid, 4/4.** Most pop and rock bass parts fit it, and it keeps the output readable. *Gave up:* triplets, swing, odd meters and tempo changes.

**Note lengths: "a note starts on a beat that matches its size".** For example, a quarter note starts on a beat, and an eighth note on an eighth. A dotted value is used only when it finishes the note or lands on a beat. The rule is short enough to say out loud and gives the tied and dotted notation a bassist expects. It's tested case by case in `tests/test_arrange.py`.

**Key: Krumhansl-Schmuckler plus "which note is on beat 1".** The classic method compares how long each of the 12 notes sounds with the typical pattern of each major and minor key. On its own, it can't tell F minor from A♭ major, because they use the same notes. Bass players tend to land on the key's root note on beat 1, so that check decides between them. The page shows the confidence level and lets you override the key. alphaTab then spells notes with flats or sharps to match the key signature (checked in the browser: G♭ in F minor, F♯ in E minor).

**Fingering by dynamic programming.** Each note can be played in up to four places. We pick the path through the whole song that minimises hand movement and string jumps. It's the same "cheapest path" idea as GPS routing. Tied notes keep the same string and fret.

**Tempo and beat 1 are guessed but always overridable.** Our first manual estimates for the first test song were 108 and then 75 BPM; the real tempo was 83. So the guess shows its confidence and alternatives, and the README tells you to check by ear.

## Page

**Our own tracker instead of alphaTab's cursor.** alphaTab's cursor follows only alphaTab's own synthesizer. We need the marker to follow the real bass recording, so we draw a bar highlight and a beat line ourselves, using alphaTab's layout positions. One clock (the stem's `currentTime`, or the synth position when only the synth plays) drives one tracker. That means it works the same in the tab, sheet music and both views, and for every play mode.

**Draw the whole song at once (no lazy loading).** With lazy loading, parts of the score that were never on screen printed blank. Drawing all 77 bars of a full song took about 0.4 s on a laptop (measured in the browser), so we don't need lazy loading. *Gave up:* nothing noticeable at this song length. Revisit it for much longer pieces.

**No build step, no framework.** Plain HTML, CSS and JavaScript that anyone can read and serve with `python -m http.server`. *Gave up:* components and type checking.

**Private by default.** Built songs go into a git-ignored list and folder. Publishing needs an explicit `--public`. A mistake then leaks nothing. *Gave up:* one extra flag to type for the demo.
