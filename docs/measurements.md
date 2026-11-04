# Measurements

Record real results here. **Leave a cell blank until you have measured it.** Don't estimate, round up or fill gaps from memory. If a number comes from a small sample, say how small.

## 1. Time saved

| Song | Bars | Hand-transcription time (who, how) | Tool time: build_song.py total (from build.json) | Tool time + time to fix by hand | Notes |
|---|---|---|---|---|---|
| | | | | | |
| | | | | | |

How to measure:
- Hand transcription: a bassist transcribes the song by ear with a stopwatch running. Record their experience level.
- Tool time: add up the `seconds` of the four steps in `web/songs/<id>/build.json`. Note the computer and GPU.
- "Tool + fix": the same bassist corrects the tool's draft until they'd be happy to play from it.

## 2. Testers

| Date | Number of testers | Who (instrument, level) | Task given | Completed without help | Main problems seen |
|---|---|---|---|---|---|
| | | | | | |

Questions worth asking each tester:
- Did you understand the difference between "Play" (the real bass) and "Hear the tab alone"?
- Did you notice the "first draft" warning? Did it change how much you trusted the tab?
- Would you use this instead of looking for a tab online? What would you pay, if anything?

## 3. Note accuracy against a human tab

Compare the tool's tab with a trusted human transcription of the same section.

| Song / section | Bars compared | Notes in human tab | Notes matched (same pitch, same 16th) | Right pitch, wrong timing | Missed | Extra | Same string & fret as human |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

Define "matched" before you start. Suggested: same pitch, and the start is on the same 16th-note grid position.

Report it as **matched ÷ notes in human tab**, together with the number of bars. A percentage from 8 bars of one song is not a product accuracy number.

## 4. Demand (fake door)

| Period | Searches with no result | "Request this song" clicks | Top requested songs |
|---|---|---|---|
| | | | |

Requests are stored in each tester's browser. Ask testers to use **Download my requests** and send you the JSON file.

## 5. Tempo and key guesses

| Song | Tempo guess (confidence) | Real tempo | Beat-1 guess | Real beat 1 | Key guess (confidence) | Real key |
|---|---|---|---|---|---|---|
| | | | | | | |
