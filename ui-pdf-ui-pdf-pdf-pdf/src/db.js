(function () {
  "use strict";

  const DB_NAME = "kiroku-db";
  const DB_VERSION = 1;
  const STATE_STORE = "state";
  const ASSET_STORE = "assets";
  const BACKUP_STORE = "backups";
  const STATE_KEY = "app";
  const LEGACY_LOCAL_STORAGE_KEY = "kiroku.local.v1";
  const LEGACY_MIGRATION_FLAG_KEY = "kiroku.local.v1.indexeddbMigratedAt";

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB is not supported in this browser."));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STATE_STORE)) {
          db.createObjectStore(STATE_STORE, { keyPath: "key" });
        }

        if (!db.objectStoreNames.contains(ASSET_STORE)) {
          const assets = db.createObjectStore(ASSET_STORE, { keyPath: "id" });
          assets.createIndex("entryId", "entryId", { unique: false });
          assets.createIndex("createdAt", "createdAt", { unique: false });
        }

        if (!db.objectStoreNames.contains(BACKUP_STORE)) {
          db.createObjectStore(BACKUP_STORE, { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        console.warn("IndexedDB upgrade is blocked by another open tab.");
      };
    });

    return dbPromise;
  }

  function withStore(storeName, mode, action) {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const transaction = db.transaction(storeName, mode);
          const store = transaction.objectStore(storeName);
          let actionResult;

          transaction.oncomplete = () => resolve(actionResult);
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);

          actionResult = action(store);
        })
    );
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function readStateRecord() {
    return withStore(STATE_STORE, "readonly", (store) => requestToPromise(store.get(STATE_KEY)));
  }

  async function writeState(state) {
    const record = {
      key: STATE_KEY,
      value: state,
      updatedAt: new Date().toISOString(),
    };

    await withStore(STATE_STORE, "readwrite", (store) => requestToPromise(store.put(record)));
    return record.value;
  }

  function readLegacyLocalStorage() {
    try {
      const raw = localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.warn("Failed to read legacy localStorage data.", error);
      return null;
    }
  }

  function markLegacyMigrated() {
    try {
      localStorage.setItem(LEGACY_MIGRATION_FLAG_KEY, new Date().toISOString());
    } catch (error) {
      console.warn("Failed to mark legacy migration.", error);
    }
  }

  async function loadState() {
    const record = await readStateRecord();
    if (record && record.value) {
      return {
        state: record.value,
        source: "indexeddb",
        migrated: false,
      };
    }

    const legacyState = readLegacyLocalStorage();
    if (legacyState) {
      await writeState(legacyState);
      markLegacyMigrated();

      return {
        state: legacyState,
        source: "localStorage",
        migrated: true,
      };
    }

    return {
      state: null,
      source: "empty",
      migrated: false,
    };
  }

  async function saveState(state) {
    return writeState(state);
  }

  async function saveStateAndAssets(state, assets = []) {
    const db = await openDb();
    const record = {
      key: STATE_KEY,
      value: state,
      updatedAt: new Date().toISOString(),
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STATE_STORE, ASSET_STORE], "readwrite");
      const stateStore = transaction.objectStore(STATE_STORE);
      const assetStore = transaction.objectStore(ASSET_STORE);

      transaction.oncomplete = () => resolve(record.value);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction was aborted."));

      stateStore.put(record);
      for (const asset of assets) assetStore.put(asset);
    });
  }

  async function getAsset(assetId) {
    return withStore(ASSET_STORE, "readonly", (store) => requestToPromise(store.get(assetId)));
  }

  async function exportData() {
    const record = await readStateRecord();
    return {
      exportedAt: new Date().toISOString(),
      dbName: DB_NAME,
      dbVersion: DB_VERSION,
      state: record?.value || null,
    };
  }

  async function replaceState(state) {
    await writeState(state);
    return state;
  }

  window.KirokuDB = {
    DB_NAME,
    DB_VERSION,
    loadState,
    saveState,
    saveStateAndAssets,
    getAsset,
    exportData,
    replaceState,
  };
})();
