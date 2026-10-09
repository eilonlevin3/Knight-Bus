// Leaflet map helpers. Leaflet is loaded as a global (L) from index.html.
// Base tiles come from OpenStreetMap; sw.js caches them as they are viewed (REQ-DATA-3).

const STOP_MIN_ZOOM = 15;

export const LINE_COLORS = ['#7b2cbf', '#e85d04', '#0077b6', '#2a9d8f', '#d00000', '#6a994e', '#b5179e', '#495057'];

export function createMap(el, center, zoom = 15) {
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

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
