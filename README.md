# Peta GIS Wilayah

Aplikasi web statis (tanpa server backend) untuk memetakan titik lokasi survei dan menggambar zona/kawasan, dibangun dengan [Leaflet](https://leafletjs.com/) + [Leaflet.draw](https://github.com/Leaflet/Leaflet.draw). Semua data tersimpan lokal di browser (IndexedDB) -- tidak ada server database.

## Halaman

- **index.html** -- Peta Foto Wilayah: unggah foto berGPS (EXIF), otomatis dikelompokkan per wilayah, dengan perkiraan area (buffer radius) dan batas administratif resmi (dari OpenStreetMap Nominatim). Ekspor ke GeoJSON/KML.
- **kawasan.html** -- Peta Kawasan/Zonasi: gambar poligon zona langsung di atas citra satelit, beri nama/warna/kategori, lalu cetak sebagai peta kawasan lengkap dengan kop judul & legenda (mirip peta zonasi Taman Kehati resmi). Ekspor ke GeoJSON/KML/Shapefile untuk QGIS atau Google Earth.

## Menjalankan secara lokal

```bash
python serve.py
```

Lalu buka `http://localhost:8093`.

## Sumber peta

- Peta jalan: OpenStreetMap
- Citra satelit: Esri World Imagery, otomatis memakai rilis [Wayback](https://livingatlas.arcgis.com/wayback/) terbaru yang tersedia
- Batas administratif: OpenStreetMap Nominatim (reverse geocoding)

## Interoperabilitas GIS

Data yang digambar/diunggah bisa diekspor sebagai:
- **GeoJSON** -- format standar, bisa dibuka langsung di [QGIS](https://qgis.org/), [geojson.io](https://geojson.io), atau GIS software lain.
- **KML** -- bisa dibuka di Google Earth / Google Earth Pro.

Import balik ke aplikasi ini belum didukung -- kalau perlu, edit lanjutan disarankan dilakukan di QGIS/Google Earth lalu simpan sebagai file terpisah.
