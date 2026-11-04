/* TRACE (Transcribe, Read, And Check by Ear) - page logic.
 *
 * Plain JavaScript, no build step. Sections:
 *   1. Songs list (manifest)          4. Result: score drawing (alphaTab)
 *   2. Screen switching + progress     5. Playback: one clock, one tracker
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
    songs.forEach(function (s) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'song-card';
      b.innerHTML = '<strong></strong><span></span>';
      b.querySelector('strong').textContent = s.title;
      b.querySelector('span').textContent = (s.artist ? s.artist + ' · ' : '') + s.bars + ' bars';
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
  // 2. Screens and the 5-step progress strip
  // ------------------------------------------------------------------
  var STEP_ORDER = ['find', 'wait', 'see', 'hear', 'take'];

  function setProgress(current) {
    var idx = STEP_ORDER.indexOf(current);
    document.querySelectorAll('#steps li').forEach(function (li) {
      var i = STEP_ORDER.indexOf(li.getAttribute('data-step'));
      li.classList.toggle('done', i < idx);
      li.classList.toggle('current', i === idx);
      if (i === idx) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
  }

  function show(name) {
    ['find', 'wait', 'result'].forEach(function (k) { $('screen-' + k).hidden = (k !== name); });
    setProgress(name === 'result' ? 'see' : name);
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
  $('request-btn').addEventListener('click', function () {
    var list = getRequests();
    list.push({ query: lastQuery, at: new Date().toISOString() });
    try { localStorage.setItem('songRequests', JSON.stringify(list)); } catch (e) { /* storage blocked */ }
    $('request-msg').textContent = 'Thanks, we’ve noted it. You have asked for ' + list.length +
      ' song' + (list.length === 1 ? '' : 's') + ' so far.';
    $('download-requests').hidden = false;
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
    var names = ['Getting the song', 'Separating the bass', 'Finding the notes', 'Writing the tab'];
    var build = loadJson(song.build).catch(function () { return null; });
    build.then(function (b) {
      var items = names.map(function (name, i) {
        var step = b && b.steps && b.steps[i];
        // Real timings come from build.json, written by pipeline/build_song.py. Steps done
        // outside that script (e.g. separating the bass in StemKit) were not timed, and we say so.
        var note = 'done earlier (not timed)';
        if (step && step.seconds != null) note = 'took ' + formatSeconds(step.seconds);
        var li = document.createElement('li');
        li.innerHTML = '<span class="dot" aria-hidden="true"></span><span class="name"></span><span class="time"></span>';
        li.querySelector('.name').textContent = name;
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
      waitTimer = setInterval(step, reducedMotion ? 150 : 700);
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
    $('song-meta').textContent = 'Bass · ' + Math.round(song.bpm) + ' beats per minute · ' + song.bars + ' bars';
    $('jump-bar').max = song.bars;
    $('loop-from').max = song.bars;
    $('loop-to').max = song.bars;
    setPosition(0);
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
    setProgress('hear');
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

  /** Runs every frame while playing: end of song, looping, tracker. */
  function loop() {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(function tick() {
      if (!mode) return;
      var beats = nowBeats();
      var lp = loopRange();
      if (lp && beats >= lp.end) {
        seekTo(lp.start);
        beats = lp.start;
      } else if (beats >= totalBeats()) {
        // The last bar has finished: stop both players, reset the cursor and the buttons.
        stopPlayback();
        say('End of the song.');
        return;
      }
      drawTracker(true, beats);
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

  function loopRange() {
    if (!$('loop-on').checked) return null;
    var a = clampBar(parseInt($('loop-from').value, 10));
    var b = clampBar(parseInt($('loop-to').value, 10));
    if (b < a) { var t = a; a = b; b = t; }
    return { start: (a - 1) * BEATS_PER_BAR, end: b * BEATS_PER_BAR };
  }

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
    drawLoopMarks();
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
      keepInView(off.y + r.y, r.h, barIndex, r.x + off.x);
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
  $('loop-on').addEventListener('change', function () {
    if ($('loop-on').checked) {
      var bar = Math.floor(positionBeats / BEATS_PER_BAR) + 1;
      $('loop-from').value = clampBar(bar);
      $('loop-to').value = clampBar(bar + 3);
      say('Repeating bars ' + $('loop-from').value + ' to ' + $('loop-to').value + '.');
    }
    drawTracker(true);
  });
  ['loop-from', 'loop-to'].forEach(function (id) { $(id).addEventListener('change', function () { drawTracker(true); }); });

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

  window.addEventListener('resize', function () { if (current && !$('screen-result').hidden) drawTracker(mode !== null); });

  function say(text) { $('status').textContent = text; }

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
    setProgress('take');
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
  if (getRequests().length) $('download-requests').hidden = false;
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
