// The collection: saved variations (settings + thumbnail), kept in the
// browser's IndexedDB so they are there next time. Falls back to
// localStorage where IndexedDB is unavailable.
const DB = 'neuewave-mark', TABLE = 'collection', LS = 'neuewave-mark-collection';

let dbPromise = null;
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB')); return; }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(TABLE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(TABLE, mode);
    const req = fn(t.objectStore(TABLE));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const lsRead = () => { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { return []; } };
const lsWrite = (items) => { try { localStorage.setItem(LS, JSON.stringify(items)); } catch (e) { /* full or blocked */ } };

export const collection = {
  async all() {
    let items;
    try { items = await tx('readonly', (s) => s.getAll()); } catch (e) { items = lsRead(); }
    return (items || []).sort((a, b) => b.created - a.created);
  },
  async put(item) {
    try { await tx('readwrite', (s) => s.put(item)); }
    catch (e) { lsWrite([item, ...lsRead().filter((i) => i.id !== item.id)]); }
  },
  async remove(id) {
    try { await tx('readwrite', (s) => s.delete(id)); }
    catch (e) { lsWrite(lsRead().filter((i) => i.id !== id)); }
  },
};
