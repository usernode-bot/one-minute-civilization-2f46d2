const test = require('node:test');
const assert = require('node:assert');
const W = require('../public/browser-wallet.js');

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);

function fakeEl() {
  const classes = new Set();
  const listeners = {};
  return {
    textContent: '',
    title: '',
    disabled: false,
    set className(v) { classes.clear(); v.split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
    get className() { return [...classes].join(' '); },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    click() { if (listeners.click) listeners.click(); },
  };
}

function fakeSection() {
  const els = {
    '[data-wallet-address]': fakeEl(),
    '[data-wallet-note]': fakeEl(),
    '[data-wallet-connect]': fakeEl(),
    '[data-wallet-disconnect]': fakeEl(),
  };
  const attrs = {};
  return {
    els,
    note: () => els['[data-wallet-note]'].textContent,
    address: () => els['[data-wallet-address]'].title,
    connectBtn: els['[data-wallet-connect]'],
    disconnectBtn: els['[data-wallet-disconnect]'],
    state: () => attrs['data-wallet-state'],
    querySelector: (sel) => els[sel],
    setAttribute: (k, v) => { attrs[k] = v; },
    getAttribute: (k) => attrs[k],
  };
}

// Each request stays open until the test settles it by hand.
function fakeProvider() {
  const pending = [];
  const handlers = {};
  return {
    pending,
    handlers,
    request({ method }) {
      return new Promise((resolve, reject) => pending.push({ method, resolve, reject }));
    },
    on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    emit(type, arg) { (handlers[type] || []).forEach((fn) => fn(arg)); },
    take(method) {
      const i = pending.findIndex((p) => p.method === method);
      assert.ok(i >= 0, 'expected a pending ' + method);
      return pending.splice(i, 1)[0];
    },
  };
}

function memoryStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

function fakeTimers() {
  let next = 1;
  const timers = new Map();
  return {
    setTimeout: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
    fire(ms) {
      for (const [id, t] of [...timers]) if (t.ms === ms) { timers.delete(id); t.fn(); }
    },
  };
}

function fakeWindow() {
  const listeners = {};
  return {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    dispatch(type) { const fn = listeners[type]; delete listeners[type]; if (fn) fn(); },
  };
}

const tick = () => new Promise((r) => setImmediate(r));

function setup({ provider = fakeProvider(), stored } = {}) {
  const section = fakeSection();
  const storage = memoryStorage(stored ? { [W.KEY]: stored } : {});
  const timers = fakeTimers();
  const win = fakeWindow();
  const holder = { provider };
  W.createBrowserWallet({
    section,
    storage,
    win,
    getProvider: () => holder.provider,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  return { section, storage, timers, win, holder, provider };
}

test('a wallet that injects late is found when it announces itself', () => {
  const { section, win, holder } = setup({ provider: null });
  assert.strictEqual(section.state(), 'none');
  assert.strictEqual(section.note(), W.NOTES.NONE);
  const p = fakeProvider();
  holder.provider = p;
  win.dispatch('ethereum#initialized');
  assert.strictEqual(section.state(), 'disconnected');
  assert.strictEqual(section.connectBtn.disabled, false);
  assert.strictEqual(p.handlers.accountsChanged.length, 1);
});

test('a wallet that injects late without announcing is found on the retry', () => {
  const { section, timers, holder, win } = setup({ provider: null });
  const p = fakeProvider();
  holder.provider = p;
  timers.fire(W.LATE_PROVIDER_MS);
  assert.strictEqual(section.state(), 'disconnected');
  win.dispatch('ethereum#initialized');
  assert.strictEqual(p.handlers.accountsChanged.length, 1);
});

test('restore shows checking with Connect disabled, then the remembered address', async () => {
  const { section, provider } = setup({ stored: A });
  assert.strictEqual(section.state(), 'checking');
  assert.strictEqual(section.note(), W.NOTES.CHECKING);
  assert.strictEqual(section.connectBtn.disabled, true);
  assert.strictEqual(section.connectBtn.textContent, 'Checking…');
  section.connectBtn.click();
  assert.ok(!provider.pending.some((p) => p.method === 'eth_requestAccounts'));
  provider.take('eth_accounts').resolve([A.toUpperCase().replace('0X', '0x')]);
  await tick();
  assert.strictEqual(section.state(), 'connected');
  assert.strictEqual(section.address(), A);
});

test('a stale restore answer cannot undo a newer connection', async () => {
  const { section, provider, storage } = setup({ stored: A });
  const check = provider.take('eth_accounts');
  // The wallet switches to B while the silent check is still open.
  provider.emit('accountsChanged', []);
  assert.strictEqual(section.state(), 'disconnected');
  section.connectBtn.click();
  provider.take('eth_requestAccounts').resolve([B]);
  await tick();
  assert.strictEqual(section.state(), 'connected');
  check.resolve([]);
  await tick();
  assert.strictEqual(section.state(), 'connected');
  assert.strictEqual(storage.getItem(W.KEY), B);
});

test('rejections map to cancelled, already-open and cancelled notes', async () => {
  for (const [code, note] of [[4001, W.NOTES.CANCELLED], [-32002, W.NOTES.PENDING], [-32603, W.NOTES.CANCELLED]]) {
    const { section, provider } = setup();
    section.connectBtn.click();
    assert.strictEqual(section.state(), 'connecting');
    provider.take('eth_requestAccounts').reject({ code });
    await tick();
    assert.strictEqual(section.state(), 'disconnected');
    assert.strictEqual(section.note(), note);
    assert.strictEqual(section.connectBtn.disabled, false);
  }
});

test('a wallet that never answers times out and its late answer is ignored', async () => {
  const { section, provider, timers, storage } = setup();
  section.connectBtn.click();
  const req = provider.take('eth_requestAccounts');
  timers.fire(W.CONNECT_TIMEOUT_MS);
  assert.strictEqual(section.state(), 'disconnected');
  assert.strictEqual(section.note(), W.NOTES.TIMEOUT);
  assert.strictEqual(section.connectBtn.disabled, false);
  req.resolve([A]);
  await tick();
  assert.strictEqual(section.state(), 'disconnected');
  assert.strictEqual(storage.getItem(W.KEY), null);
});

test('accountsChanged([]) while connecting is ignored', async () => {
  const { section, provider } = setup();
  section.connectBtn.click();
  provider.emit('accountsChanged', []);
  assert.strictEqual(section.state(), 'connecting');
  provider.take('eth_requestAccounts').resolve([A]);
  await tick();
  assert.strictEqual(section.state(), 'connected');
});

test('disconnect forgets the address and a reload stays disconnected without a prompt', async () => {
  const { section, provider, storage } = setup();
  section.connectBtn.click();
  provider.take('eth_requestAccounts').resolve([A]);
  await tick();
  assert.strictEqual(storage.getItem(W.KEY), A);
  section.disconnectBtn.click();
  assert.strictEqual(section.state(), 'disconnected');
  assert.strictEqual(storage.getItem(W.KEY), null);

  const again = fakeSection();
  const p2 = fakeProvider();
  W.createBrowserWallet({ section: again, storage, win: fakeWindow(), getProvider: () => p2, setTimeout: () => 0, clearTimeout: () => {} });
  assert.strictEqual(again.state(), 'disconnected');
  assert.strictEqual(p2.pending.length, 0);
});

test('switching account while connected moves the card and storage', async () => {
  const { section, provider, storage } = setup();
  section.connectBtn.click();
  provider.take('eth_requestAccounts').resolve([A]);
  await tick();
  provider.emit('accountsChanged', [B]);
  assert.strictEqual(section.state(), 'connected');
  assert.strictEqual(section.address(), B);
  assert.strictEqual(storage.getItem(W.KEY), B);
});

test('after a failed silent check the remembered wallet reconnects when it reappears', async () => {
  const { section, provider, storage } = setup({ stored: A });
  provider.take('eth_accounts').reject(new Error('locked'));
  await tick();
  assert.strictEqual(section.state(), 'disconnected');
  assert.strictEqual(storage.getItem(W.KEY), A);
  provider.emit('accountsChanged', [A]);
  assert.strictEqual(section.state(), 'connected');
});
