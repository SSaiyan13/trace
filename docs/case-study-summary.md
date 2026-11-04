# TRACE: case-study summary

**TRACE (Transcribe, Read, And Check by Ear)** turns a song into bass tab and sheet music that a musician can read, hear and print. It's for hobby players who can't find or afford sheet music for the song they want to learn.

## The problem
- Bass parts for most songs aren't published, and the ones that are cost money or are inaccurate.
- Learning by ear is slow: a bassist can spend hours on one song.
- Automatic transcription exists, but it gives you notes without telling you whether they're right.

## The idea in one line
Give the player a fast first draft **and** an easy way to check it against the real recording, so they trust their ears over the page.

## User journey
A "say what you want, get a result page fast, act on it" pattern (borrowed from ticket marketplaces as a UX pattern only):

| Step | What the player does | What TRACE does |
|---|---|---|
| 1 Find | Searches for a song | Shows ready songs; for missing ones, a **Request this song** button (a fake door that measures demand) |
| 2 Wait | Waits for the result | Shows the four real pipeline steps, with honest timings from the actual build |
| 3 See it | Reads the part | Whole song as tab, sheet music or both; key detected and changeable |
| 4 Hear it | Checks it by ear | Plays the real bass from the recording while a marker follows the tab |
| 5 Take it away | Practises offline | Prints or saves a clean PDF with only the music |

## Features
**Seeing the music**
- Whole-song tab and sheet music (77 bars draw in about 0.4 s)
- Three views: Tab, Sheet music, Both
- Detected key signature (for example F minor, 4 flats) with a dropdown to override it; notes are spelled with flats or sharps to match
- Tied notes across barlines and dotted note lengths, so long notes read as long notes
- A string and fret chosen for every note to keep hand movement small

**Hearing and checking**
- **Play** plays the real bass, isolated from the recording, which is the "answer key"
- **Hear the tab alone** plays what TRACE wrote, with a synthesized bass
- **Play both** for side-by-side checking
- A bar-and-beat tracker that follows the audio and keeps the current bar on screen
- Tap any bar to jump there, or go to a bar number
- Repeat a range of bars for practice
- Speed from 50% to 150% in 1% steps, without changing the pitch
- Playback stops cleanly at the end of the song

**Taking it away**
- Print or save as PDF; only the music prints

**Honesty built in**
- "Automatic first draft. Not a verified transcription." on every page
- A plain-language warning above the music
- The Wait screen admits the steps ran ahead of time and shows real timings
- Key and tempo guesses show their confidence

## Design
- **Visual identity:** maroon and black. A black header band with a maroon rule, maroon for actions and the playback marker, and serif headings that echo printed sheet music. The score itself is always black on white, like paper.
- **Light and dark mode:** warm paper background in light mode, near-black in dark mode. Maroon text turns to a lighter rose on black to stay readable.
- **Accessible:** keyboard-operable, visible focus, 44px+ touch targets (48px on tablets), AA contrast, respects reduced motion, screen-reader announcements for playback.
- **Works everywhere:** desktop, iPad portrait and landscape, and phones with no sideways scrolling. A player bar stays pinned to the bottom while you scroll the score.
- **Plain language:** "Sheet music", not "notation"; "the real bass", not "the stem".

## How it works (pipeline)
Song audio → separate the bass (Demucs, or a stem made by hand) → find the notes (Spotify's Basic Pitch) → clean up and arrange (TRACE's own code: tidy detector mistakes, snap to a 16th-note grid, detect the key, add ties, choose string and fret) → draw and play in the browser (alphaTab).
Everything is open source; TRACE's own code is MIT-licensed.

## What I learned from checking it
I compared TRACE's tab for one song (Tame Impala's "Loser") with a published bass transcription.
- Key and tempo matched the published sheet.
- *[Add your note-match result here once you've decided how to report it. See private-demo/loser/RESULTS.md; quote it with its caveats: one song, read from photos, pitch only.]*
- The biggest problem wasn't the notes but **where beat 1 starts**. TRACE guessed beat 1 from the first note it heard, which was too early, so every note looked 2–3 sixteenths late. The pitches were fine; the page just looked wrong. That's why the tracker ("check by ear") matters: a player hears the mismatch immediately.
- A single 2/4 bar in the song shifted every later barline. Supporting time-signature changes is the next technical step.

## Product decisions worth defending
- **Real bass as the default sound:** a synthesized tab always sounds right to itself; only the real recording can expose its mistakes.
- **Honest Wait screen** over a fake progress bar, so usability tests of waiting mean something.
- **Fake-door requests** to measure demand before building a catalogue.
- **Private by default:** songs you build never leave your computer unless you publish them on purpose.
- **Rights first:** no copyrighted audio or transcriptions in the public repo. A real product needs either user-uploaded audio processed only for that user, or licensed catalogue deals.

## What's next
- Transpose the tab and the real bass into another key
- Better beat-1 detection, and time-signature changes
- Measure: hand-transcription time vs TRACE time, tester sessions, note accuracy on more songs (see docs/measurements.md)
- Other instruments after bass
