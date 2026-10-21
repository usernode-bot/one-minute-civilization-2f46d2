// Browser wallet card: display-only. Talks to the wallet provider the
// browser already has (window.ethereum) and localStorage; never sends the
// address to the server. Identity, $NAIL and the leaderboard stay on the
// HomeRoom wallet.
//
// States: checking (page load / silent restore), none (no wallet in this
// browser), disconnected, connecting, connected. Every action bumps `seq`;
// a wallet answer only applies if no newer action has happened since, so a
// late answer can never undo a newer one.
(function () {
  var KEY = 'snailDerby.browserWallet';
  var CONNECT_TIMEOUT_MS = 60000;
  var LATE_PROVIDER_MS = 3000;

  var NOTE_OPTIONAL = 'Optional. Shown here only: your $NAIL and leaderboard place stay on your HomeRoom wallet.';
  var NOTE_ONLY = 'Shown here only: your $NAIL and leaderboard place stay on your HomeRoom wallet.';
  var NOTE_NONE = 'No browser wallet found in this browser.';
  var NOTE_CANCELLED = 'Connection cancelled.';
  var NOTE_PENDING = 'Your wallet already has a request open. Open your wallet to finish connecting.';
  var NOTE_TIMEOUT = 'Your wallet didn\'t answer. Try again.';
  var NOTE_CHECKING = 'Checking your wallet…';

  var CONNECT_CLASS = 'shrink-0 h-9 px-3 rounded-lg text-sm font-semibold transition-colors bg-violet-600 text-white hover:bg-violet-500 active:bg-violet-700 disabled:bg-zinc-800 disabled:text-zinc-500 whitespace-nowrap';

  // Same rule the header's truncate() uses for the HomeRoom wallet.
  function truncate(addr) {
    return addr.length > 12 ? addr.slice(0, 6) + '…' + addr.slice(-4) : addr;
  }

  function valid(addr) {
    return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr);
  }

  function same(a, b) {
    return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
  }

  function createBrowserWallet(opts) {
    var win = opts.win || window;
    var section = opts.section;
    // Optional: told every new state, e.g. so the header can show it.
    var onState = typeof opts.onState === 'function' ? opts.onState : null;
    var setTimer = opts.setTimeout || function (fn, ms) { return setTimeout(fn, ms); };
    var clearTimer = opts.clearTimeout || function (t) { clearTimeout(t); };
    var getProvider = opts.getProvider || function () {
      var e = win.ethereum;
      return e && typeof e.request === 'function' ? e : null;
    };
    // localStorage itself can throw in sandboxed frames, so look it up lazily.
    function storage() {
      if (opts.storage) return opts.storage;
      try { return win.localStorage; } catch (_) { return null; }
    }

    var addrEl = section.querySelector('[data-wallet-address]');
    var noteEl = section.querySelector('[data-wallet-note]');
    var connectBtn = section.querySelector('[data-wallet-connect]');
    var disconnectBtn = section.querySelector('[data-wallet-disconnect]');

    var state = null;
    var seq = 0;
    var listening = false;

    function read() {
      try { return storage().getItem(KEY); } catch (_) { return null; }
    }

    function save(addr) {
      try { storage().setItem(KEY, addr); } catch (_) {}
    }

    function forget() {
      try { storage().removeItem(KEY); } catch (_) {}
    }

    // Some providers throw instead of rejecting; treat both the same.
    function ask(provider, method) {
      try {
        return Promise.resolve(provider.request({ method: method }));
      } catch (err) {
        return Promise.reject(err);
      }
    }

    function render(next, addr, note) {
      state = next;
      section.setAttribute('data-wallet-state', next);
      var connected = next === 'connected';
      if (connected) {
        addrEl.textContent = truncate(addr);
        addrEl.title = addr;
        addrEl.classList.remove('hidden');
      } else {
        addrEl.classList.add('hidden');
      }
      noteEl.textContent = note || '';
      connectBtn.className = CONNECT_CLASS;
      connectBtn.textContent = next === 'connecting' ? 'Connecting…'
        : next === 'checking' ? 'Checking…' : 'Connect wallet';
      connectBtn.disabled = next === 'connecting' || next === 'checking' || next === 'none';
      // Connected shows only Disconnect; no wallet shows no button at all.
      connectBtn.classList.toggle('hidden', next === 'none' || connected);
      disconnectBtn.classList.toggle('hidden', !connected);
      if (onState) onState(next);
    }

    function disconnected(note) {
      render('disconnected', null, note || NOTE_OPTIONAL);
    }

    function connect() {
      var provider = getProvider();
      if (!provider || state === 'connecting' || state === 'checking') return;
      var mine = ++seq;
      render('connecting', null, '');
      // A wallet that never answers would leave the card on Connecting…
      var timer = setTimer(function () {
        if (mine !== seq) return;
        seq++;
        disconnected(NOTE_TIMEOUT);
      }, CONNECT_TIMEOUT_MS);
      ask(provider, 'eth_requestAccounts').then(function (accounts) {
        clearTimer(timer);
        if (mine !== seq) return;
        var addr = accounts && accounts[0];
        if (!valid(addr)) {
          disconnected(NOTE_CANCELLED);
          return;
        }
        save(addr);
        render('connected', addr, NOTE_ONLY);
      }, function (err) {
        clearTimer(timer);
        if (mine !== seq) return;
        // No console.error, so the "no console errors" check stays clean.
        // -32002: the wallet already has a connect request open.
        disconnected(err && err.code === -32002 ? NOTE_PENDING : NOTE_CANCELLED);
      });
    }

    function disconnect() {
      seq++;
      forget();
      disconnected();
    }

    // Switching accounts in the wallet moves the card with it; the wallet
    // dropping the site goes back to Connect wallet. While a connect request
    // is open, its own answer decides.
    function onAccountsChanged(accounts) {
      if (state === 'connecting') return;
      var first = accounts && accounts[0];
      if (!valid(first)) {
        seq++;
        forget();
        disconnected();
        return;
      }
      if (state === 'connected') {
        seq++;
        save(first);
        render('connected', first, NOTE_ONLY);
      } else if (same(first, read())) {
        // The remembered wallet is back (e.g. after a failed silent check).
        seq++;
        render('connected', first, NOTE_ONLY);
      }
    }

    function listen(provider) {
      if (listening || typeof provider.on !== 'function') return;
      listening = true;
      provider.on('accountsChanged', onAccountsChanged);
    }

    // Silent check: no prompt. If the wallet no longer holds the address,
    // forget it; if the check itself fails, keep it.
    function restore(provider) {
      var remembered = read();
      if (!remembered || !valid(remembered)) {
        disconnected();
        return;
      }
      var mine = ++seq;
      render('checking', null, NOTE_CHECKING);
      ask(provider, 'eth_accounts').then(function (accounts) {
        if (mine !== seq) return;
        var has = accounts && accounts.some(function (a) { return same(a, remembered); });
        if (has) render('connected', remembered, NOTE_ONLY);
        else { forget(); disconnected(); }
      }, function () {
        if (mine !== seq) return;
        disconnected();
      });
    }

    function start(provider) {
      listen(provider);
      restore(provider);
    }

    // Some wallets inject after the page loads: look again when they say so,
    // and once more a moment later for those that don't.
    function watchForLateProvider() {
      function retry() {
        if (state !== 'none') return;
        var provider = getProvider();
        if (provider) start(provider);
      }
      if (typeof win.addEventListener === 'function') {
        win.addEventListener('ethereum#initialized', retry, { once: true });
      }
      setTimer(retry, LATE_PROVIDER_MS);
    }

    connectBtn.addEventListener('click', connect);
    disconnectBtn.addEventListener('click', disconnect);

    var provider = getProvider();
    if (provider) {
      start(provider);
    } else {
      // Leave storage alone; the card just says there is no wallet here.
      render('none', null, NOTE_NONE);
      watchForLateProvider();
    }

    return {
      state: function () { return state; }
    };
  }

  var api = {
    KEY: KEY,
    CONNECT_TIMEOUT_MS: CONNECT_TIMEOUT_MS,
    LATE_PROVIDER_MS: LATE_PROVIDER_MS,
    NOTES: {
      OPTIONAL: NOTE_OPTIONAL,
      ONLY: NOTE_ONLY,
      NONE: NOTE_NONE,
      CANCELLED: NOTE_CANCELLED,
      PENDING: NOTE_PENDING,
      TIMEOUT: NOTE_TIMEOUT,
      CHECKING: NOTE_CHECKING
    },
    createBrowserWallet: createBrowserWallet
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.snailDerbyBrowserWallet = api;
})();
