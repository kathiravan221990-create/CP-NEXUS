/* CP NEXUS notifications: in-app bell + phone alerts (web push). Loaded by REQ and ENG. */
(function () {
  if (window.NXN) return;
  var BASE = new URL('./', document.currentScript ? document.currentScript.src : location.href).href; // /CP-NEXUS/
  var st = { tok: '', unread: 0, rows: [], open: false, perm: null, subbed: false, vapid: '' };
  var iosNeedsInstall = /iPhone|iPad|iPod/i.test(navigator.userAgent) && !(window.navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches));
  var pushOk = ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);

  function cfg() {
    try { return { url: SUPABASE_URL, key: SUPABASE_KEY }; } catch (e) { return null; }
  }
  function token() { try { return NEXUS_TOKEN || ''; } catch (e) { return ''; } }
  async function rpc(fn, args) {
    var c = cfg(); if (!c) throw new Error('no config');
    var r = await fetch(c.url.replace(/\/$/, '') + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: c.key, Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {})
    });
    var t = await r.text(); if (!r.ok) throw new Error(t || r.status);
    return t ? JSON.parse(t) : null;
  }
  function b64u(s) { s = (s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'); var raw = atob(s), a = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) a[i] = raw.charCodeAt(i); return a; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ago(d) { var s = (Date.now() - new Date(d).getTime()) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago'; return Math.floor(s / 86400) + ' d ago'; }

  /* ---------- UI ---------- */
  var css = document.createElement('style');
  css.textContent =
    '#nxn-bell{position:fixed;right:16px;bottom:16px;z-index:99990;width:50px;height:50px;border-radius:50%;border:2px solid #f0c75a;background:linear-gradient(180deg,#14305f,#0a1a38);color:#f0c75a;font-size:22px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;padding:0}' +
    '#nxn-bell b{position:absolute;top:-6px;right:-6px;min-width:20px;height:20px;border-radius:10px;background:#ff5d5d;color:#fff;font:700 11px/20px Arial,sans-serif;padding:0 5px;text-align:center;display:none}' +
    '#nxn-panel{position:fixed;right:16px;bottom:76px;z-index:99991;width:340px;max-width:calc(100vw - 24px);max-height:70vh;display:none;flex-direction:column;background:#0a1a38;border:1px solid #f0c75a;border-radius:12px;box-shadow:0 10px 36px rgba(0,0,0,.55);color:#e8eefc;font:13px Arial,sans-serif;overflow:hidden}' +
    '#nxn-panel header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(240,199,90,.35);font-weight:700;color:#f0c75a}' +
    '#nxn-panel header span{flex:1}#nxn-panel header button{background:none;border:0;color:#9fc3ff;cursor:pointer;font-size:12px}' +
    '#nxn-setup{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);font-size:12px;color:#b9c7e6}' +
    '#nxn-setup button{margin:6px 6px 0 0;background:#f0c75a;color:#1b1400;border:0;border-radius:6px;padding:7px 11px;font-weight:700;cursor:pointer}' +
    '#nxn-setup button.g{background:transparent;color:#9fc3ff;border:1px solid #3a5a96}' +
    '#nxn-list{overflow:auto;flex:1}#nxn-list .it{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.07)}' +
    '#nxn-list .it.u{background:rgba(240,199,90,.10);border-left:3px solid #f0c75a}#nxn-list .t{font-weight:700;color:#fff}#nxn-list .b{color:#b9c7e6;margin-top:2px}#nxn-list .w{color:#7f93bd;font-size:11px;margin-top:3px}' +
    '#nxn-list .e{padding:22px;text-align:center;color:#7f93bd}';
  document.head.appendChild(css);
  var bell = document.createElement('button'); bell.id = 'nxn-bell'; bell.title = 'Notifications'; bell.innerHTML = '&#128276;<b id="nxn-cnt"></b>';
  var panel = document.createElement('div'); panel.id = 'nxn-panel';
  panel.innerHTML = '<header><span>Notifications</span><button id="nxn-all">Mark all read</button><button id="nxn-x">&#10005;</button></header><div id="nxn-setup"></div><div id="nxn-list"></div>';
  document.body.appendChild(bell); document.body.appendChild(panel);
  bell.onclick = function () { st.open = !st.open; panel.style.display = st.open ? 'flex' : 'none'; if (st.open) { refresh(); } };
  panel.querySelector('#nxn-x').onclick = function () { st.open = false; panel.style.display = 'none'; };
  panel.querySelector('#nxn-all').onclick = async function () { try { await rpc('notif_read', { p_token: st.tok }); } catch (e) {} refresh(); };

  function draw() {
    var cnt = document.getElementById('nxn-cnt'); cnt.style.display = st.unread ? 'block' : 'none'; cnt.textContent = st.unread > 99 ? '99+' : st.unread;
    var L = document.getElementById('nxn-list');
    L.innerHTML = st.rows.length ? st.rows.map(function (n) { return '<div class="it' + (n.read_at ? '' : ' u') + '"><div class="t">' + esc(n.title) + '</div><div class="b">' + esc(n.body) + '</div><div class="w">' + esc(n.app || '') + ' &middot; ' + ago(n.created_at) + '</div></div>'; }).join('') : '<div class="e">No notifications yet.</div>';
    var S = document.getElementById('nxn-setup'), h = '';
    if (!pushOk) h = iosNeedsInstall ? 'To get phone alerts on iPhone: open CP NEXUS in Safari, tap Share, choose <b>Add to Home Screen</b>, then open it from the Home Screen and turn alerts on here.' : 'Phone alerts are not supported in this browser. The bell still works while the portal is open.';
    else if (iosNeedsInstall) h = 'On iPhone, add CP NEXUS to the Home Screen (Share &rarr; Add to Home Screen), open it from there, then turn alerts on here.';
    else if (st.perm === 'denied') h = 'Phone alerts are blocked for this site. Allow notifications in the browser site settings, then reopen this panel.';
    else if (st.perm === 'granted' && st.subbed) h = 'Phone alerts: <b>On</b> for this device. They stay on screen until you swipe them away.<br><button class="g" id="nxn-test">Send test alert</button><button class="g" id="nxn-off">Turn off</button>';
    else h = 'Get alerts on this phone even when the portal is closed.<br><button id="nxn-on">Turn on phone alerts</button>';
    S.innerHTML = h;
    var on = document.getElementById('nxn-on'); if (on) on.onclick = enable;
    var te = document.getElementById('nxn-test'); if (te) te.onclick = testAlert;
    var of = document.getElementById('nxn-off'); if (of) of.onclick = disable;
  }

  /* ---------- data ---------- */
  async function refresh() {
    if (!st.tok) return;
    try {
      var r = await rpc('notif_list', { p_token: st.tok, p_limit: 40 });
      if (r && r.ok) { st.unread = r.unread || 0; st.rows = r.rows || []; draw(); if (st.open && st.unread) { await rpc('notif_read', { p_token: st.tok }); setTimeout(function () { st.unread = 0; draw(); }, 1500); } }
    } catch (e) {}
  }
  async function reg() {
    if (!pushOk) return null;
    try { return await navigator.serviceWorker.register(BASE + 'sw.js', { scope: BASE }); } catch (e) { return null; }
  }
  async function currentSub() {
    var r = await reg(); if (!r) return null; var rr = await navigator.serviceWorker.ready; return rr.pushManager.getSubscription();
  }
  async function saveSub(sub) {
    var j = sub.toJSON();
    var r = await rpc('push_subscribe', { p_token: st.tok, p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent });
    return r && r.ok;
  }
  async function enable() {
    try {
      if (!pushOk) return;
      var p = await Notification.requestPermission(); st.perm = p;
      if (p !== 'granted') { draw(); return; }
      if (!st.vapid) st.vapid = await rpc('push_pubkey', {});
      await reg(); var rr = await navigator.serviceWorker.ready;
      var sub = await rr.pushManager.getSubscription();
      if (!sub) sub = await rr.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(st.vapid) });
      st.subbed = await saveSub(sub); draw();
    } catch (e) { var S = document.getElementById('nxn-setup'); if (S) S.insertAdjacentHTML('beforeend', '<div style="color:#ff9b9b;margin-top:6px">Could not turn on alerts: ' + esc(e.message || e) + '</div>'); }
  }
  async function disable() {
    try { var s = await currentSub(); if (s) { await rpc('push_unsubscribe', { p_token: st.tok, p_endpoint: s.endpoint }); await s.unsubscribe(); } st.subbed = false; draw(); } catch (e) {}
  }
  async function testAlert() {
    try { var rr = await navigator.serviceWorker.ready; await rr.showNotification('CP NEXUS test alert', { body: 'This alert stays until you swipe it away.', icon: BASE + 'icon-192.png', badge: BASE + 'icon-192.png', tag: 'nx-test', requireInteraction: true, vibrate: [200, 100, 200] }); } catch (e) {}
  }
  async function init() {
    st.perm = pushOk ? Notification.permission : null;
    if (pushOk) { await reg(); try { var s = await currentSub(); st.subbed = !!s; if (s && st.perm === 'granted') { await saveSub(s); } } catch (e) {} }
    draw(); refresh();
  }

  /* ---------- follow the portal's sign-in ---------- */
  setInterval(function () {
    var t = token();
    if (t !== st.tok) {
      st.tok = t;
      if (t) { bell.style.display = 'flex'; init(); }
      else { bell.style.display = 'none'; panel.style.display = 'none'; st.open = false; st.rows = []; st.unread = 0; }
    }
  }, 1500);
  setInterval(function () { if (st.tok && !document.hidden) refresh(); }, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && st.tok) refresh(); });
  window.NXN = { refresh: refresh, enable: enable };
})();
