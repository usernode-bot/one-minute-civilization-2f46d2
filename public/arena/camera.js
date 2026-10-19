// Camera: world coordinates are separate from screen pixels. The camera
// centre follows a target with damping, looks a little ahead of its motion,
// scales to the screen (so a phone and a desktop show a similar slice of the
// track) and never shows past the edge of the map.
(function (root) {
  var VIEW = 520;   // world units visible along the shorter screen side

  function create() { return { x: 0, y: 0, zoom: 1, w: 300, h: 300, dpr: 1, baseZoom: 1 }; }

  function resize(cam, cssW, cssH, dpr) {
    cam.w = Math.max(1, cssW); cam.h = Math.max(1, cssH); cam.dpr = dpr;
    cam.baseZoom = Math.max(0.3, Math.min(1.7, Math.min(cam.w, cam.h) / VIEW));
  }

  function clampToBounds(cam, bounds) {
    var vw = cam.w / cam.zoom, vh = cam.h / cam.zoom;
    cam.x = vw >= bounds.w ? bounds.x0 + bounds.w / 2 : Math.max(bounds.x0 + vw / 2, Math.min(bounds.x1 - vw / 2, cam.x));
    cam.y = vh >= bounds.h ? bounds.y0 + bounds.h / 2 : Math.max(bounds.y0 + vh / 2, Math.min(bounds.y1 - vh / 2, cam.y));
  }

  // body: { x, y, vx, vy }. `snap` jumps straight to the target.
  function follow(cam, body, bounds, dt, opts) {
    opts = opts || {};
    var speed = Math.hypot(body.vx, body.vy);
    var tx = body.x + body.vx * 0.32, ty = body.y + body.vy * 0.32;
    var k = opts.snap ? 1 : 1 - Math.exp(-dt * (opts.reduced ? 14 : 5.5));
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
    var zt = cam.baseZoom * (1 - Math.min(0.08, speed / 3500));
    cam.zoom += (zt - cam.zoom) * (opts.snap ? 1 : 1 - Math.exp(-dt * 3));
    clampToBounds(cam, bounds);
  }

  // Fit the whole map in view (race preview, thumbnails).
  function fit(cam, bounds, pad) {
    pad = pad || 0;
    cam.zoom = Math.max(cam.w / (bounds.w - pad * 2), cam.h / (bounds.h - pad * 2));
    cam.x = bounds.x0 + bounds.w / 2; cam.y = bounds.y0 + bounds.h / 2;
  }

  function apply(ctx, cam) {
    var s = cam.zoom * cam.dpr;
    ctx.setTransform(s, 0, 0, s, (cam.w / 2 - cam.x * cam.zoom) * cam.dpr, (cam.h / 2 - cam.y * cam.zoom) * cam.dpr);
  }

  function screenToWorld(cam, sx, sy) {
    return { x: cam.x + (sx - cam.w / 2) / cam.zoom, y: cam.y + (sy - cam.h / 2) / cam.zoom };
  }

  root.SnailArena = root.SnailArena || {};
  root.SnailArena.camera = { VIEW: VIEW, create: create, resize: resize, follow: follow, fit: fit, apply: apply, clampToBounds: clampToBounds, screenToWorld: screenToWorld };
})(window);
