import { readGpsFromJpeg } from "./exif-gps.js";
import { addTitik, updateTitik, deleteTitik, getAllTitik } from "./db.js";

const ADMIN_LEVELS = [
  { key: "provinsi", label: "Provinsi", zoom: 5 },
  { key: "kabupaten", label: "Kabupaten/Kota", zoom: 8 },
  { key: "kecamatan", label: "Kecamatan", zoom: 12 },
  { key: "desa", label: "Kelurahan/Desa", zoom: 13 },
];

const map = L.map("map").setView([-2.5, 118], 5);

const jalanLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

// Fallback: mosaik Esri standar (terus diperbarui Esri, tapi tanpa label tanggal rilis yang pasti).
const satelitFallbackLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 19,
  attribution: "Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
});

// Label jalan/tempat di atas citra satelit (biar tetap terbaca nama lokasi)
const satelitLabelLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 19,
  pane: "shadowPane",
});

const layersControl = L.control.layers({ "Peta Jalan": jalanLayer }).addTo(map);
let satelitAktif = null;

// Ambil rilis citra satelit Esri "Wayback" terbaru yang tersedia (arsip resmi
// Esri berisi tanggal rilis per update mosaik dunia) supaya tombol "Citra
// Satelit" selalu menampilkan versi terkini, bukan cache lama.
async function setupSatelliteLayer() {
  try {
    const resp = await fetch("https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const config = await resp.json();
    let latest = null;
    Object.values(config).forEach((entry) => {
      const m = /(\d{4}-\d{2}-\d{2})/.exec(entry.itemTitle || "");
      if (!m) return;
      const date = new Date(m[1]);
      if (!latest || date > latest.date) latest = { date, dateLabel: m[1], url: entry.itemURL };
    });
    if (!latest) throw new Error("Format konfigurasi Wayback tidak dikenali");

    const tileUrl = latest.url.replace("{level}", "{z}").replace("{row}", "{y}").replace("{col}", "{x}");
    const satelitLayer = L.tileLayer(tileUrl, {
      maxZoom: 19,
      attribution: `Tiles &copy; Esri (citra ${latest.dateLabel}, arsip Wayback)`,
    });
    satelitAktif = L.layerGroup([satelitLayer, satelitLabelLayer]);
    layersControl.addBaseLayer(satelitAktif, `Citra Satelit (${latest.dateLabel})`);
  } catch (err) {
    // Internet lambat/terputus, atau layanan Wayback berubah -- tetap sediakan citra satelit,
    // hanya saja tanpa label tanggal rilis yang presisi.
    satelitAktif = L.layerGroup([satelitFallbackLayer, satelitLabelLayer]);
    layersControl.addBaseLayer(satelitAktif, "Citra Satelit");
    setStatus(`Tidak bisa memeriksa versi citra satelit terbaru (${err.message}), memakai citra satelit standar.`);
  }
}
setupSatelliteLayer();

const pointsLayer = L.layerGroup().addTo(map);
const circlesLayer = L.layerGroup().addTo(map);
const adminLayer = L.layerGroup().addTo(map);

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function colorForWilayah(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

function formatTanggal(dateTimeOriginal) {
  if (!dateTimeOriginal) return "";
  const m = dateTimeOriginal.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}:\d{2}:\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}` : dateTimeOriginal;
}

// ---------- Lingkaran radius sebagai poligon (untuk ekspor GeoJSON/KML) ----------
function circleToPolygonCoords(lat, lon, radiusM, steps = 48) {
  const coords = [];
  const latRad = (lat * Math.PI) / 180;
  const degPerMeterLat = 1 / 111320;
  const degPerMeterLon = 1 / (111320 * Math.cos(latRad));
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLat = radiusM * Math.sin(angle) * degPerMeterLat;
    const dLon = radiusM * Math.cos(angle) * degPerMeterLon;
    coords.push([lon + dLon, lat + dLat]);
  }
  return coords;
}

// ---------- Peta ----------
async function refreshMap() {
  pointsLayer.clearLayers();
  circlesLayer.clearLayers();
  adminLayer.clearLayers();

  const titikList = await getAllTitik();
  const bounds = [];

  titikList.forEach((t) => {
    const color = colorForWilayah(t.wilayah);
    bounds.push([t.latitude, t.longitude]);

    if (t.radius_m > 0) {
      L.circle([t.latitude, t.longitude], {
        radius: t.radius_m,
        color,
        weight: 1.5,
        dashArray: "4 4",
        fillColor: color,
        fillOpacity: 0.12,
      }).addTo(circlesLayer);
    }

    if (t.adminGeojson) {
      L.geoJSON(t.adminGeojson, {
        style: { color, weight: 2, fillColor: color, fillOpacity: 0.08 },
      }).addTo(adminLayer);
    }

    const marker = L.circleMarker([t.latitude, t.longitude], {
      radius: 7,
      color: "#fff",
      weight: 2,
      fillColor: color,
      fillOpacity: 1,
    });
    marker.bindTooltip(t.wilayah, { permanent: false, direction: "top" });

    const url = URL.createObjectURL(t.blob);
    const popup = document.createElement("div");
    popup.className = "popup";
    popup.innerHTML = `
      <img src="${url}" alt="${escapeHtml(t.filename)}" class="popup-img" />
      <p class="popup-title">${escapeHtml(t.wilayah)}</p>
      <p class="popup-sub">${escapeHtml(t.filename)}</p>
      ${t.dateTimeOriginal ? `<p class="popup-sub">${escapeHtml(formatTanggal(t.dateTimeOriginal))}</p>` : ""}
      <p class="popup-sub">${t.latitude.toFixed(6)}, ${t.longitude.toFixed(6)} &middot; radius ${t.radius_m} m</p>
      ${t.adminName ? `<p class="popup-sub popup-admin">${escapeHtml(t.adminName)}</p>` : ""}
      <div class="popup-row">
        <select class="popup-level" data-id="${t.id}">
          ${ADMIN_LEVELS.map((l) => `<option value="${l.key}">${l.label}</option>`).join("")}
        </select>
        <button type="button" class="btn btn-small" data-fetch-admin="${t.id}">Ambil Batas Resmi</button>
      </div>
      <button type="button" class="btn btn-danger btn-small popup-delete" data-delete="${t.id}">Hapus Titik</button>
    `;
    marker.bindPopup(popup);
    marker.addTo(pointsLayer);
  });

  if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  renderList(titikList);
  return titikList;
}

// ---------- Daftar wilayah (sidebar) ----------
function renderList(titikList) {
  const container = document.getElementById("list-container");
  if (!titikList.length) {
    container.innerHTML = `<p class="hint">Belum ada titik. Tambahkan lewat form di atas.</p>`;
    return;
  }
  const groups = {};
  titikList.forEach((t) => {
    (groups[t.wilayah] ||= []).push(t);
  });

  container.innerHTML = Object.entries(groups)
    .map(([wilayah, items]) => {
      const color = colorForWilayah(wilayah);
      return `
        <div class="wilayah-group">
          <div class="wilayah-group-header"><span class="dot" style="background:${color}"></span>${escapeHtml(wilayah)} <span class="count">${items.length} titik</span></div>
          ${items
            .map(
              (t) => `
            <div class="titik-row" data-focus="${t.id}">
              <div>
                <strong>${escapeHtml(t.filename)}</strong>
                <div class="hint">${t.latitude.toFixed(5)}, ${t.longitude.toFixed(5)} &middot; radius ${t.radius_m} m${t.adminName ? " &middot; " + escapeHtml(t.adminName) : ""}</div>
              </div>
              <button type="button" class="btn btn-danger btn-small" data-delete="${t.id}">Hapus</button>
            </div>`
            )
            .join("")}
        </div>`;
    })
    .join("");
}

// ---------- Ambil batas wilayah resmi dari OpenStreetMap Nominatim ----------
async function fetchAdminBoundary(id, levelKey) {
  const titikList = await getAllTitik();
  const t = titikList.find((x) => x.id === id);
  if (!t) return;
  const level = ADMIN_LEVELS.find((l) => l.key === levelKey) || ADMIN_LEVELS[1];

  setStatus(`Mengambil batas ${level.label.toLowerCase()} untuk "${t.wilayah}"...`);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=geojson&lat=${t.latitude}&lon=${t.longitude}&polygon_geojson=1&zoom=${level.zoom}&accept-language=id`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const feature = data.features && data.features[0];
    if (!feature || !feature.geometry) {
      setStatus(`Tidak ditemukan batas ${level.label.toLowerCase()} resmi untuk titik ini (coba level lain).`);
      return;
    }
    t.adminGeojson = feature.geometry;
    t.adminName = feature.properties && feature.properties.display_name;
    t.adminLevel = level.key;
    await updateTitik(t);
    setStatus(`Batas ${level.label.toLowerCase()} berhasil ditambahkan untuk "${t.wilayah}".`);
    await refreshMap();
  } catch (err) {
    setStatus(`Gagal mengambil batas wilayah: ${err.message}. Pastikan ada koneksi internet.`);
  }
}

function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}

// ---------- Form tambah titik ----------
document.getElementById("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const wilayah = document.getElementById("f-wilayah").value.trim();
  const radius = Number(document.getElementById("f-radius").value) || 500;
  const files = document.getElementById("f-files").files;
  if (!wilayah) {
    setStatus("Nama wilayah wajib diisi.");
    return;
  }
  if (!files.length) {
    setStatus("Pilih minimal satu foto JPEG.");
    return;
  }

  let added = 0;
  let noGps = 0;
  let skipped = 0;
  for (const file of Array.from(files)) {
    if (!/image\/jpe?g/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) {
      skipped++;
      continue;
    }
    setStatus(`Memproses ${file.name}...`);
    let gps;
    try {
      gps = await readGpsFromJpeg(file);
    } catch (err) {
      gps = null;
    }
    if (!gps) {
      noGps++;
      continue;
    }
    await addTitik({
      wilayah,
      filename: file.name,
      blob: file,
      latitude: gps.latitude,
      longitude: gps.longitude,
      dateTimeOriginal: gps.dateTimeOriginal,
      radius_m: radius,
      adminGeojson: null,
      adminName: null,
      adminLevel: null,
      addedAt: new Date().toISOString(),
    });
    added++;
  }

  const parts = [];
  if (added) parts.push(`${added} titik ditambahkan ke "${wilayah}"`);
  if (noGps) parts.push(`${noGps} foto tanpa data lokasi GPS dilewati`);
  if (skipped) parts.push(`${skipped} file bukan JPEG dilewati`);
  setStatus(parts.length ? parts.join(", ") + "." : "Tidak ada foto yang diproses.");

  e.target.reset();
  document.getElementById("f-radius").value = radius;
  await refreshMap();
});

// ---------- Klik di dalam peta (popup) ----------
document.getElementById("map").addEventListener("click", async (e) => {
  const delBtn = e.target.closest("[data-delete]");
  if (delBtn) {
    await deleteTitik(Number(delBtn.dataset.delete));
    await refreshMap();
    setStatus("Titik dihapus.");
    return;
  }
  const fetchBtn = e.target.closest("[data-fetch-admin]");
  if (fetchBtn) {
    const id = Number(fetchBtn.dataset.fetchAdmin);
    const select = document.querySelector(`.popup-level[data-id="${id}"]`);
    await fetchAdminBoundary(id, select ? select.value : "kabupaten");
  }
});

// ---------- Klik di daftar sidebar ----------
document.getElementById("list-container").addEventListener("click", async (e) => {
  const delBtn = e.target.closest("[data-delete]");
  if (delBtn) {
    await deleteTitik(Number(delBtn.dataset.delete));
    await refreshMap();
    setStatus("Titik dihapus.");
    return;
  }
  const row = e.target.closest("[data-focus]");
  if (row) {
    const titikList = await getAllTitik();
    const t = titikList.find((x) => x.id === Number(row.dataset.focus));
    if (t) map.setView([t.latitude, t.longitude], 15);
  }
});

// ---------- Ekspor GeoJSON ----------
async function buildGeoJson() {
  const titikList = await getAllTitik();
  const features = [];
  titikList.forEach((t) => {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [t.longitude, t.latitude] },
      properties: { wilayah: t.wilayah, filename: t.filename, tanggal: t.dateTimeOriginal, radius_m: t.radius_m, admin: t.adminName || null },
    });
    if (t.radius_m > 0) {
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [circleToPolygonCoords(t.latitude, t.longitude, t.radius_m)] },
        properties: { wilayah: t.wilayah, jenis: "buffer_perkiraan", radius_m: t.radius_m },
      });
    }
    if (t.adminGeojson) {
      features.push({
        type: "Feature",
        geometry: t.adminGeojson,
        properties: { wilayah: t.wilayah, jenis: "batas_administratif", level: t.adminLevel, nama: t.adminName },
      });
    }
  });
  return { type: "FeatureCollection", features };
}

function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

document.getElementById("export-geojson-btn").addEventListener("click", async () => {
  const geojson = await buildGeoJson();
  if (!geojson.features.length) {
    setStatus("Belum ada titik untuk diekspor.");
    return;
  }
  downloadBlob("peta-wilayah.geojson", JSON.stringify(geojson, null, 2), "application/geo+json");
  setStatus("GeoJSON diunduh -- bisa dibuka di QGIS, Google Earth Pro, atau geojson.io.");
});

document.getElementById("export-kml-btn").addEventListener("click", async () => {
  const titikList = await getAllTitik();
  if (!titikList.length) {
    setStatus("Belum ada titik untuk diekspor.");
    return;
  }
  const escXml = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const placemarks = [];
  titikList.forEach((t) => {
    placemarks.push(`<Placemark><name>${escXml(t.wilayah)} - ${escXml(t.filename)}</name><Point><coordinates>${t.longitude},${t.latitude},0</coordinates></Point></Placemark>`);
    if (t.radius_m > 0) {
      const ring = circleToPolygonCoords(t.latitude, t.longitude, t.radius_m)
        .map(([lon, lat]) => `${lon},${lat},0`)
        .join(" ");
      placemarks.push(`<Placemark><name>${escXml(t.wilayah)} - perkiraan area</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${ring}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`);
    }
    if (t.adminGeojson) {
      const polys = t.adminGeojson.type === "Polygon" ? [t.adminGeojson.coordinates] : t.adminGeojson.coordinates;
      polys.forEach((rings) => {
        const ring = rings[0].map(([lon, lat]) => `${lon},${lat},0`).join(" ");
        placemarks.push(`<Placemark><name>${escXml(t.wilayah)} - batas resmi</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${ring}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`);
      });
    }
  });
  const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${placemarks.join("")}</Document></kml>`;
  downloadBlob("peta-wilayah.kml", kml, "application/vnd.google-earth.kml+xml");
  setStatus("KML diunduh -- bisa dibuka di Google Earth.");
});

refreshMap();
