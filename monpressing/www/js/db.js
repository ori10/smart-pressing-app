// Stockage local (IndexedDB) : toutes les données restent dans le téléphone.
const DB_NAME = 'monpressing';
const DB_VERSION = 1;
let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('articles')) db.createObjectStore('articles', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('orders')) {
        const s = db.createObjectStore('orders', { keyPath: 'number' });
        s.createIndex('status', 'status');
        s.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('expenses')) {
        const s = db.createObjectStore('expenses', { keyPath: 'id', autoIncrement: true });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export const db = {
  open,
  async get(name, key) { return wrap((await store(name)).get(key)); },
  async all(name) { return wrap((await store(name)).getAll()); },
  async put(name, value, key) {
    const s = await store(name, 'readwrite');
    return wrap(key === undefined ? s.put(value) : s.put(value, key));
  },
  async del(name, key) { return wrap((await store(name, 'readwrite')).delete(key)); },
  async keys(name) { return wrap((await store(name)).getAllKeys()); },
  async clear(name) { return wrap((await store(name, 'readwrite')).clear()); },
  async count(name) { return wrap((await store(name)).count()); },
  async byIndex(name, index, value) { return wrap((await store(name)).index(index).getAll(value)); },
  async kv(key, value) {
    if (value === undefined) return this.get('kv', key);
    return this.put('kv', value, key);
  },
};
