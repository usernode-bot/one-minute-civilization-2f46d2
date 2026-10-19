// Game runner: owns the requestAnimationFrame loop, camera, effects and
// audio, and talks to the page only through the hooks it is given. It knows
// nothing about the page's DOM beyond the canvases handed to it, so the UI
// can be rebuilt without touching the render loop.
(function (root) {
  var A = root.SnailArena;
  var maps = A.maps, race = A.race, camera = A.camera, effects = A.effects, render = A.render, audio = A.audio;

  function reducedByDevice() {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  // hooks: { hud(data), count(label|null), toast(text), finished(results, info) }
  function create(canvas, input, hooks) {
    var view = render.create(canvas);
    var fx = effects.create();
    var g = {
      cfg: null, race: null, track: null, raf: 0, last: 0, running: false, paused: false, time: 0,
      overAt: 0, overSent: false, hudAt: 0, slow: 0, frames: 0, reduced: false, ro: null, destroyed: false
    };

    function player() { return g.race && g.race.playerIndex >= 0 ? g.race.racers[g.race.playerIndex] : null; }

    function size() {
      var r = canvas.getBoundingClientRect();
      render.resizeView(view, r.width, r.height);
    }

    function hud() {
      var p = player(), rc = g.race;
      if (!p || !rc) return;
      hooks.hud({
        lap: Math.min(rc.laps, p.lapsDone + 1), laps: rc.laps, place: race.position(rc, p), total: rc.racers.length,
        time: rc.t, cp: Math.max(0, p.cpPassed) % maps.CHECKPOINTS, cpTotal: maps.CHECKPOINTS,
        progress: Math.max(0, Math.min(1, p.max / (rc.laps * rc.track.L))),
        speed: Math.hypot(p.body.vx, p.body.vy), energy: p.body.energy, boosting: p.body.boosting, exhausted: p.body.exhausted,
        terrain: p.body.terrain && p.body.terrain.kind, finished: p.finished
      });
    }

    function handleEvents() {
      var evs = race.drainEvents(g.race), p = player(), tr = g.track;
      for (var i = 0; i < evs.length; i++) {
        var e = evs[i], mine = e.racer && e.racer.isPlayer;
        if (e.type === 'count') { audio.count(); hooks.count(String(e.n)); }
        else if (e.type === 'go') { audio.go(); hooks.count('GO!'); setTimeout(function () { if (!g.destroyed) hooks.count(null); }, 700); }
        else if (e.type === 'checkpoint' && mine) {
          var gate = tr.checkpoints[e.n];
          effects.ring(fx, gate.x, gate.y, tr.theme.accent, 46); audio.checkpoint();
          hooks.toast('Checkpoint ' + e.n + ' / ' + e.total);
        } else if (e.type === 'lap' && mine) {
          fx.flash = 0.5; audio.lap(); effects.ring(fx, tr.start.x, tr.start.y, '#ffffff', 60);
          hooks.toast('Lap ' + e.lap + ' / ' + g.race.laps + ' done');
        } else if (e.type === 'boostpad' && mine) {
          effects.burst(fx, e.racer.body.x, e.racer.body.y, '#ffe27a', 12, 200); audio.boost();
        } else if (e.type === 'bump') {
          if (mine || (p && Math.hypot(e.x - p.body.x, e.y - p.body.y) < 320)) effects.bump(fx, e.x, e.y, mine ? e.impact : e.impact * 0.4);
          if (mine) audio.bump();
        } else if (e.type === 'finish' && mine) {
          effects.confetti(fx, e.racer.body.x, e.racer.body.y); audio.finish(e.place <= 3);
          hooks.toast(e.place === 1 ? 'You win!' : 'Finished');
        } else if (e.type === 'raceover') {
          g.overAt = g.race.clock + 1.6;
        }
      }
    }

    function frame(ts) {
      if (!g.running || g.paused) return;
      g.raf = requestAnimationFrame(frame);
      var dt = (ts - g.last) / 1000; g.last = ts;
      if (!(dt > 0)) return;
      if (dt > 0.1) dt = 0.1;
      // adaptive quality: drop resolution if frames stay slow
      g.frames++;
      g.slow = g.slow * 0.95 + dt * 0.05;
      if (g.frames > 90 && g.slow > 0.026 && view.maxDpr > 1) { view.maxDpr = 1; size(); }
      step(dt);
    }

    function step(dt) {
      var rc = g.race; if (!rc) return;
      g.time += dt;
      race.step(rc, dt, rc.phase === 'racing' ? input.read() : null);
      handleEvents();
      var p = player();
      if (p) {
        camera.follow(view.cam, p.body, g.track.bounds, dt, { reduced: g.reduced });
        var i, r, sp;
        for (i = 0; i < rc.racers.length; i++) {
          r = rc.racers[i]; sp = Math.hypot(r.body.vx, r.body.vy);
          if (sp > 50 && Math.abs(r.body.x - view.cam.x) < view.cam.w / view.cam.zoom && Math.abs(r.body.y - view.cam.y) < view.cam.h / view.cam.zoom) {
            effects.dust(fx, r.body.x, r.body.y, r.body.vx, r.body.vy, r.body.terrain && r.body.terrain.kind, dt * (r.isPlayer ? 14 : 5) * Math.min(1.5, sp / 200));
          }
        }
      }
      effects.update(fx, dt);
      effects.ambient(fx, view.cam, g.track.id, dt);
      draw();
      g.hudAt -= dt;
      if (g.hudAt <= 0) { g.hudAt = 0.1; hud(); }
      if (rc.phase === 'finished' && !g.overSent && rc.clock >= g.overAt && g.overAt > 0) {
        g.overSent = true;
        hud();
        hooks.finished(race.results(rc), { track: g.track, laps: rc.laps });
      }
    }

    function draw() {
      render.drawFrame(view, { race: g.race, fx: fx, time: g.time, focus: player(), reducedMotion: g.reduced });
    }

    function loop() {
      cancelAnimationFrame(g.raf);
      g.last = performance.now();
      g.raf = requestAnimationFrame(frame);
    }

    var api = {
      get race() { return g.race; },
      get paused() { return g.paused; },
      get running() { return g.running; },

      start: function (cfg) {
        g.cfg = cfg;
        g.track = maps.getTrack(cfg.mapId);
        g.reduced = !!cfg.reduced || reducedByDevice();
        fx.reduced = g.reduced;
        effects.clear(fx);
        audio.setEnabled(cfg.sound !== false);
        g.race = race.createRace({ track: g.track, laps: cfg.laps, difficulty: cfg.difficulty, playerId: cfg.snailId, seed: cfg.seed || (Date.now() % 997) });
        g.time = 0; g.overAt = 0; g.overSent = false; g.paused = false; g.running = true; g.hudAt = 0; g.frames = 0; g.slow = 0;
        size();
        camera.follow(view.cam, player().body, g.track.bounds, 0.016, { snap: true });
        hooks.count(null);
        input.clear();
        hud(); draw();
        loop();
      },
      restart: function () { if (g.cfg) { api.stop(true); api.start(g.cfg); } },
      pause: function () {
        if (!g.running || g.paused || (g.race && g.race.phase === 'finished')) return false;
        g.paused = true; cancelAnimationFrame(g.raf); input.clear(); return true;
      },
      resume: function () { if (g.running && g.paused) { g.paused = false; loop(); } },
      // keep the last frame on screen, stop stepping
      stop: function (keepRace) {
        g.running = false; g.paused = false; cancelAnimationFrame(g.raf);
        hooks.count(null);
        if (!keepRace) { g.race = null; }
        effects.clear(fx);
      },
      resize: function () { size(); if (g.race && (g.paused || !g.running)) draw(); },
      redraw: function () { if (g.race) draw(); },
      updateOptions: function (o) {
        if (o.reduced !== undefined) { g.reduced = !!o.reduced || reducedByDevice(); fx.reduced = g.reduced; }
        if (o.sound !== undefined) audio.setEnabled(o.sound);
      },
      destroy: function () {
        g.destroyed = true; api.stop(); render.releaseStatic();
      }
    };
    return api;
  }

  // The race preview: the real renderer drawing the grid, whole map in view.
  function createPreview(canvas) {
    var view = render.create(canvas), cur = null;
    function draw() {
      if (!cur) return;
      var r = canvas.getBoundingClientRect();
      if (!r.width) return;
      render.resizeView(view, r.width, r.height);
      camera.fit(view.cam, cur.track.bounds, 150);
      render.drawFrame(view, { race: cur, fx: null, time: 0, focus: null, reducedMotion: true });
    }
    return {
      set: function (cfg) {
        cur = race.createRace({ track: maps.getTrack(cfg.mapId), laps: cfg.laps, difficulty: cfg.difficulty, playerId: cfg.snailId, seed: 1 });
        draw();
      },
      draw: draw,
      destroy: function () { cur = null; }
    };
  }

  A.game = { create: create, createPreview: createPreview, reducedByDevice: reducedByDevice };
})(window);
