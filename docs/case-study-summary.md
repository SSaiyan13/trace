# TRACE: case-study notes

**TRACE (Transcribe, Read, And Check by Ear)** turns a song into bass tab and sheet music that a musician can read, hear and print. It's for hobby players who can't find or afford sheet music for the song they want to learn.

- Code: https://github.com/SSaiyan13/trace (open source, MIT)
- Try it: the "Open in GitHub Codespaces" button in the README runs it in your browser without a deployment

## The idea in one line
Give the player a fast first draft **and** an easy way to check it against the real recording, so they can trust their ears over the page.

---

## Pain points and the features that answer them

| Pain point | What it feels like | What TRACE does about it |
|---|---|---|
| **No sheet music for the song** | Most songs have no published bass part; the ones that exist cost money | Turns the recording itself into tab and sheet music for the **whole song**, not an excerpt |
| **Free tabs are often wrong, and you can't tell where** | You learn a mistake and only find out much later | **Play** plays the real bass from the recording while a marker moves through the tab. Where the sound and the page disagree, you hear it straight away |
| **It's hard to hear the bass in a full mix** | The bass is buried under drums, guitars and vocals | The bass is **separated** from the mix, so "the real bass" is just the bass player |
| **Automatic transcription feels like a black box** | A wall of notes with no reason to trust it | Honesty built in: "first draft" warnings, confidence shown for key and tempo guesses, and **Hear the tab alone / Play both** to compare what TRACE wrote with the recording |
| **Learning by ear is slow** | Hours of rewinding to work out one bar | A first draft in minutes; **tap any bar** to start there; **Repeat** 1, 2, 4 or 8 bars with one tap; **speed** from 50% to 150% without changing the pitch |
| **Tab or sheet music?** | Bassists mostly read tab; teachers and other players read notation | **Tab, Sheet music or Both**, with a detected key signature that you can change; ties and dotted notes make long notes read as long notes |
| **Awkward fingerings** | Tabs that jump all over the neck | A string and fret is chosen for every note to keep hand movement small |
| **Getting lost while playing** | You look up and don't know which bar you're in | A bar-and-beat **marker** that follows the music and scrolls the next line into view before you get there; a "Bar 12 of 77, beat 3" readout |
| **Practising away from the computer** | Laptops don't sit on music stands | Works on **iPad** (portrait and landscape) and phones; **Print or save as PDF** with only the music |
| **Wireless headphones play sound late** | The marker looks ahead of the music | A **marker timing nudge**, remembered on that device |
| **The song I want isn't there** | Dead end, you leave | **Request this song** (and "coming later" instruments) record what people want. That's a demand signal for what to build next |
| **Waiting without knowing why** | A spinner with no explanation | The **Wait screen** explains each step in plain words, with the real time each one took |

---

## How it works

### What the player sees
1. **Find:** search for a song, or pick one from "Ready to play". If it's missing, press **Request this song**.
2. **Wait:** four steps, each explained as it happens: getting the song, separating the instrument, finding the notes, writing the music.
3. **The music:** the whole song as tab, sheet music or both. Press **Play** to hear the real recording while the marker follows along. Repeat a section, slow it down, tap any bar to jump there.
4. **Take it with you:** print or save a clean PDF.

### What happens behind the scenes
| Step | Plain words | Tool |
|---|---|---|
| 1. Get the song | Start from an audio file the player has the right to use | – |
| 2. Separate the bass | An AI model pulls the bass out of the mix, like turning every other instrument down to zero | Demucs (Meta, open source), or a stem made by hand |
| 3. Find the notes | Another model listens to the bass and writes down each note's pitch, start and length | Basic Pitch (Spotify, open source) |
| 4. Write the music | TRACE's own code: tidies the detector's mistakes, lines the rhythm up with the beat, works out the key, adds ties and dotted notes, picks string and fret | `pipeline/arrange.py` |
| Show it | Draws tab and sheet music, plays it back, draws the marker | alphaTab (open source) |

**The one technical idea worth explaining in an interview:** playback position is kept in *beats from bar 1*. When the real bass plays, the beat comes from the audio's clock: `(time − beat-1 offset) × tempo ÷ 60`. When only the synthesized tab plays, it comes from the synth. One number drives one marker, so it works the same in every view.

---

## Evidence: how accurate is it?
I checked TRACE's tab for one song (Tame Impala's "Loser", 77 bars) against **two independent human transcriptions**: a YouTube bass tutorial's sheet and tab, and Songsterr's bass tab. I compared which notes (pitches) appear, in order.

| Comparison | Result |
|---|---|
| The two human transcriptions vs each other | They agree on **95%** of notes |
| TRACE vs the notes both humans agree on | TRACE matches **89%** of them, and adds only 20 notes they don't have (under 5% of what it writes) |
| Key and tempo | Both match the published sheets (F minor; 83 BPM) |

**What the misses tell me:** of the notes TRACE missed, about two-thirds were never picked up by the note detector (Basic Pitch). TRACE's own cleanup and arranging lost only about 4% of notes. So the next accuracy gain comes from detection, not from TRACE's arranging code.

**The surprising finding:** the biggest visible problem wasn't wrong notes but **where beat 1 starts**. TRACE guessed beat 1 from the first note it heard, which came a little before the first real downbeat. Every note then looked 2–3 sixteenths late in the bar: the pitches were right but the rhythm looked wrong. With beat 1 fixed, twice as many bars matched exactly. This is exactly why the "check by ear" marker matters: a player hears that kind of mismatch immediately.

**Also learned:**
- Even two careful humans disagree on 5% of notes, so "100% against one reference" isn't the right target.
- Sources write the same tempo differently (83 vs 165 BPM, the same speed counted twice as fast). TRACE's tempo guess listed both.
- One short 2/4 bar in the song shifted every later barline, because TRACE only supports 4/4 so far.

**Limits of this check (say these when quoting it):** one song; both references were read by eye from screenshots, and a few fast bars are best guesses; pitch only, rhythm only spot-checked; each reference is itself one person's transcription.

---

## Design
- **Logo:** a treble clef and a bass clef fused into one mark, pointing at more instruments than bass.
- **Visual identity:** maroon and black, with serif headings that echo printed sheet music. The score is always black on white, like paper.
- **Light and dark mode,** each checked for readable contrast.
- **Musician-friendly controls:** the player is pinned to the bottom of the screen, with a big Play button, one-tap Repeat and speed, all reachable while your hands are near the instrument.
- **Accessible:** keyboard-operable, visible focus, 44px+ touch targets (48px on tablets), respects reduced motion, screen-reader announcements for playback.
- **Plain language:** "Sheet music", not "notation"; "the real bass", not "the stem". The words don't assume bass, so more instruments can follow.

## Product decisions worth defending
- **The real recording is the default sound.** A synthesized tab always sounds right to itself; only the real recording can expose its mistakes.
- **An honest Wait screen** over a fake progress bar, so usability tests of waiting mean something.
- **Fake doors** ("Request this song", "coming later" instruments) to measure demand before building a catalogue or new instruments.
- **Private by default:** songs you build stay on your computer unless you publish them on purpose.
- **Rights first:** no copyrighted audio or transcriptions in the public repo. A real product needs either user-uploaded audio processed only for that user, or licensed catalogue deals. Downloading from YouTube breaks its terms for a public product.
- **Not deployed yet:** it's an unfinished prototype, so people try it in their own Codespace or on their own computer instead.

## What's next
- Transpose the music and the real recording into another key
- Better beat-1 detection, and time-signature changes (like that 2/4 bar)
- Better note detection, where most of the remaining misses are
- More instruments after bass
- Measure: hand-transcription time vs TRACE time, tester sessions, accuracy on more songs (template in [measurements.md](measurements.md))
