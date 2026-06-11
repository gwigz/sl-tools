const DB_NAME = "sl-tools"
const STORE_NAME = "files"

export interface StoredBlob {
  blob: Blob
  name: string
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME)
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase()

  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode)
      const request = action(transaction.objectStore(STORE_NAME))

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}

export function saveBlob(key: string, value: StoredBlob): Promise<IDBValidKey> {
  return withStore("readwrite", (store) => store.put(value, key))
}

export async function loadBlob(key: string): Promise<StoredBlob | null> {
  const value = await withStore<StoredBlob | undefined>("readonly", (store) => store.get(key))

  return value ?? null
}

export function deleteBlob(key: string): Promise<undefined> {
  return withStore("readwrite", (store) => store.delete(key))
}
