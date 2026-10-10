// Leaflet map helpers. Leaflet is loaded as a global (L) from index.html.
// Base tiles come from OpenStreetMap; sw.js caches them as they are viewed (REQ-DATA-3).

const STOP_MIN_ZOOM = 15;

export const LINE_COLORS = [
  '#7b2cbf', '#e85d04', '#0077b6', '#2a9d8f', '#d00000', '#6a994e', '#b5179e', '#495057',
  '#bc6c25', '#3a86ff', '#588157', '#9d0208', '#5f0f40', '#0a9396', '#ca6702', '#414833',
];

// Leaflet can run a queued redraw after a map was removed (when leaving a screen) and then
// throws, because the canvas is gone. Skip the redraw in that case.
let canvasGuarded = false;
function guardCanvasRedraw() {
  if (canvasGuarded) return;
  canvasGuarded = true;
  const redraw = L.Canvas.prototype._redraw;
  L.Canvas.include({
    _redraw() {
      if (!this._ctx) { this._redrawRequest = null; return; }
      redraw.call(this);
    },
  });
}

export function createMap(el, center, zoom = 15) {
  guardCanvasRedraw();
  const map = L.map(el, { preferCanvas: true, zoomControl: false, attributionControl: true }).setView(center, zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    crossOrigin: true, // CORS responses, so sw.js can cache them without quota padding
    attribution: '© OpenStreetMap contributors',
  }).addTo(map);
  L.control.zoom({ position: 'topright' }).addTo(map);
  return map;
}

// Shows bus stops in view (only when zoomed in, to keep it fast) and reports taps.
export function stopLayer(map, city, { onPick, selectedIds = () => [] }) {
  const group = L.layerGroup().addTo(map);
  const refresh = () => {
    group.clearLayers();
    const selected = new Set(selectedIds());
    for (const id of selected) {
      const s = city.stops.get(id);
      if (s) drawStop(s, true);
    }
    if (map.getZoom() < STOP_MIN_ZOOM) return;
    const b = map.getBounds();
    for (const s of city.stopsInBounds(b.getSouth(), b.getWest(), b.getNorth(), b.getEast())) {
      if (!selected.has(s.id)) drawStop(s, false);
    }
  };
  function drawStop(s, selected) {
    const m = L.circleMarker([s.lat, s.lon], {
      radius: selected ? 10 : 7,
      color: selected ? '#ffd60a' : '#3c096c',
      weight: selected ? 4 : 2,
      fillColor: selected ? '#3c096c' : '#ffffff',
      fillOpacity: 1,
    }).addTo(group);
    m.bindTooltip(`${s.name} · ${s.code}`, { direction: 'top' });
    if (onPick) m.on('click', () => onPick(s));
  }
  map.on('moveend', refresh);
  refresh();
  return { refresh, destroy: () => { map.off('moveend', refresh); group.remove(); } };
}

export function userMarker(map) {
  let marker = null;
  return (pos) => {
    if (!pos) return;
    if (!marker) {
      marker = L.circleMarker([pos.lat, pos.lon], {
        radius: 7, color: '#ffffff', weight: 3, fillColor: '#1d4ed8', fillOpacity: 1,
      }).addTo(map).bindTooltip('You are here');
    } else {
      marker.setLatLng([pos.lat, pos.lon]);
    }
  };
}

export function busIcon(label, color, kind) {
  return L.divIcon({
    className: '',
    html: `<div class="bus-marker bus-${kind}" style="--c:${color}">${escapeHtml(label)}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

// Start point = green flag, destination = checkered flag. The pole's foot marks the spot.
// @req REQ-COMM-3
const FLAG_SVG = {
  origin: `<svg viewBox="0 0 32 40" width="32" height="40" aria-hidden="true">
    <rect x="5" y="3" width="3" height="35" rx="1.5" fill="#1b0a2e"/>
    <path d="M8 4h19l-4 7 4 7H8z" fill="#2b9348" stroke="#fff" stroke-width="1.5"/></svg>`,
  destination: `<svg viewBox="0 0 32 40" width="32" height="40" aria-hidden="true">
    <defs><pattern id="kb-checker" width="6" height="6" patternUnits="userSpaceOnUse">
      <rect width="6" height="6" fill="#fff"/><rect width="3" height="3" fill="#111"/><rect x="3" y="3" width="3" height="3" fill="#111"/>
    </pattern></defs>
    <rect x="5" y="3" width="3" height="35" rx="1.5" fill="#1b0a2e"/>
    <rect x="8" y="4" width="20" height="14" fill="url(#kb-checker)" stroke="#111" stroke-width="1.5"/></svg>`,
};

export function flagIcon(kind) {
  return L.divIcon({ className: 'flag-marker', html: FLAG_SVG[kind], iconSize: [32, 40], iconAnchor: [6, 38] });
}

export function flagMarker(map, kind, place) {
  return L.marker([place.lat, place.lon], { icon: flagIcon(kind), zIndexOffset: 2000, keyboard: false })
    .bindTooltip(`${kind === 'origin' ? 'Start' : 'Destination'}: ${place.label}`, { direction: 'top', offset: [8, -36] })
    .addTo(map);
}

export function flagHtml(kind) {
  return FLAG_SVG[kind].replace('width="32" height="40"', 'width="16" height="20"');
}

// Mix a #rrggbb color with white. amount 0..1.
export function lighten(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  const [r, g, b] = [mix(n >> 16), mix((n >> 8) & 255), mix(n & 255)];
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

// The map key in the top-left corner. update(html) replaces its contents.
// @req REQ-COMM-6
export function legendControl(map) {
  let body;
  const Legend = L.Control.extend({
    onAdd() {
      const el = L.DomUtil.create('div', 'map-legend');
      const head = L.DomUtil.create('button', 'legend-head', el);
      head.type = 'button';
      head.textContent = 'Key';
      head.setAttribute('aria-expanded', 'true');
      body = L.DomUtil.create('div', 'legend-body', el);
      head.onclick = () => {
        const open = el.classList.toggle('closed') === false;
        head.setAttribute('aria-expanded', String(open));
      };
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
      return el;
    },
  });
  const control = new Legend({ position: 'topleft' }).addTo(map);
  return {
    update(html) { body.innerHTML = html; control.getContainer().hidden = !html; },
    width() { return control.getContainer().offsetWidth; },
    remove() { control.remove(); },
  };
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
