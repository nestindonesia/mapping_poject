import { addZona, updateZona, deleteZona, getAllZona, clearAllZona, saveKawasanInfo, getKawasanInfo } from "./kawasan-db.js";

// ---------- Peta dasar ----------
const map = L.map("map").setView([-6.9094, 107.72703], 17);

const jalanLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 20,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const satelitFallbackLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 20,
  attribution: "Tiles &copy; Esri",
});

const layersControl = L.control.layers({ "Peta Jalan": jalanLayer }).addTo(map);

// Disimpan supaya peta cetak (lihat bagian bawah file) bisa pakai citra
// satelit terbaru yang sama, tanpa perlu memanggil ulang API Wayback.
let satelitTileUrl = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
let satelitAttribusi = "Tiles &copy; Esri";

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
    satelitTileUrl = latest.url.replace("{level}", "{z}").replace("{row}", "{y}").replace("{col}", "{x}");
    satelitAttribusi = `Tiles &copy; Esri (citra ${latest.dateLabel}, arsip Wayback)`;
    const satelitLayer = L.tileLayer(satelitTileUrl, { maxZoom: 20, attribution: satelitAttribusi });
    layersControl.addBaseLayer(satelitLayer, `Citra Satelit (${latest.dateLabel})`);
    satelitLayer.addTo(map);
    jalanLayer.remove();
  } catch (err) {
    layersControl.addBaseLayer(satelitFallbackLayer, "Citra Satelit");
  }
}
setupSatelliteLayer();

// ---------- Layer zona yang digambar ----------
const zonaLayer = new L.FeatureGroup().addTo(map);

const drawControl = new L.Control.Draw({
  draw: {
    polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: "#333" } },
    polyline: false,
    rectangle: false,
    circle: false,
    circlemarker: false,
    marker: false,
  },
  edit: { featureGroup: zonaLayer },
});
map.addControl(drawControl);

// ---------- Daftar nama zona & kategori (bisa ditambah/diedit/dihapus
// pengguna lewat panel "Nama Zona" / "Kategori" di sidebar) ----------
const DEFAULT_NAMA_ZONA = [
  { nama: "Zona Agroforestry", warna: "#2f7bbf" },
  { nama: "Zona Edukasi dan Etalase KEHATI", warna: "#a9d6e5" },
  { nama: "Zona Toponimi Agroforestry", warna: "#f7e017" },
  { nama: "Zona Pengembangan Agroforestry", warna: "#e53935" },
  { nama: "Zona Rimba Agroforestry", warna: "#8bc34a" },
  { nama: "Zona Rimba Ciliwung", warna: "#2e7d32" },
  { nama: "Zona/Blok Lainnya", warna: "#cddc9a" },
];
const DEFAULT_KATEGORI = [
  { key: "eksisting", label: "Kawasan Eksisting" },
  { key: "rencana", label: "Rencana Pengembangan Perluasan Kawasan" },
];

let namaZonaList = DEFAULT_NAMA_ZONA.map((x) => ({ ...x }));
let kategoriList = DEFAULT_KATEGORI.map((x) => ({ ...x }));

function slugKategori(label) {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "kategori";
  let slug = base;
  let i = 2;
  while (kategoriList.some((k) => k.key === slug)) slug = `${base}_${i++}`;
  return slug;
}

function randomWarna() {
  const hue = Math.floor(Math.random() * 360);
  return hslToHex(hue, 60, 50);
}
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function populatePaletDropdown() {
  const sel = document.getElementById("modal-nama");
  const current = sel.value;
  sel.innerHTML =
    namaZonaList.map((p) => `<option value="${escapeHtml(p.nama)}" data-warna="${p.warna}">${escapeHtml(p.nama)}</option>`).join("") +
    `<option value="__custom__">Lainnya (ketik sendiri, sekali pakai)...</option>` +
    `<option value="__tambah__">+ Tambah nama baru ke daftar...</option>`;
  if ([...sel.options].some((o) => o.value === current)) sel.value = current;
}

function populateKategoriDropdown() {
  const sel = document.getElementById("modal-kategori");
  const current = sel.value;
  sel.innerHTML = kategoriList.map((k) => `<option value="${k.key}">${escapeHtml(k.label)}</option>`).join("") + `<option value="__tambah__">+ Tambah kategori baru...</option>`;
  if ([...sel.options].some((o) => o.value === current)) sel.value = current;
}

function renderKelolaNama() {
  const container = document.getElementById("kelola-nama-list");
  container.innerHTML = namaZonaList
    .map(
      (p, i) => `
      <div class="kelola-row">
        <span class="swatch" style="background:${p.warna}"></span>
        <span class="kelola-row-label">${escapeHtml(p.nama)}</span>
        <button type="button" class="btn btn-small" data-edit-nama="${i}">Edit</button>
        <button type="button" class="btn btn-danger btn-small" data-hapus-nama="${i}">Hapus</button>
      </div>`
    )
    .join("");
}

function renderKelolaKategori() {
  const container = document.getElementById("kelola-kategori-list");
  container.innerHTML = kategoriList
    .map(
      (k, i) => `
      <div class="kelola-row">
        <span class="kelola-row-label">${escapeHtml(k.label)}</span>
        <button type="button" class="btn btn-small" data-edit-kategori="${i}">Edit</button>
        <button type="button" class="btn btn-danger btn-small" data-hapus-kategori="${i}">Hapus</button>
      </div>`
    )
    .join("");
}

async function simpanDaftar() {
  const info = (await getKawasanInfo()) || {};
  await saveKawasanInfo({ ...info, namaZonaList, kategoriList });
}

document.getElementById("btn-tambah-nama").addEventListener("click", async () => {
  const nama = prompt("Nama zona baru:");
  if (!nama || !nama.trim()) return;
  namaZonaList.push({ nama: nama.trim(), warna: randomWarna() });
  await simpanDaftar();
  populatePaletDropdown();
  renderKelolaNama();
});

document.getElementById("kelola-nama-list").addEventListener("click", async (e) => {
  const editBtn = e.target.closest("[data-edit-nama]");
  const delBtn = e.target.closest("[data-hapus-nama]");
  if (editBtn) {
    const i = Number(editBtn.dataset.editNama);
    const baru = prompt("Ubah nama zona:", namaZonaList[i].nama);
    if (baru && baru.trim()) namaZonaList[i].nama = baru.trim();
    await simpanDaftar();
    populatePaletDropdown();
    renderKelolaNama();
  } else if (delBtn) {
    const i = Number(delBtn.dataset.hapusNama);
    if (!confirm(`Hapus preset nama "${namaZonaList[i].nama}" dari daftar? Zona yang sudah pakai nama ini tidak berubah.`)) return;
    namaZonaList.splice(i, 1);
    await simpanDaftar();
    populatePaletDropdown();
    renderKelolaNama();
  }
});

document.getElementById("btn-tambah-kategori").addEventListener("click", async () => {
  const label = prompt("Nama kategori baru (mis. Kawasan Penyangga):");
  if (!label || !label.trim()) return;
  kategoriList.push({ key: slugKategori(label.trim()), label: label.trim() });
  await simpanDaftar();
  populateKategoriDropdown();
  renderKelolaKategori();
});

document.getElementById("kelola-kategori-list").addEventListener("click", async (e) => {
  const editBtn = e.target.closest("[data-edit-kategori]");
  const delBtn = e.target.closest("[data-hapus-kategori]");
  if (editBtn) {
    const i = Number(editBtn.dataset.editKategori);
    const baru = prompt("Ubah nama kategori:", kategoriList[i].label);
    if (baru && baru.trim()) kategoriList[i].label = baru.trim();
    await simpanDaftar();
    populateKategoriDropdown();
    renderKelolaKategori();
  } else if (delBtn) {
    const i = Number(delBtn.dataset.hapusKategori);
    if (kategoriList.length <= 1) {
      alert("Minimal harus ada satu kategori.");
      return;
    }
    const dipakai = (await getAllZona()).some((z) => (z.kategori || kategoriList[0].key) === kategoriList[i].key);
    if (dipakai) {
      alert("Kategori ini masih dipakai oleh salah satu zona. Ubah kategori zona tersebut dulu sebelum menghapusnya.");
      return;
    }
    kategoriList.splice(i, 1);
    await simpanDaftar();
    populateKategoriDropdown();
    renderKelolaKategori();
  }
});

// ---------- Mode tampilan: Peta Kawasan (satelit) vs Peta Tematik (schematic) ----------
let modeTematik = false;
function terapkanMode() {
  document.getElementById("map").classList.toggle("mode-tematik", modeTematik);
  document.getElementById("btn-mode").textContent = modeTematik ? "Mode: Peta Tematik" : "Mode: Peta Kawasan";
  if (modeTematik) {
    // Sembunyikan citra dasar (satelit/jalan) supaya latar jadi polos putih,
    // meniru "Peta Tematik" skematik pada contoh referensi.
    Object.values(map._layers).forEach((l) => {
      if (l._url && map.hasLayer(l)) map.removeLayer(l);
    });
  }
  renderZona();
}

document.getElementById("btn-mode").addEventListener("click", () => {
  modeTematik = !modeTematik;
  if (!modeTematik) location.reload(); // cara paling aman mengembalikan basemap
  else terapkanMode();
});

// ---------- Render semua zona ----------
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function renderZona() {
  zonaLayer.clearLayers();
  const zonas = await getAllZona();
  zonas.sort((a, b) => Number(a.nomor) - Number(b.nomor));

  zonas.forEach((z) => {
    const layer = L.geoJSON(z.geojson, {
      style: {
        color: modeTematik ? "#a13a2e" : z.warna,
        weight: modeTematik ? 1.5 : 2,
        fillColor: z.warna,
        fillOpacity: modeTematik ? 0.95 : 0.5,
      },
    });
    layer.eachLayer((l) => {
      l.bindTooltip(String(z.nomor), { permanent: true, direction: "center", className: "zona-label" });
      l.bindPopup(`
        <div class="popup">
          <p class="popup-title">Zona ${escapeHtml(z.nomor)} &mdash; ${escapeHtml(z.nama)}</p>
          <p class="popup-sub">Luas: &plusmn; ${z.luas_ha.toFixed(3)} Ha</p>
          <div class="popup-row">
            <button type="button" class="btn btn-small" data-edit-zona="${z.id}">Edit</button>
            <button type="button" class="btn btn-danger btn-small" data-delete-zona="${z.id}">Hapus</button>
          </div>
        </div>
      `);
      zonaLayer.addLayer(l);
    });
  });

  renderLegenda(zonas);
  renderDaftar(zonas);
  renderLuasTotal(zonas);
}

function renderLegenda(zonas) {
  const seen = new Map();
  zonas.forEach((z) => {
    if (!seen.has(z.nama)) seen.set(z.nama, z.warna);
  });
  const container = document.getElementById("legenda-list");
  if (!seen.size) {
    container.innerHTML = `<p class="hint">Legenda muncul otomatis setelah ada zona.</p>`;
    return;
  }
  container.innerHTML = [...seen.entries()]
    .map(([nama, warna]) => `<div class="legenda-row"><span class="swatch" style="background:${warna}"></span>${escapeHtml(nama)}</div>`)
    .join("");
}

function renderDaftar(zonas) {
  const container = document.getElementById("zona-list");
  if (!zonas.length) {
    container.innerHTML = `<p class="hint">Belum ada zona. Gambar poligon di peta memakai alat gambar (ikon poligon di kiri atas peta).</p>`;
    return;
  }
  container.innerHTML = zonas
    .map(
      (z) => `
      <div class="zona-row" data-focus="${z.id}">
        <span class="dot" style="background:${z.warna}"></span>
        <div class="zona-row-main">
          <strong>Zona ${escapeHtml(z.nomor)}</strong> &mdash; ${escapeHtml(z.nama)}
          <div class="hint">&plusmn; ${z.luas_ha.toFixed(3)} Ha</div>
        </div>
        <button type="button" class="btn btn-small" data-edit-zona="${z.id}">Edit</button>
        <button type="button" class="btn btn-danger btn-small" data-delete-zona="${z.id}">Hapus</button>
      </div>`
    )
    .join("");
}

function renderLuasTotal(zonas) {
  const total = zonas.reduce((s, z) => s + (z.luas_ha || 0), 0);
  document.getElementById("luas-digitasi").textContent = total.toFixed(3);
}

// ---------- Modal tambah/edit zona ----------
const modal = document.getElementById("zona-modal");
let pendingLayer = null;
let editingId = null;

function bukaModal(layer, existing) {
  pendingLayer = layer;
  editingId = existing ? existing.id : null;
  document.getElementById("modal-title").textContent = existing ? "Edit Zona" : "Zona Baru";
  document.getElementById("modal-nomor").value = existing ? existing.nomor : nextNomor();
  populatePaletDropdown();
  populateKategoriDropdown();
  document.getElementById("modal-nama").value = existing && namaZonaList.some((p) => p.nama === existing.nama) ? existing.nama : "__custom__";
  document.getElementById("modal-nama-custom").value = existing ? existing.nama : "";
  document.getElementById("modal-nama-custom").hidden = document.getElementById("modal-nama").value !== "__custom__";
  document.getElementById("modal-warna").value = existing ? existing.warna : namaZonaList[0].warna;
  document.getElementById("modal-kategori").value = existing && kategoriList.some((k) => k.key === existing.kategori) ? existing.kategori : kategoriList[0].key;
  modal.hidden = false;
}

function tutupModal() {
  modal.hidden = true;
  if (pendingLayer && editingId === null) {
    zonaLayer.removeLayer(pendingLayer); // batal -> buang gambar sementara
  }
  pendingLayer = null;
  editingId = null;
}

document.getElementById("modal-nama").addEventListener("change", async (e) => {
  if (e.target.value === "__tambah__") {
    const nama = prompt("Nama zona baru:");
    if (nama && nama.trim()) {
      namaZonaList.push({ nama: nama.trim(), warna: randomWarna() });
      await simpanDaftar();
      renderKelolaNama();
      populatePaletDropdown();
      document.getElementById("modal-nama").value = nama.trim();
    } else {
      e.target.value = "__custom__";
    }
  }
  const isCustom = e.target.value === "__custom__";
  document.getElementById("modal-nama-custom").hidden = !isCustom;
  if (!isCustom) {
    const opt = namaZonaList.find((p) => p.nama === e.target.value);
    if (opt) document.getElementById("modal-warna").value = opt.warna;
  }
});

document.getElementById("modal-kategori").addEventListener("change", async (e) => {
  if (e.target.value === "__tambah__") {
    const label = prompt("Nama kategori baru (mis. Kawasan Penyangga):");
    if (label && label.trim()) {
      const baru = { key: slugKategori(label.trim()), label: label.trim() };
      kategoriList.push(baru);
      await simpanDaftar();
      renderKelolaKategori();
      populateKategoriDropdown();
      document.getElementById("modal-kategori").value = baru.key;
    } else {
      e.target.value = kategoriList[0].key;
    }
  }
});

document.getElementById("modal-cancel").addEventListener("click", tutupModal);

document.getElementById("modal-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nomor = document.getElementById("modal-nomor").value.trim() || String(nextNomor());
  const namaSel = document.getElementById("modal-nama").value;
  const nama = namaSel === "__custom__" ? document.getElementById("modal-nama-custom").value.trim() : namaSel;
  const warna = document.getElementById("modal-warna").value;
  const kategori = document.getElementById("modal-kategori").value;
  if (!nama) {
    alert("Nama zona wajib diisi.");
    return;
  }

  const geojson = pendingLayer.toGeoJSON();
  const latlngs = pendingLayer.getLatLngs ? pendingLayer.getLatLngs()[0] : null;
  const luas_ha = latlngs ? L.GeometryUtil.geodesicArea(latlngs) / 10000 : 0;

  if (editingId) {
    await updateZona({ id: editingId, nomor, nama, warna, kategori, geojson, luas_ha });
  } else {
    await addZona({ nomor, nama, warna, kategori, geojson, luas_ha });
  }
  modal.hidden = true;
  pendingLayer = null;
  editingId = null;
  await renderZona();
});

function nextNomor() {
  return document.querySelectorAll(".zona-row").length + 1;
}

map.on(L.Draw.Event.CREATED, (e) => {
  bukaModal(e.layer, null);
});

document.getElementById("map").addEventListener("click", async (e) => {
  const editBtn = e.target.closest("[data-edit-zona]");
  const delBtn = e.target.closest("[data-delete-zona]");
  if (editBtn) {
    const zonas = await getAllZona();
    const z = zonas.find((x) => x.id === Number(editBtn.dataset.editZona));
    if (z) {
      const tempLayer = L.geoJSON(z.geojson).getLayers()[0];
      bukaModal(tempLayer, z);
    }
  } else if (delBtn) {
    await deleteZona(Number(delBtn.dataset.deleteZona));
    await renderZona();
  }
});

document.getElementById("zona-list").addEventListener("click", async (e) => {
  const editBtn = e.target.closest("[data-edit-zona]");
  const delBtn = e.target.closest("[data-delete-zona]");
  const row = e.target.closest("[data-focus]");
  if (editBtn) {
    const zonas = await getAllZona();
    const z = zonas.find((x) => x.id === Number(editBtn.dataset.editZona));
    if (z) {
      const tempLayer = L.geoJSON(z.geojson).getLayers()[0];
      bukaModal(tempLayer, z);
    }
    return;
  }
  if (delBtn) {
    await deleteZona(Number(delBtn.dataset.deleteZona));
    await renderZona();
    return;
  }
  if (row) {
    const zonas = await getAllZona();
    const z = zonas.find((x) => x.id === Number(row.dataset.focus));
    if (z) {
      const layer = L.geoJSON(z.geojson);
      map.fitBounds(layer.getBounds(), { maxZoom: 19 });
    }
  }
});

// ---------- Info kop peta (judul, tahun, luas ditetapkan, logo) ----------
let logoDataUrl = null;

async function loadKawasanInfo() {
  const info = (await getKawasanInfo()) || {};
  document.getElementById("info-nama").value = info.nama || "TAMAN KEHATI KOTA BANDUNG";
  document.getElementById("info-tahun").value = info.tahun || "2019";
  document.getElementById("info-luas-tetap").value = info.luasTetap || "";
  logoDataUrl = info.logoDataUrl || null;
  tampilkanPratinjauLogo();

  if (Array.isArray(info.namaZonaList) && info.namaZonaList.length) namaZonaList = info.namaZonaList;
  if (Array.isArray(info.kategoriList) && info.kategoriList.length) kategoriList = info.kategoriList;
  populatePaletDropdown();
  populateKategoriDropdown();
  renderKelolaNama();
  renderKelolaKategori();
}

async function simpanInfoKawasan() {
  await saveKawasanInfo({
    nama: document.getElementById("info-nama").value,
    tahun: document.getElementById("info-tahun").value,
    luasTetap: document.getElementById("info-luas-tetap").value,
    logoDataUrl,
    namaZonaList,
    kategoriList,
  });
  updateJudulCetak();
}

document.getElementById("info-form").addEventListener("input", simpanInfoKawasan);

function tampilkanPratinjauLogo() {
  const wrap = document.getElementById("info-logo-preview-wrap");
  wrap.hidden = !logoDataUrl;
  if (logoDataUrl) document.getElementById("info-logo-preview").src = logoDataUrl;
}

document.getElementById("info-logo").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    logoDataUrl = reader.result;
    tampilkanPratinjauLogo();
    await simpanInfoKawasan();
  };
  reader.readAsDataURL(file);
});

document.getElementById("info-logo-hapus").addEventListener("click", async () => {
  logoDataUrl = null;
  document.getElementById("info-logo").value = "";
  tampilkanPratinjauLogo();
  await simpanInfoKawasan();
});

function updateJudulCetak() {
  const nama = document.getElementById("info-nama").value || "KAWASAN";
  document.getElementById("cetak-judul-1").textContent = nama;
  document.getElementById("cetak-judul-2").textContent = nama;
  document.querySelectorAll(".cetak-logo-box").forEach((el) => {
    el.innerHTML = logoDataUrl ? `<img src="${logoDataUrl}" alt="Logo kawasan" />` : "";
  });
}

function legendChipHtml(z) {
  return `
    <div class="cetak-legend-row">
      <span class="cetak-legend-chip" style="background:${z.warna}">Zona ${escapeHtml(z.nomor)}</span>
      <span class="cetak-legend-desc">${escapeHtml(z.nama)} &middot; &plusmn;${z.luas_ha.toFixed(3)} Ha</span>
    </div>`;
}

// Membangun satu kotak legenda per kategori di kategoriList. Kategori
// pertama dianggap kategori "utama" (biasanya kawasan eksisting) sehingga
// diberi judul "LEGENDA" + info luas/tahun; kategori berikutnya (mis.
// rencana pengembangan) cukup judul kategorinya sendiri.
function renderCetakLegenda(zonas) {
  const luasTetap = document.getElementById("info-luas-tetap").value.trim();
  const sudahAdaSatuan = /ha\b/i.test(luasTetap);
  const luasText = luasTetap ? (sudahAdaSatuan ? luasTetap : `${luasTetap} Ha`) : `${document.getElementById("luas-digitasi").textContent} Ha (hasil digitasi)`;
  const tahun = document.getElementById("info-tahun").value || "-";
  const kategoriUtama = kategoriList[0].key;

  const boxesHtml = kategoriList
    .map((k, i) => {
      const anggota = zonas.filter((z) => (z.kategori || kategoriUtama) === k.key);
      const chipsHtml = anggota.length ? anggota.map(legendChipHtml).join("") : i === 0 ? `<p class="hint">Belum ada zona.</p>` : "";
      const judul =
        i === 0
          ? `<p class="cetak-legend-title">LEGENDA</p><p class="cetak-legend-sub">${escapeHtml(k.label)}<br/>Luas : ${luasText}<br/>Ditetapkan Tahun ${escapeHtml(tahun)}</p>`
          : `<p class="cetak-legend-title">${escapeHtml(k.label)}</p>`;
      return `<div class="cetak-legend-box">${judul}${chipsHtml}</div>`;
    })
    .join("");

  document.querySelectorAll(".cetak-legend-container").forEach((el) => (el.innerHTML = boxesHtml));
}

// ---------- Peta khusus lembar cetak (2 instance Leaflet terpisah: satu
// tampilan "Peta Kawasan" di atas citra satelit, satu tampilan "Peta
// Tematik" skematik di latar putih) ----------
let cetakMapKawasan = null;
let cetakMapTematik = null;
let cetakZonaLayerKawasan = null;
let cetakZonaLayerTematik = null;

function initCetakMaps() {
  if (cetakMapKawasan) return;
  cetakMapKawasan = L.map("cetak-map-kawasan", { zoomControl: false, attributionControl: false });
  L.tileLayer(satelitTileUrl, { maxZoom: 20 }).addTo(cetakMapKawasan);
  cetakZonaLayerKawasan = L.layerGroup().addTo(cetakMapKawasan);

  cetakMapTematik = L.map("cetak-map-tematik", { zoomControl: false, attributionControl: false });
  cetakZonaLayerTematik = L.layerGroup().addTo(cetakMapTematik);
}

function gambarZonaDiCetakMap(zonas, layerGroup, tematik) {
  layerGroup.clearLayers();
  const bounds = [];
  zonas.forEach((z) => {
    const layer = L.geoJSON(z.geojson, {
      style: {
        color: tematik ? "#a13a2e" : z.warna,
        weight: tematik ? 1.5 : 2,
        fillColor: z.warna,
        fillOpacity: tematik ? 0.95 : 0.55,
      },
    });
    layer.eachLayer((l) => {
      l.bindTooltip(String(z.nomor), { permanent: true, direction: "center", className: "zona-label" });
      layerGroup.addLayer(l);
      bounds.push(l.getBounds());
    });
  });
  return bounds;
}

let cetakBoundsTerakhir = null;

function terapkanBoundsCetak() {
  cetakMapKawasan.invalidateSize();
  cetakMapTematik.invalidateSize();
  if (cetakBoundsTerakhir) {
    cetakMapKawasan.fitBounds(cetakBoundsTerakhir, { padding: [20, 20], animate: false });
    cetakMapTematik.fitBounds(cetakBoundsTerakhir, { padding: [20, 20], animate: false });
  } else {
    cetakMapKawasan.setView(map.getCenter(), map.getZoom(), { animate: false });
    cetakMapTematik.setView(map.getCenter(), map.getZoom(), { animate: false });
  }
}

function fitCetakMaps(zonas) {
  const boundsKawasan = gambarZonaDiCetakMap(zonas, cetakZonaLayerKawasan, false);
  gambarZonaDiCetakMap(zonas, cetakZonaLayerTematik, true);

  cetakBoundsTerakhir = boundsKawasan.length
    ? boundsKawasan.reduce((acc, b) => (acc ? acc.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast())), null)
    : null;

  terapkanBoundsCetak();
}

document.getElementById("btn-cetak").addEventListener("click", async () => {
  const zonas = await getAllZona();
  zonas.sort((a, b) => Number(a.nomor) - Number(b.nomor));

  updateJudulCetak();
  renderCetakLegenda(zonas);
  initCetakMaps();
  fitCetakMaps(zonas);

  // Beri jeda sedikit supaya tile citra satelit sempat mulai dimuat sebelum
  // dialog cetak membekukan halaman.
  setTimeout(() => window.print(), 400);
});

window.addEventListener("beforeprint", () => {
  if (!cetakMapKawasan) return;
  terapkanBoundsCetak();
});

document.getElementById("btn-hapus-semua").addEventListener("click", async () => {
  if (!confirm("Hapus semua zona di peta ini? Tindakan ini tidak bisa dibatalkan.")) return;
  await clearAllZona();
  await renderZona();
});

// ---------- Ekspor untuk QGIS (GeoJSON) / Google Earth (KML) ----------
function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function kategoriLabel(key) {
  const k = kategoriList.find((x) => x.key === key);
  return k ? k.label : key;
}

document.getElementById("btn-export-geojson").addEventListener("click", async () => {
  const zonas = await getAllZona();
  if (!zonas.length) {
    alert("Belum ada zona untuk diekspor.");
    return;
  }
  const geojson = {
    type: "FeatureCollection",
    features: zonas.map((z) => ({
      type: "Feature",
      geometry: z.geojson.geometry,
      properties: {
        nomor: z.nomor,
        nama: z.nama,
        kategori: z.kategori,
        kategori_label: kategoriLabel(z.kategori),
        warna: z.warna,
        luas_ha: Number(z.luas_ha.toFixed(4)),
      },
    })),
  };
  downloadBlob("peta-kawasan.geojson", JSON.stringify(geojson, null, 2), "application/geo+json");
});

// Warna hex "#rrggbb" -> warna KML "aabbggrr" (urutan byte KML kebalikan dari hex biasa)
function hexToKmlColor(hex, alphaHex = "cc") {
  const h = hex.replace("#", "");
  const r = h.substring(0, 2);
  const g = h.substring(2, 4);
  const b = h.substring(4, 6);
  return `${alphaHex}${b}${g}${r}`;
}

document.getElementById("btn-export-kml").addEventListener("click", async () => {
  const zonas = await getAllZona();
  if (!zonas.length) {
    alert("Belum ada zona untuk diekspor.");
    return;
  }
  const escXml = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  const placemarks = zonas
    .map((z) => {
      const rings = z.geojson.geometry.type === "Polygon" ? [z.geojson.geometry.coordinates] : z.geojson.geometry.coordinates;
      const polyKml = rings
        .map((rangPoly) => {
          const outer = rangPoly[0].map(([lon, lat]) => `${lon},${lat},0`).join(" ");
          return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${outer}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
        })
        .join("");
      const styleId = `warna_${z.id}`;
      return `
        <Style id="${styleId}">
          <LineStyle><color>ff${z.warna.replace("#", "").match(/../g).reverse().join("")}</color><width>2</width></LineStyle>
          <PolyStyle><color>${hexToKmlColor(z.warna)}</color></PolyStyle>
        </Style>
        <Placemark>
          <name>Zona ${escXml(z.nomor)} - ${escXml(z.nama)}</name>
          <description>${escXml(kategoriLabel(z.kategori))} &middot; &plusmn;${z.luas_ha.toFixed(3)} Ha</description>
          <styleUrl>#${styleId}</styleUrl>
          ${polyKml}
        </Placemark>`;
    })
    .join("");

  const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${placemarks}</Document></kml>`;
  downloadBlob("peta-kawasan.kml", kml, "application/vnd.google-earth.kml+xml");
});

// ---------- Muat data awal dari data/peta-kawasan.geojson (sekali saja) ----------
// Supaya kalau situs ini dibuka pertama kali dari perangkat/browser lain (mis.
// versi publik di GitHub Pages, yang IndexedDB-nya selalu kosong), zona yang
// sudah pernah diekspor & di-commit ke repo langsung tampil -- bukan kosong.
// Hanya dicoba SEKALI (ditandai lewat "sudahImporAwal"), supaya kalau nanti
// pengguna sengaja menghapus semua zona, tidak diisi ulang otomatis lagi.
async function importDariFileJikaPerlu() {
  const info = (await getKawasanInfo()) || {};
  if (info.sudahImporAwal) return;

  const existing = await getAllZona();
  if (existing.length === 0) {
    try {
      const resp = await fetch("data/peta-kawasan.geojson");
      if (resp.ok) {
        const geojson = await resp.json();
        let nomorBerikutnya = 1;
        for (const f of geojson.features || []) {
          const p = f.properties || {};
          const nomor = p.nomor != null ? String(p.nomor) : String(nomorBerikutnya);
          nomorBerikutnya = Math.max(nomorBerikutnya, Number(nomor) || 0) + 1;
          const nama = p.nama || "Zona";
          const kategori = p.kategori || kategoriList[0].key;
          const warna = p.warna || randomWarna();
          const luas_ha = typeof p.luas_ha === "number" ? p.luas_ha : 0;

          if (!kategoriList.some((k) => k.key === kategori)) {
            kategoriList.push({ key: kategori, label: p.kategori_label || kategori });
          }
          if (!namaZonaList.some((n) => n.nama === nama)) {
            namaZonaList.push({ nama, warna });
          }

          await addZona({
            nomor,
            nama,
            kategori,
            warna,
            luas_ha,
            geojson: { type: "Feature", properties: {}, geometry: f.geometry },
          });
        }
        populatePaletDropdown();
        populateKategoriDropdown();
        renderKelolaNama();
        renderKelolaKategori();
      }
    } catch (err) {
      // data/peta-kawasan.geojson tidak ada / gagal dimuat -- lewati saja, bukan error fatal.
    }
  }

  await saveKawasanInfo({ ...(await getKawasanInfo()), namaZonaList, kategoriList, sudahImporAwal: true });
}

(async () => {
  await loadKawasanInfo();
  await importDariFileJikaPerlu();
  await renderZona();
})();
