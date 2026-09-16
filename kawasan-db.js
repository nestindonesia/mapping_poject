// Penyimpanan lokal (IndexedDB) untuk peta kawasan/zonasi -- terpisah dari
// database titik foto (db.js).

const DB_NAME = "peta_kawasan_db";
const DB_VERSION = 1;
const ZONA_STORE = "zona";
const KAWASAN_STORE = "kawasan_info";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(ZONA_STORE)) {
        db.createObjectStore(ZONA_STORE, { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(KAWASAN_STORE)) {
        db.createObjectStore(KAWASAN_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

function tx(store, mode) {
  return openDb().then((db) => db.transaction(store, mode).objectStore(store));
}

export async function addZona(zona) {
  const store = await tx(ZONA_STORE, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.add(zona);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function updateZona(zona) {
  const store = await tx(ZONA_STORE, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(zona);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteZona(id) {
  const store = await tx(ZONA_STORE, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getAllZona() {
  const store = await tx(ZONA_STORE, "readonly");
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function clearAllZona() {
  const store = await tx(ZONA_STORE, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function saveKawasanInfo(info) {
  const store = await tx(KAWASAN_STORE, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put({ key: "main", ...info });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getKawasanInfo() {
  const store = await tx(KAWASAN_STORE, "readonly");
  return new Promise((resolve, reject) => {
    const req = store.get("main");
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
