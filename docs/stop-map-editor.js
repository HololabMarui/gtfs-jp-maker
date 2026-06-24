// stop-map-editor.js
(function initStopMapEditor() {
  let map = null;
  let markers = {};
  let routeLine = null;
  let selectedStopId = null;
  let filterNoCoord = false;
  let kmlLayer = null;
  let kmlVisible = true;

  function getStops() { return window.makerData && window.makerData.stops || []; }

  function hasValidCoord(stop) {
    const lat = parseFloat(stop.stop_lat);
    const lon = parseFloat(stop.stop_lon);
    return !isNaN(lat) && !isNaN(lon) && Math.abs(lat) > 0.0001 && Math.abs(lon) > 0.0001
      && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  function initMap() {
    if (map) { map.invalidateSize(); return; }
    map = L.map('stop-map').setView([35.681236, 139.767125], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    map.on('click', onMapClick);
  }

  function render() {
    if (!map) initMap();
    const stops = getStops();

    Object.values(markers).forEach(m => map.removeLayer(m));
    markers = {};

    const validLatLngs = [];
    stops.forEach(stop => {
      if (hasValidCoord(stop)) {
        const lat = parseFloat(stop.stop_lat);
        const lon = parseFloat(stop.stop_lon);
        addMarker(stop, lat, lon);
        validLatLngs.push([lat, lon]);
      }
    });

    if (validLatLngs.length > 0) {
      map.fitBounds(validLatLngs, { padding: [40, 40] });
    }

    updatePolyline();
    renderStopList();
    updateCountInfo();
  }

  function addMarker(stop, lat, lon) {
    const isSelected = stop.stop_id === selectedStopId;
    const icon = L.divIcon({
      className: 'stop-marker-icon' + (isSelected ? ' selected' : ''),
      html: `<div class="stop-marker-dot"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    const marker = L.marker([lat, lon], { draggable: true, icon })
      .addTo(map)
      .bindPopup(`<b>${stop.stop_name}</b><br><small>${stop.stop_id}</small>`);

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      stop.stop_lat = pos.lat.toFixed(7);
      stop.stop_lon = pos.lng.toFixed(7);
      renderStopList();
      updatePolyline();
      updateCountInfo();
    });

    marker.on('click', () => {
      selectedStopId = stop.stop_id;
      renderStopList();
      updateMarkerStyles();
      updateClickHint();
    });

    markers[stop.stop_id] = marker;
  }

  function updateMarkerStyles() {
    Object.entries(markers).forEach(([id, marker]) => {
      const el = marker.getElement();
      if (!el) return;
      if (id === selectedStopId) {
        el.classList.add('selected');
      } else {
        el.classList.remove('selected');
      }
    });
  }

  function updatePolyline() {
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    const stops = getStops();
    const sorted = stops
      .filter(hasValidCoord)
      .sort((a, b) => parseInt(a.stop_sequence || 0) - parseInt(b.stop_sequence || 0));
    if (sorted.length >= 2) {
      const latlngs = sorted.map(s => [parseFloat(s.stop_lat), parseFloat(s.stop_lon)]);
      routeLine = L.polyline(latlngs, { color: '#2563eb', weight: 2, opacity: 0.55, dashArray: '6,4' }).addTo(map);
    }
  }

  function resetStop(stopId) {
    const stop = getStops().find(s => s.stop_id === stopId);
    if (!stop) return;
    stop.stop_lat = '';
    stop.stop_lon = '';
    if (markers[stopId]) {
      map.removeLayer(markers[stopId]);
      delete markers[stopId];
    }
    if (selectedStopId === stopId) updateClickHint();
    renderStopList();
    updatePolyline();
    updateCountInfo();
  }

  function resetAllStops() {
    const stops = getStops();
    if (!stops.length) return;
    if (!confirm(`全${stops.length}件の停留所の座標をリセットします。よろしいですか？`)) return;
    stops.forEach(s => { s.stop_lat = ''; s.stop_lon = ''; });
    Object.values(markers).forEach(m => map.removeLayer(m));
    markers = {};
    updatePolyline();
    renderStopList();
    updateCountInfo();
    updateClickHint();
  }

  function renderStopList() {
    const stops = getStops();
    const container = document.getElementById('stop-list');
    if (!container) return;

    const displayed = filterNoCoord ? stops.filter(s => !hasValidCoord(s)) : stops;

    let html = '';
    displayed.forEach(stop => {
      const ok = hasValidCoord(stop);
      const isSelected = stop.stop_id === selectedStopId;
      const lat = parseFloat(stop.stop_lat);
      const lon = parseFloat(stop.stop_lon);
      const coordText = ok ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : '未設定';
      const resetBtn = ok
        ? `<button class="stop-reset-btn" data-reset-id="${esc(stop.stop_id)}" title="この停留所の座標をリセット">✕</button>`
        : '';
      html += `<div class="stop-list-item${isSelected ? ' selected' : ''}" data-stop-id="${esc(stop.stop_id)}">
        <span class="stop-status-icon">${ok ? '✅' : '⚠️'}</span>
        <div class="stop-info">
          <div class="stop-name-text">${esc(stop.stop_name || '')}</div>
          <div class="stop-id-text">${esc(stop.stop_id)}</div>
          <div class="stop-coord-text${ok ? '' : ' no-coord'}">${coordText}</div>
        </div>
        ${resetBtn}
      </div>`;
    });

    container.innerHTML = html || '<div class="no-stops">停留所データがありません。STEP 2でstops.csvを読み込んでください。</div>';

    container.querySelectorAll('.stop-list-item').forEach(el => {
      el.addEventListener('click', e => {
        // リセットボタンのクリックは選択に影響しない
        if (e.target.closest('.stop-reset-btn')) return;
        selectedStopId = el.dataset.stopId;
        renderStopList();
        updateMarkerStyles();
        updateClickHint();
        const stop = stops.find(s => s.stop_id === selectedStopId);
        if (stop && hasValidCoord(stop)) {
          map.panTo([parseFloat(stop.stop_lat), parseFloat(stop.stop_lon)]);
          if (markers[selectedStopId]) markers[selectedStopId].openPopup();
        }
      });
    });

    container.querySelectorAll('.stop-reset-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        resetStop(btn.dataset.resetId);
      });
    });
  }

  function updateCountInfo() {
    const stops = getStops();
    const withCoord = stops.filter(hasValidCoord).length;
    const without = stops.length - withCoord;
    const el = document.getElementById('stop-count-info');
    if (el) el.textContent = `✅ 座標あり: ${withCoord}件  ⚠️ 未設定: ${without}件`;
  }

  function updateClickHint() {
    const hint = document.getElementById('map-click-hint');
    if (!hint) return;
    if (selectedStopId) {
      const stop = getStops().find(s => s.stop_id === selectedStopId);
      if (stop && !hasValidCoord(stop)) {
        hint.textContent = `📍 「${stop.stop_name}」を配置 — 地図をクリックしてください`;
        hint.classList.remove('hidden');
        return;
      }
    }
    hint.classList.add('hidden');
  }

  function onMapClick(e) {
    if (!selectedStopId) return;
    const stops = getStops();
    const stop = stops.find(s => s.stop_id === selectedStopId);
    if (!stop) return;

    const lat = e.latlng.lat;
    const lon = e.latlng.lng;
    stop.stop_lat = lat.toFixed(7);
    stop.stop_lon = lon.toFixed(7);

    if (markers[stop.stop_id]) {
      markers[stop.stop_id].setLatLng([lat, lon]);
    } else {
      addMarker(stop, lat, lon);
    }

    renderStopList();
    updatePolyline();
    updateCountInfo();
    updateClickHint();
  }

  // ---------- KML / KMZ ----------

  async function loadKmlFile(file) {
    let kmlText;
    if (file.name.toLowerCase().endsWith('.kmz')) {
      const buf = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buf);
      const kmlEntry = Object.values(zip.files).find(f => f.name.toLowerCase().endsWith('.kml') && !f.dir);
      if (!kmlEntry) { alert('KMZ 内に KML ファイルが見つかりません。'); return; }
      kmlText = await kmlEntry.async('string');
    } else {
      kmlText = await file.text();
    }
    applyKml(kmlText, file.name);
  }

  function applyKml(kmlText, filename) {
    if (!map) return;
    clearKmlLayer();

    const parser = new DOMParser();
    const doc = parser.parseFromString(kmlText, 'text/xml');
    const geojson = toGeoJSON.kml(doc);

    kmlLayer = L.geoJSON(geojson, {
      style: { color: '#e11d48', weight: 2.5, opacity: 0.75, fillColor: '#e11d48', fillOpacity: 0.12 },
      pointToLayer: (_, latlng) => L.circleMarker(latlng, {
        radius: 5, fillColor: '#e11d48', color: '#fff', weight: 1.5, opacity: 1, fillOpacity: 0.85
      }),
      onEachFeature: (feature, layer) => {
        const name = feature.properties?.name || feature.properties?.Name || '';
        const desc = feature.properties?.description || '';
        if (name || desc) layer.bindPopup(`<b>${esc(name)}</b>${desc ? '<br><small>' + desc + '</small>' : ''}`);
      }
    }).addTo(map);

    kmlVisible = true;

    const status = document.getElementById('kml-status');
    const toggleBtn = document.getElementById('kml-toggle-btn');
    const clearBtn = document.getElementById('kml-clear-btn');
    if (status) status.textContent = filename;
    toggleBtn?.classList.remove('hidden');
    clearBtn?.classList.remove('hidden');
    if (toggleBtn) { toggleBtn.textContent = '👁'; toggleBtn.title = '非表示にする'; }

    try {
      const bounds = kmlLayer.getBounds();
      if (bounds.isValid() && !getStops().some(hasValidCoord)) {
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    } catch (_) {}
  }

  function clearKmlLayer() {
    if (kmlLayer) { map.removeLayer(kmlLayer); kmlLayer = null; }
    kmlVisible = false;
    const status = document.getElementById('kml-status');
    const toggleBtn = document.getElementById('kml-toggle-btn');
    const clearBtn = document.getElementById('kml-clear-btn');
    if (status) status.textContent = '';
    toggleBtn?.classList.add('hidden');
    clearBtn?.classList.add('hidden');
    const input = document.getElementById('kml-file-input');
    if (input) input.value = '';
  }

  function toggleKmlVisibility() {
    if (!kmlLayer) return;
    const toggleBtn = document.getElementById('kml-toggle-btn');
    if (kmlVisible) {
      map.removeLayer(kmlLayer);
      kmlVisible = false;
      if (toggleBtn) { toggleBtn.textContent = '🚫'; toggleBtn.title = '表示する'; toggleBtn.classList.add('off'); }
    } else {
      kmlLayer.addTo(map);
      kmlVisible = true;
      if (toggleBtn) { toggleBtn.textContent = '👁'; toggleBtn.title = '非表示にする'; toggleBtn.classList.remove('off'); }
    }
  }

  // ---------- CSV download ----------

  function downloadStopsCsv() {
    const stops = getStops();
    if (!stops.length) { alert('停留所データがありません'); return; }
    const cols = Object.keys(stops[0]);
    ['stop_lat','stop_lon'].forEach(c => { if (!cols.includes(c)) cols.push(c); });

    let csv = cols.join(',') + '\r\n';
    stops.forEach(s => {
      csv += cols.map(c => {
        const val = String(s[c] ?? '');
        return (val.includes(',') || val.includes('"') || val.includes('\n'))
          ? `"${val.replace(/"/g, '""')}"` : val;
      }).join(',') + '\r\n';
    });

    const bom = '﻿';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'stops_補完済み.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  document.addEventListener('tabChange', e => {
    if (e.detail.tabId === 'tab-step3') {
      setTimeout(() => {
        initMap();
        render();
      }, 50);
    }
  });

  document.getElementById('filter-no-coord')?.addEventListener('change', e => {
    filterNoCoord = e.target.checked;
    renderStopList();
  });

  document.getElementById('dl-stops-csv-btn')?.addEventListener('click', downloadStopsCsv);
  document.getElementById('reset-all-stops-btn')?.addEventListener('click', resetAllStops);

  document.getElementById('kml-file-input')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) loadKmlFile(file);
  });
  document.getElementById('kml-toggle-btn')?.addEventListener('click', toggleKmlVisibility);
  document.getElementById('kml-clear-btn')?.addEventListener('click', clearKmlLayer);

  window.stopMapEditor = { render, initMap };
})();
