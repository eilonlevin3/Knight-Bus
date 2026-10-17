// Connection test: run on the phone itself, to find why live data is late there.
// Opened from Options. Docs: docs/user-flows.md#connection-test
// @req REQ-DIAG-1
//
// Each check says OK or what went wrong, in plain words. "Copy the results" puts all of it
// on the clipboard, to paste into a message. Nothing is sent anywhere by this screen
// except the test requests themselves.

import { h, toast } from '../lib/dom.js';
import { t, backArrow, language } from '../i18n.js';
import { build } from '../build.js';
import { realtime } from '../config.js';
import { liveStatus } from '../realtime.js';
import { israelToday } from '../lib/railTimetable.js';
import { track } from '../analytics.js';

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

// One timed request. Returns { ok, ms, status, error, res }.
async function timed(url, options = {}) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { cache: 'no-store', ...options, signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined });
    return { ok: res.ok, ms: performance.now() - t0, status: res.status, res };
  } catch (e) {
    return { ok: false, ms: performance.now() - t0, error: `${e.name}: ${e.message}` };
  }
}

export function render(root, ctx) {
  const list = h('ol', { class: 'diag-list' });
  const lines = []; // the same results as text, for copying
  const add = (ok, title, detail) => {
    lines.push(`${ok === true ? 'OK  ' : ok === false ? 'FAIL' : 'INFO'} ${title}: ${detail}`);
    list.append(h('li', { class: `diag ${ok === true ? 'ok' : ok === false ? 'fail' : 'info'}` },
      h('b', {}, `${ok === true ? '✅' : ok === false ? '❌' : 'ℹ️'} ${title}`), h('small', { class: 'block' }, detail)));
  };
  const copy = h('button', {
    class: 'primary', disabled: true,
    onclick: async () => {
      const text = lines.join('\n');
      try { await navigator.clipboard.writeText(text); toast(t('Copied. Paste it into a message.')); } catch {
        if (navigator.share) navigator.share({ text }).catch(() => {}); else toast(t('Could not copy.'));
      }
    },
  }, t('Copy the results'));

  root.append(h('main', { class: 'screen' },
    h('header', { class: 'topbar sticky-top' },
      h('button', { class: 'nav-button', onclick: () => ctx.go('#/home') }, `${backArrow()} ${t('Home')}`),
      h('h1', {}, t('Connection test'))),
    h('p', { class: 'muted small' }, t('Checks, from this phone, every service the live data comes from. It takes about half a minute.')),
    list,
    copy));

  (async () => {
    // 1. Which app, on what.
    add(null, 'App', `${build.channel} · ${build.commit} · built ${build.builtAt || '?'} · language ${language()}`);
    add(null, 'Phone', `${navigator.userAgent}`);
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
    add(null, 'Opened as', standalone ? 'installed app (home screen icon)' : 'browser tab');
    add(navigator.serviceWorker?.controller ? true : null, 'Offline layer', navigator.serviceWorker?.controller ? 'active' : 'not active');
    add(typeof AbortSignal.timeout === 'function', 'Time limits on requests (AbortSignal.timeout)', typeof AbortSignal.timeout === 'function' ? 'supported' : 'NOT supported: the app cannot ask the relay');
    add(null, 'Live data source set in this version', realtime.relayUrl || 'none (old version?)');
    add(null, 'Last live answer in this session', liveStatus.source ? `${liveStatus.source}${liveStatus.reason ? ` (relay problem: ${liveStatus.reason})` : ''}` : 'none yet (open a stop first)');

    // 2. The clock: positions' ages are counted from it. (The app's own site tells the time.)
    const s = await timed(`./manifest.webmanifest?clock=${Date.now()}`);
    const date = s.res?.headers.get('date');
    if (date) {
      const skew = (Date.now() - Date.parse(date)) / 1000;
      add(Math.abs(skew) < 30, 'Phone clock', Math.abs(skew) < 30 ? `right (${skew.toFixed(0)} s off)` : `${skew.toFixed(0)} s off: live ages will look wrong`);
    }

    // 3. The relay: live buses.
    if (realtime.relayUrl) {
      const r = await timed(`${realtime.relayUrl}/live?routes=23918,24041,27081,10804,2323,2324`);
      if (!r.ok) {
        add(false, 'Relay (live buses)', `${r.error || `HTTP ${r.status}`} after ${seconds(r.ms)}. The app then uses the slow source.`);
      } else {
        let detail = `answered in ${seconds(r.ms)}, ${r.res.headers.get('x-relay') || ''}`;
        try {
          const j = await r.res.json();
          const ages = Object.values(j.routes).flat().map((x) => (Date.now() - Date.parse(x.RecordedAtTime)) / 1000).sort((a, b) => a - b);
          detail += ` · file ${j.snapshot} · ${ages.length} buses` + (ages.length ? `, newest ${Math.round(ages[0])} s old` : ' (none running on these routes now)');
        } catch (e) { detail += ` · answer not readable: ${e.message}`; }
        add(true, 'Relay (live buses)', detail);
      }
      const p = await timed(`${realtime.relayUrl}/rail-board?station=3700&ends=2800,7320&date=${israelToday()}`);
      add(p.ok, 'Relay (train platforms)', p.ok ? `answered in ${seconds(p.ms)}` : `${p.error || `HTTP ${p.status}`} after ${seconds(p.ms)}`);
    }

    // 4. The slow source, used when the relay does not answer.
    const st = await timed('https://open-bus-stride-api.hasadna.org.il/siri_snapshots/list?order_by=id%20desc&limit=20');
    if (!st.ok) add(false, 'Open Bus Stride (the slow source)', `${st.error || `HTTP ${st.status}`} after ${seconds(st.ms)}`);
    else {
      try {
        const rows = await st.res.json();
        const loaded = rows.find((x) => x.etl_status === 'loaded');
        const [y, mo, d, hh, mm] = loaded.snapshot_id.split('/').map(Number);
        const behind = Math.round((Date.now() - Date.UTC(y, mo - 1, d, hh, mm)) / 60000);
        add(behind <= 5, 'Open Bus Stride (the slow source)', `answered in ${seconds(st.ms)} · ${behind} min behind`);
      } catch (e) { add(false, 'Open Bus Stride (the slow source)', `answer not readable: ${e.message}`); }
    }

    // 5. The app's own site and the map.
    const site = await timed(`./data/cities/index.json?test=${Date.now()}`);
    add(site.ok, 'App data (GitHub Pages)', site.ok ? `answered in ${seconds(site.ms)}` : `${site.error || `HTTP ${site.status}`}`);
    const tile = await timed('https://tile.openstreetmap.org/12/2444/1660.png');
    add(tile.ok, 'Map tiles (OpenStreetMap)', tile.ok ? `answered in ${seconds(tile.ms)}` : `${tile.error || `HTTP ${tile.status}`}`);

    add(null, 'Tested at', new Date().toISOString());
    track('connection_test', { relay: lines.some((l) => l.startsWith('OK   Relay (live')) ? 1 : 0 });
    copy.disabled = false;
  })();
}
