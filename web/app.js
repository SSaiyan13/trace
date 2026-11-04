/* TRACE (Transcribe, Read, And Check by Ear) - page logic.
 *
 * Plain JavaScript, no build step. Sections:
 *   1. Songs list (manifest)          4. Result: score drawing (alphaTab)
 *   2. Screen switching                5. Playback: one clock, one tracker, Repeat
 *   3. Find and Wait screens           6. Key override, print, start-up
 *
 * The one idea to understand: playback position is kept in BEATS from beat 1 of bar 1.
 *   - When the real bass (stem) plays, beats come from the audio element's currentTime:
 *         beats = (currentTime - offset) * bpm / 60
 *   - When only the synthesized tab plays, beats come from alphaTab's position (ticks / 960).
 * The tracker draws whatever that number is, so it works the same in every view.
 */
(function () {
  'use strict';

  var TICKS_PER_BEAT = 960;   // alphaTab's MIDI resolution
  var BEATS_PER_BAR = 4;      // 4/4 only in this prototype
  var $ = function (id) { return document.getElementById(id); };
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------------
  // 1. Songs list
  // ------------------------------------------------------------------
  var songs = [];

  function loadJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' (' + r.status + ')');
      return r.json();
    });
  }

  function loadSongs() {
    // manifest.json is public. manifest.local.json lists songs you built on this computer;
    // git ignores it, so it never reaches GitHub. It is fine for it to be missing.
    var pub = loadJson('songs/manifest.json').catch(function () { return { songs: [] }; });
    var loc = loadJson('songs/manifest.local.json').catch(function () { return { songs: [] }; });
    return Promise.all([pub, loc]).then(function (res) {
      res[1].songs.forEach(function (s) { s.local = true; });
      songs = res[0].songs.concat(res[1].songs);
    });
  }

  function findSongs(text) {
    var words = text.toLowerCase().split(/\s+/).filter(Boolean);
    return songs.filter(function (s) {
      var hay = (s.title + ' ' + s.artist).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    });
  }

  function renderSongList() {
    var ul = $('song-list');
    ul.innerHTML = '';
    if (!songs.length) {
      ul.innerHTML = '<li class="muted">No songs found. Run pipeline/build_song.py to add one.</li>';
      return;
    }
    $('ready-count').textContent = songs.length + (songs.length === 1 ? ' song' : ' songs');
    songs.forEach(function (s) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'song-card';
      b.innerHTML = '<strong></strong><span class="artist"></span><span class="facts"></span><span class="go" aria-hidden="true">Open</span>';
      b.querySelector('strong').textContent = s.title;
      b.querySelector('.artist').textContent = s.artist || '';
      var mins = Math.round(s.bars * BEATS_PER_BAR / s.bpm * 10) / 10;
      b.querySelector('.facts').textContent = cap(s.instrument || 'bass') + ' \u00b7 ' + keyLabel(s.key) + ' \u00b7 ' +
        Math.round(s.bpm) + ' BPM \u00b7 about ' + mins + ' min';
      if (s.local) {
        var tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'only on this computer';
        b.querySelector('strong').appendChild(tag);
      }
      b.addEventListener('click', function () { startWait(s); });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  // ------------------------------------------------------------------
  // 2. Screens
  // ------------------------------------------------------------------
  function cap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

  function show(name) {
    ['find', 'wait', 'result'].forEach(function (k) { $('screen-' + k).hidden = (k !== name); });
    window.scrollTo(0, 0);
    var h = document.querySelector('#screen-' + name + ' h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  // ------------------------------------------------------------------
  // 3. Find and Wait
  // ------------------------------------------------------------------
  var lastQuery = '';

  $('search-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = $('q').value.trim();
    if (!text) { $('q').focus(); return; }
    var hits = findSongs(text);
    if (hits.length) { $('not-found').hidden = true; startWait(hits[0]); return; }
    lastQuery = text;
    $('nf-title').textContent = 'We don’t have “' + text + '” yet.';
    $('request-msg').textContent = '';
    $('not-found').hidden = false;
    $('request-btn').focus();
  });

  // The "Request this song" button is a fake door: it measures demand before we build anything.
  // Requests stay in this browser (localStorage). "Download my requests" exports them as JSON.
  function getRequests() {
    try { return JSON.parse(localStorage.getItem('songRequests') || '[]'); } catch (e) { return []; }
  }
  function addRequest(entry) {
    var list = getRequests();
    entry.at = new Date().toISOString();
    list.push(entry);
    try { localStorage.setItem('songRequests', JSON.stringify(list)); } catch (e) { /* storage blocked */ }
    showRequestCount();
    return list.length;
  }
  function showRequestCount() {
    var n = getRequests().length;
    $('my-requests').textContent = n ? 'You have made ' + n + ' request' + (n === 1 ? '' : 's') + ' on this device.'
                                     : 'You haven\u2019t requested any songs yet.';
    $('download-requests').hidden = !n;
  }
  $('request-btn').addEventListener('click', function () {
    addRequest({ query: lastQuery });
    $('request-msg').textContent = 'Thanks, we\u2019ve noted it.';
  });

  // Only bass works today. The other instruments are a fake door: tapping one records the interest.
  document.querySelectorAll('[data-inst]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var inst = chip.getAttribute('data-inst');
      if (inst === 'bass') { $('inst-msg').textContent = ''; return; }
      addRequest({ instrument: inst });
      $('inst-msg').textContent = cap(inst) + ' is coming later. We\u2019ve noted that you want it.';
    });
  });
  $('download-requests').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(getRequests(), null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'song-requests.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  var waitTimer = null;

  function startWait(song) {
    stopPlayback();
    $('wait-song').textContent = song.title;
    var list = $('wait-list');
    list.innerHTML = '';
    show('wait');
    history.replaceState(null, '', '?song=' + encodeURIComponent(song.id));
    var inst = song.instrument || 'bass';
    var names = ['Getting the song', 'Separating the ' + inst, 'Finding the notes', 'Writing the music'];
    var explain = [
      'TRACE starts from the full recording: every instrument and voice mixed together.',
      'A separation model (Demucs) pulls the ' + inst + ' out of the mix, like turning every other instrument down to zero. That gives you the real ' + inst + ' to play along with later.',
      'A note detector (Basic Pitch, by Spotify) listens to that ' + inst + ' track and writes down each note: its pitch, when it starts and how long it lasts.',
      'TRACE tidies the detector\u2019s mistakes, lines the rhythm up with the beat, works out the key, and picks a string and fret for every note so it\u2019s comfortable to play.'
    ];
    var build = loadJson(song.build).catch(function () { return null; });
    build.then(function (b) {
      var items = names.map(function (name, i) {
        var step = b && b.steps && b.steps[i];
        // Real timings come from build.json, written by pipeline/build_song.py. Steps done
        // outside that script (e.g. separating the bass in StemKit) were not timed, and we say so.
        var note = 'done earlier (not timed)';
        if (step && step.seconds != null) note = 'took ' + formatSeconds(step.seconds);
        var li = document.createElement('li');
        li.innerHTML = '<span class="dot" aria-hidden="true"></span><div><p class="name"></p><p class="what"></p></div><span class="time"></span>';
        li.querySelector('.name').textContent = name;
        li.querySelector('.what').textContent = explain[i];
        li.querySelector('.time').textContent = '';
        li.dataset.note = note;
        list.appendChild(li);
        return li;
      });
      var i = 0;
      clearInterval(waitTimer);
      function step() {
        if (i > 0) {
          items[i - 1].classList.remove('active');
          items[i - 1].classList.add('done');
          items[i - 1].querySelector('.time').textContent = items[i - 1].dataset.note;
        }
        if (i < items.length) { items[i].classList.add('active'); i++; }
        else { clearInterval(waitTimer); setTimeout(function () { showResult(song); }, reducedMotion ? 0 : 500); }
      }
      step();
      waitTimer = setInterval(step, reducedMotion ? 400 : 1600);  // slow enough to read each step
    });
    $('skip-wait').onclick = function () { clearInterval(waitTimer); showResult(song); };
  }

  function formatSeconds(s) {
    if (s < 1) return 'under a second';
    if (s < 90) return Math.round(s) + ' seconds';
    return Math.round(s / 60) + ' minutes';
  }

  // ------------------------------------------------------------------
  // 4. Result: drawing the score with alphaTab
  // ------------------------------------------------------------------
  var api = null;
  var current = null;         // the song being shown
  var atexText = '';          // its alphaTex, as loaded (the key may be swapped in)
  var barCount = 0;
  var view = 'tab';
  var drawing = false, viewPending = false;
  var PROFILES = function () {
    return { tab: alphaTab.StaveProfile.Tab, score: alphaTab.StaveProfile.Score, both: alphaTab.StaveProfile.ScoreTab };
  };

  function abs(path) { return new URL(path, window.location.href).href; }

  function initAlphaTab() {
    var narrow = window.matchMedia('(max-width: 600px)').matches;
    api = new alphaTab.AlphaTabApi($('score'), {
      // Lazy loading (draw only what is on screen) is OFF on purpose: with it on, bars you never
      // scrolled to print as blank pages. Drawing all 77 bars of a full song took about 0.4 s
      // on a laptop, so we don't need it. Turn it back on if songs get much longer.
      core: { fontDirectory: abs('alphatab/font/'), scriptFile: abs('alphatab/alphaTab.min.js'),
              enableLazyLoading: false },
      display: {
        staveProfile: PROFILES()[view],
        layoutMode: alphaTab.LayoutMode.Page,
        scale: narrow ? 0.8 : 1.0
      },
      // Our own tracker replaces alphaTab's cursor, so one tracker works for the stem and the synth.
      player: { enablePlayer: true, enableCursor: false, enableUserInteraction: false,
                soundFont: abs('alphatab/soundfont/sonivox.sf2') }
    });
    api.renderStarted.on(function () { drawing = true; $('score-loading').hidden = false; });
    api.renderFinished.on(function () {
      drawing = false;
      $('score-loading').hidden = true;
      if (viewPending) { viewPending = false; redrawView(); return; }
      drawLoopMarks();
      drawTracker(true);
    });
    api.error.on(function (e) { say('Something went wrong drawing the music: ' + (e && e.message ? e.message : e)); });
    api.playerReady.on(function () {
      synthReady = true;
      updateButtons();
    });
    api.playerPositionChanged.on(function (e) {
      lastSynthTick = e.currentTick;
      lastSynthAt = performance.now();
      if (mode === 'tab') checkBounds();
    });
    api.playerFinished.on(function () {
      if (mode === 'tab') { stopPlayback(); say('End of the song.'); }
    });
    $('score').addEventListener('click', onScoreClick);
  }

  function showResult(song) {
    clearInterval(waitTimer);
    stopPlayback();
    current = song;
    show('result');
    $('song-h').textContent = song.title + (song.artist ? ' – ' + song.artist : '');
    var inst = song.instrument || 'bass';
    $('song-meta').textContent = cap(inst) + ' \u00b7 ' + Math.round(song.bpm) + ' BPM \u00b7 ' + song.bars + ' bars';
    document.querySelectorAll('.inst').forEach(function (el) { el.textContent = inst; });
    $('jump-bar').max = song.bars;
    repeat.on = false;
    setPosition(0);
    updateRepeat();
    if (!api) initAlphaTab();
    $('score-loading').hidden = false;
    clearScore();

    // Real bass stem (optional). Main Play button plays it; without it, Play falls back to the synth.
    if (song.stem) {
      stem.src = song.stem;
      stem.load();
    } else {
      stem.removeAttribute('src');
    }
    updateButtons();

    fetch(song.atex, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (text) {
        atexText = text;
        barCount = song.bars;
        loadBuildInfo(song);
        drawing = true;  // alphaTab only reports "started" a moment later
        api.tex(text);
      })
      .catch(function (e) { say('Could not load the tab file (' + e.message + ').'); });
  }

  function loadBuildInfo(song) {
    setupKeySelect(song.key, null);
    loadJson(song.build).then(function (b) {
      setupKeySelect(song.key, b && b.key ? b.key.detected : null);
    }).catch(function () { /* key select already works without it */ });
  }

  document.querySelectorAll('[data-view]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (btn.getAttribute('data-view') === view) return;  // already showing: no redraw, keep playing
      view = btn.getAttribute('data-view');
      document.querySelectorAll('[data-view]').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      // Redrawing the score while it plays confuses the player, so stop first (as before).
      stopPlayback();
      // A switch while alphaTab is still drawing would mix two layouts: do it once that drawing is done.
      if (drawing) viewPending = true; else redrawView();
    });
  });

  function redrawView() {
    clearScore();
    api.settings.display.staveProfile = PROFILES()[view];
    api.updateSettings();
    api.render();
  }

  // alphaTab 1.8.4 with lazy loading off sometimes keeps the old drawing on the first redraw, so
  // the old and new layouts overlap (seen when switching Tab -> Both). Emptying it first avoids that.
  // shortcut: works around an alphaTab quirk; drop it if a newer alphaTab fixes redraws.
  function clearScore() {
    var surface = $('score').querySelector('.at-surface');
    if (surface) surface.replaceChildren();
  }

  // ------------------------------------------------------------------
  // 5. Playback: one clock, one tracker
  // ------------------------------------------------------------------
  var stem = $('stem');
  var synthReady = false;
  var mode = null;            // null (stopped/paused), 'stem', 'tab' or 'both'
  var positionBeats = 0;      // where play starts from when stopped or paused
  var lastSynthTick = 0, lastSynthAt = 0;
  var rafId = 0;
  var lastBarShown = -1;

  stem.addEventListener('error', function () { if (current && current.stem) say('The real bass audio could not be loaded.'); });
  stem.addEventListener('ended', function () { if (mode === 'stem' || mode === 'both') stopPlayback(); });
  stem.addEventListener('timeupdate', function () { if (mode === 'stem' || mode === 'both') checkBounds(); });

  /** Seek the stem. Before the file has loaded (normal on iPad until the first tap), wait for it. */
  function setStemTime(t) {
    t = Math.max(0, t);
    if (stem.readyState >= 1) { stem.currentTime = t; return; }
    stem.addEventListener('loadedmetadata', function () { stem.currentTime = t; }, { once: true });
  }

  function secondsPerBeat() { return 60 / current.bpm; }
  function totalBeats() { return barCount * BEATS_PER_BAR; }
  function stemTimeFor(beats) { return current.offset + beats * secondsPerBeat(); }

  /** The single clock: where are we, in beats from beat 1 of bar 1? */
  function nowBeats() {
    if (mode === 'stem' || mode === 'both') {
      return (stem.currentTime - current.offset) / secondsPerBeat();
    }
    if (mode === 'tab') {
      // alphaTab reports the position every few dozen ms; fill in between for a smooth cursor.
      var since = (performance.now() - lastSynthAt) / 1000;
      var ahead = Math.min(0.25, since / secondsPerBeat() * speed());
      return lastSynthTick / TICKS_PER_BEAT + (lastSynthAt ? ahead : 0);
    }
    return positionBeats;
  }

  function speed() { return parseFloat($('speed').value); }

  function hasStem() { return !!(current && current.stem); }

  function updateButtons() {
    var main = $('play-main'), synthBtn = $('play-synth'), bothBtn = $('play-both');
    var mainMode = hasStem() ? 'stem' : 'tab';
    // Don't wait for the stem to load: iPad/iPhone Safari only loads audio after a tap.
    main.disabled = hasStem() ? false : !synthReady;
    synthBtn.disabled = !synthReady;
    bothBtn.disabled = !synthReady;
    synthBtn.hidden = !hasStem();   // without a stem the main button already plays the tab
    bothBtn.hidden = !hasStem();
    main.textContent = mode === mainMode ? 'Pause' : (hasStem() ? 'Play' : 'Play the tab');
    synthBtn.textContent = mode === 'tab' && hasStem() ? 'Pause' : 'Hear the tab alone';
    bothBtn.textContent = mode === 'both' ? 'Pause' : 'Play both';
    $('stop').disabled = mode === null && positionBeats === 0;
    $('main').classList.toggle('is-playing', mode !== null);
  }

  function play(newMode) {
    if (mode === newMode) { pausePlayback(); return; }
    if (mode) pausePlayback();
    if (positionBeats >= totalBeats()) positionBeats = 0;
    var lp = loopRange();
    if (lp && (positionBeats < lp.start || positionBeats >= lp.end)) positionBeats = lp.start;
    mode = newMode;
    var s = speed();
    if (newMode === 'stem' || newMode === 'both') {
      stem.playbackRate = s;
      setStemTime(stemTimeFor(positionBeats));
      var p = stem.play();
      if (p && p.catch) p.catch(function () { say('The browser blocked audio. Press Play again.'); stopPlayback(); });
    }
    if (newMode === 'tab' || newMode === 'both') {
      api.playbackSpeed = s;
      api.tickPosition = Math.round(positionBeats * TICKS_PER_BEAT);
      lastSynthTick = api.tickPosition;
      lastSynthAt = performance.now();
      api.play();
    }
    say(newMode === 'stem' ? 'Playing the real bass.' : newMode === 'tab' ? 'Playing the tab.' : 'Playing both.');
    updateButtons();
    loop();
  }

  function pausePlayback() {
    if (!mode) return;
    positionBeats = Math.max(0, Math.min(nowBeats(), totalBeats()));
    haltSources();
    mode = null;
    cancelAnimationFrame(rafId);
    drawTracker(false);
    say('Paused at bar ' + (Math.floor(positionBeats / BEATS_PER_BAR) + 1) + '.');
    updateButtons();
  }

  /** Stop everything and go back to the start. Also used when the song ends. */
  function stopPlayback() {
    var wasPlaying = mode !== null;
    haltSources();
    mode = null;
    cancelAnimationFrame(rafId);
    if (!current) return;
    positionBeats = 0;
    lastBarShown = -1;
    drawTracker(false);
    if (wasPlaying) say('Stopped.');
    updateButtons();
  }

  function haltSources() {
    if (!stem.paused) stem.pause();
    if (api) { try { api.pause(); } catch (e) { /* not ready yet */ } }
  }

  /**
   * Repeat and end-of-song. Returns the position to draw, or null if playback just stopped.
   * Called every frame AND from the audio's own progress events, because browsers pause
   * screen frames in background tabs; this way Repeat and stopping still work there.
   */
  function checkBounds() {
    if (!mode) return null;
    var beats = nowBeats();
    var lp = loopRange();
    if (lp && beats >= lp.end) {
      seekTo(lp.start);
      return lp.start;
    }
    if (beats >= totalBeats()) {
      // The last bar has finished: stop both players, reset the cursor and the buttons.
      stopPlayback();
      say('End of the song.');
      return null;
    }
    return beats;
  }

  /** Runs every frame while playing: draws the tracker. */
  function loop() {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(function tick() {
      var beats = checkBounds();
      if (beats === null) return;
      drawTracker(true, Math.max(0, beats - syncMs / 1000 * speed() / secondsPerBeat()));
      rafId = requestAnimationFrame(tick);
    });
  }

  function seekTo(beats) {
    positionBeats = Math.max(0, Math.min(beats, totalBeats() - 0.001));
    if (mode === 'stem' || mode === 'both') setStemTime(stemTimeFor(positionBeats));
    if (mode === 'tab' || mode === 'both') {
      api.tickPosition = Math.round(positionBeats * TICKS_PER_BEAT);
      lastSynthTick = api.tickPosition;
      lastSynthAt = performance.now();
    }
    drawTracker(true, positionBeats);
    updateButtons();
  }

  function setPosition(beats) {
    positionBeats = beats;
    lastBarShown = -1;
  }

  // Repeat: on/off, how many bars, and the first bar (1-based). Players loop a short section over
  // and over, so it's one big button plus bar-count presets in the player, not form fields.
  var repeat = { on: false, bars: 4, start: 1 };

  function loopRange() {
    if (!repeat.on) return null;
    var a = clampBar(repeat.start), b = clampBar(repeat.start + repeat.bars - 1);
    return { start: (a - 1) * BEATS_PER_BAR, end: b * BEATS_PER_BAR };
  }

  function updateRepeat() {
    $('repeat').setAttribute('aria-pressed', String(repeat.on));
    $('repeat').textContent = repeat.on ? 'Repeat on' : 'Repeat';
    $('repeat').parentNode.classList.toggle('on', repeat.on);
    document.querySelectorAll('[data-bars]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(+b.getAttribute('data-bars') === repeat.bars));
    });
    var lp = loopRange();
    var first = lp ? lp.start / BEATS_PER_BAR + 1 : 0, last = lp ? lp.end / BEATS_PER_BAR : 0;
    $('repeat-info').textContent = !lp ? '' : first === last ? 'Bar ' + first : 'Bars ' + first + '\u2013' + last;
    drawLoopMarks();
    if (current) drawTracker(mode !== null);
  }

  function currentBar() { return Math.floor((mode ? nowBeats() : positionBeats) / BEATS_PER_BAR) + 1; }

  $('repeat').addEventListener('click', function () {
    repeat.on = !repeat.on;
    if (repeat.on) repeat.start = clampBar(currentBar());
    updateRepeat();
    say(repeat.on ? 'Repeating ' + $('repeat-info').textContent + '.' : 'Repeat off.');
  });
  document.querySelectorAll('[data-bars]').forEach(function (b) {
    b.addEventListener('click', function () {
      repeat.bars = +b.getAttribute('data-bars');
      if (!repeat.on) { repeat.on = true; repeat.start = clampBar(currentBar()); }
      updateRepeat();
      say('Repeating ' + $('repeat-info').textContent + '.');
    });
  });

  function clampBar(n) { return Math.max(1, Math.min(barCount || 1, isNaN(n) ? 1 : n)); }

  // ---- The tracker: a highlighted bar plus a beat line, drawn over the score ----
  var trackerBar = document.createElement('div');
  trackerBar.className = 'tracker-bar';
  var trackerBeat = document.createElement('div');
  trackerBeat.className = 'tracker-beat';
  var loopMarks = [];

  function bounds() {
    if (!api || !api.renderer) return null;
    return api.renderer.boundsLookup || null;
  }

  function surfaceOffset() {
    // alphaTab draws into a child element; our overlay lives in #score, so add the child's offset.
    var surface = $('score').querySelector('.at-surface');
    if (!surface) return { x: 0, y: 0 };
    return { x: surface.offsetLeft, y: surface.offsetTop };
  }

  function barBounds(barIndex) {
    var lookup = bounds();
    if (!lookup) return null;
    var mb = lookup.findMasterBarByIndex ? lookup.findMasterBarByIndex(barIndex) : null;
    return mb || null;
  }

  /** x position (in score pixels) of a moment inside a bar, using where alphaTab placed the notes. */
  function beatX(mb, tickInBar) {
    var r = mb.realBounds;
    var beats = (mb.bars && mb.bars[0] && mb.bars[0].beats) ? mb.bars[0].beats : [];
    var pts = beats.map(function (bb) {
      return { t: bb.beat.playbackStart, x: bb.onNotesX || (bb.realBounds.x + bb.realBounds.w / 2) };
    }).sort(function (a, b) { return a.t - b.t; });
    if (!pts.length) return r.x + r.w * (tickInBar / (BEATS_PER_BAR * TICKS_PER_BEAT));
    pts.push({ t: BEATS_PER_BAR * TICKS_PER_BEAT, x: r.x + r.w });
    for (var i = 0; i < pts.length - 1; i++) {
      if (tickInBar >= pts[i].t && tickInBar <= pts[i + 1].t) {
        var f = (tickInBar - pts[i].t) / ((pts[i + 1].t - pts[i].t) || 1);
        return pts[i].x + f * (pts[i + 1].x - pts[i].x);
      }
    }
    return pts[0].x;
  }

  function drawTracker(visible, beats) {
    var host = $('score');
    if (trackerBar.parentNode !== host) { host.appendChild(trackerBar); host.appendChild(trackerBeat); }
    if (beats === undefined) beats = positionBeats;
    var show = visible !== false && current && (mode !== null || positionBeats > 0);
    var barIndex = Math.max(0, Math.floor(beats / BEATS_PER_BAR));
    var mb = show && barIndex < barCount ? barBounds(barIndex) : null;
    $('where').textContent = 'Bar ' + Math.min(barIndex + 1, barCount || 1) + ' of ' + (barCount || '?') +
      ' · beat ' + (Math.floor(beats % BEATS_PER_BAR) + 1);
    if (!mb) { trackerBar.hidden = true; trackerBeat.hidden = true; return; }
    var off = surfaceOffset();
    var r = mb.realBounds;
    trackerBar.hidden = false;
    trackerBeat.hidden = false;
    place(trackerBar, off.x + r.x, off.y + r.y, r.w, r.h);
    var tick = (beats - barIndex * BEATS_PER_BAR) * TICKS_PER_BEAT;
    place(trackerBeat, off.x + beatX(mb, tick), off.y + r.y, 3, r.h);
    if (barIndex !== lastBarShown) {
      lastBarShown = barIndex;
      // Look one bar ahead: if it starts a new line, make sure that line is visible too.
      var next = barBounds(barIndex + 1);
      var bottom = r.y + r.h;
      if (next && next.realBounds.y > r.y) bottom = next.realBounds.y + next.realBounds.h;
      keepInView(off.y + r.y, bottom - r.y, barIndex, r.x + off.x);
    }
  }

  function place(el, x, y, w, h) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.width = w + 'px';
    el.style.height = h + 'px';
  }

  /** Scroll the page (and the score box sideways on phones) so the current bar stays visible. */
  function keepInView(yInScore, height, barIndex, xInScore) {
    var rect = $('score').getBoundingClientRect();
    var top = rect.top + yInScore;
    var playerH = document.querySelector('.player').offsetHeight + 16;
    var viewBottom = window.innerHeight - playerH;
    if (top < 60 || top + height > viewBottom) {
      window.scrollTo({ top: window.scrollY + top - Math.max(80, window.innerHeight * 0.2),
                        behavior: reducedMotion ? 'auto' : 'smooth' });
    }
    var wrap = $('score-wrap');
    if (xInScore < wrap.scrollLeft || xInScore > wrap.scrollLeft + wrap.clientWidth - 40) {
      wrap.scrollLeft = Math.max(0, xInScore - 20);
    }
  }

  function drawLoopMarks() {
    loopMarks.forEach(function (m) { m.remove(); });
    loopMarks = [];
    var lp = loopRange();
    if (!lp) return;
    var off = surfaceOffset();
    for (var b = lp.start / BEATS_PER_BAR; b < lp.end / BEATS_PER_BAR; b++) {
      var mb = barBounds(b);
      if (!mb) continue;
      var m = document.createElement('div');
      m.className = 'loop-bar';
      place(m, off.x + mb.realBounds.x, off.y + mb.realBounds.y, mb.realBounds.w, mb.realBounds.h);
      $('score').appendChild(m);
      loopMarks.push(m);
    }
  }

  // ---- Click a bar to jump there ----
  function onScoreClick(e) {
    var lookup = bounds();
    if (!lookup || !current) return;
    var surface = $('score').querySelector('.at-surface');
    if (!surface) return;
    var rect = surface.getBoundingClientRect();
    var beat = lookup.getBeatAtPos(e.clientX - rect.left, e.clientY - rect.top);
    if (!beat) return;
    var barIndex = beat.voice.bar.index;
    if (repeat.on) { repeat.start = barIndex + 1; updateRepeat(); }
    jumpToBar(barIndex + 1);
  }

  function jumpToBar(n) {
    n = clampBar(n);
    var beats = (n - 1) * BEATS_PER_BAR;
    lastBarShown = -1;
    if (mode) seekTo(beats);
    else { positionBeats = beats; drawTracker(true, beats); updateButtons(); }
    say('Bar ' + n + '. Press Play to start here.');
  }

  $('jump-go').addEventListener('click', function () { jumpToBar(parseInt($('jump-bar').value, 10)); });
  $('jump-bar').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); jumpToBar(parseInt($('jump-bar').value, 10)); }
  });

  // ---- Buttons ----
  $('play-main').addEventListener('click', function () { play(hasStem() ? 'stem' : 'tab'); });
  $('play-synth').addEventListener('click', function () { play('tab'); });
  $('play-both').addEventListener('click', function () { play('both'); });
  $('stop').addEventListener('click', function () { stopPlayback(); });

  // Speed: 50% to 150% in 1% steps. Applies to the real bass and the synthesized tab.
  function applySpeed() {
    var s = speed();
    $('speed-out').textContent = Math.round(s * 100) + '%';
    stem.playbackRate = s;
    if ('preservesPitch' in stem) stem.preservesPitch = true;
    else if ('webkitPreservesPitch' in stem) stem.webkitPreservesPitch = true;  // older Safari
    if (api) api.playbackSpeed = s;
  }
  function nudge(d) {
    var v = Math.round((speed() + d) * 100) / 100;
    $('speed').value = Math.min(1.5, Math.max(0.5, v));
    applySpeed();
  }
  $('speed').addEventListener('input', applySpeed);
  $('speed-down').addEventListener('click', function () { nudge(-0.01); });
  $('speed-up').addEventListener('click', function () { nudge(0.01); });

  // Space bar plays/pauses when focus is not in a text field or on a button.
  document.addEventListener('keydown', function (e) {
    if (e.key !== ' ' || $('screen-result').hidden) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea', 'button', 'summary', 'a'].indexOf(tag) !== -1) return;
    e.preventDefault();
    if (!$('play-main').disabled) $('play-main').click();
  });

  window.addEventListener('resize', function () {
    if (current && !$('screen-result').hidden) { drawLoopMarks(); drawTracker(mode !== null); }
  });

  function say(text) { $('status').textContent = text; }

  // Marker timing. Positive = marker later (for headphones/speakers that play the sound late).
  var syncMs = 0;
  try { syncMs = parseInt(localStorage.getItem('traceSyncMs') || '0', 10) || 0; } catch (e) { /* storage blocked */ }
  function setSync(ms) {
    syncMs = Math.max(-500, Math.min(500, ms));
    $('sync-out').textContent = (syncMs > 0 ? '+' : '') + syncMs + ' ms';
    try { localStorage.setItem('traceSyncMs', String(syncMs)); } catch (e) { /* storage blocked */ }
  }
  $('sync-earlier').addEventListener('click', function () { setSync(syncMs - 20); });
  $('sync-later').addEventListener('click', function () { setSync(syncMs + 20); });
  $('sync-reset').addEventListener('click', function () { setSync(0); });
  setSync(syncMs);

  // ------------------------------------------------------------------
  // 6. Key override, print, start-up
  // ------------------------------------------------------------------
  // Same tables as pipeline/arrange.py: key names and how many sharps (+) or flats (-) they have.
  var MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  var MINOR = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
  var MAJOR_ACC = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
  var MINOR_ACC = [-3, 4, -1, -6, 1, -4, 3, -2, 5, 0, -5, 2];

  function prettyName(n) { return n.replace('b', '♭').replace('#', '♯'); }
  function sigText(acc) {
    if (!acc) return 'no sharps or flats';
    var n = Math.abs(acc);
    return n + (acc < 0 ? ' flat' : ' sharp') + (n > 1 ? 's' : '');
  }
  function allKeys() {
    var out = [];
    [['minor', MINOR, MINOR_ACC], ['major', MAJOR, MAJOR_ACC]].forEach(function (m) {
      for (var i = 0; i < 12; i++) {
        out.push({ value: (m[1][i] + m[0]).toLowerCase(), label: prettyName(m[1][i]) + ' ' + m[0], sig: sigText(m[2][i]), mode: m[0] });
      }
    });
    return out;
  }

  function keyLabel(value) {
    var k = allKeys().filter(function (x) { return x.value === value; })[0];
    return k ? k.label : value;
  }

  var detectedKey = null;

  function setupKeySelect(key, detected) {
    if (detected) detectedKey = detected;
    var sel = $('key-select');
    sel.innerHTML = '';
    ['minor', 'major'].forEach(function (mode) {
      var group = document.createElement('optgroup');
      group.label = mode === 'minor' ? 'Minor keys' : 'Major keys';
      allKeys().filter(function (k) { return k.mode === mode; }).forEach(function (k) {
        var o = document.createElement('option');
        o.value = k.value;
        o.textContent = k.label + ' (' + k.sig + ')' + (detectedKey && detectedKey.alphatex === k.value ? ' – detected' : '');
        group.appendChild(o);
      });
      sel.appendChild(group);
    });
    sel.value = key;
    describeKey(key);
  }

  function describeKey(key) {
    var note = $('key-note');
    if (!detectedKey) { note.textContent = ''; return; }
    if (key === detectedKey.alphatex) {
      note.textContent = 'Detected from the notes (' + detectedKey.confidence + ' confidence). Change it if it looks wrong.';
    } else {
      note.textContent = 'You changed this. The detected key was ' + prettyName(detectedKey.name) + '.';
    }
  }

  $('key-select').addEventListener('change', function () {
    var key = $('key-select').value;
    stopPlayback();
    // Swap the key signature in the alphaTex and redraw. alphaTab then writes flats or sharps to match.
    var text = /\\ks\s+\S+/.test(atexText) ? atexText.replace(/\\ks\s+\S+/, '\\ks ' + key)
                                            : atexText.replace(/\\ts 4 4 /, '\\ts 4 4 \\ks ' + key + ' ');
    atexText = text;
    clearScore();
    drawing = true;  // alphaTab only reports "started" a moment later
    api.tex(text);
    describeKey(key);
    say('Key changed to ' + $('key-select').selectedOptions[0].textContent + '.');
  });

  $('print').addEventListener('click', function () {
    stopPlayback();
    window.print();
  });

  $('again').addEventListener('click', function () {
    stopPlayback();
    $('q').value = '';
    $('not-found').hidden = true;
    history.replaceState(null, '', location.pathname);
    show('find');
  });

  // A read-only handle for debugging in the browser console: bassTab.api, bassTab.nowBeats().
  window.bassTab = {
    get api() { return api; },
    get mode() { return mode; },
    nowBeats: function () { return current ? nowBeats() : 0; }
  };

  // Start-up. ?song=<id> opens a song directly (a link you can share); &skip=1 skips the Wait screen.
  showRequestCount();
  loadSongs().then(function () {
    renderSongList();
    var params = new URLSearchParams(location.search);
    var id = params.get('song');
    var song = songs.filter(function (s) { return s.id === id; })[0];
    if (song && params.get('skip')) showResult(song);
    else if (song) startWait(song);
    else show('find');
  });
})();
