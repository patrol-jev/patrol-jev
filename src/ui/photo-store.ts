"use client";

/**
 * 일지에 실린 사진의 **작은 사본**을 이 브라우저에 남긴다. 기간 보고서의 사진 표가 여기서 나온다.
 *
 * **아무 데도 보내지 않는다.** IndexedDB 는 이 기기의 이 브라우저에만 있다. 보내는 코드는 여기에 없다.
 * localStorage 는 몇 MB 가 한계라 사진은 여기에 둔다. 날짜 하나가 열쇠이고, 값은 그날 자리 차례대로
 * 정비 전·후 JPEG 둘씩이다(`SavedSpot` 과 같은 차례). 같은 날짜를 다시 저장하면 덮는다.
 *
 * IndexedDB 가 없거나 막힌 브라우저에서는 조용히 아무것도 안 한다. 그러면 기간 보고서에 사진이 안 붙을 뿐
 * 글과 숫자는 그대로 나온다.
 */

const DB = "patrol-jev";
const STORE = "day-photos";
/** 이보다 오래된 날짜의 사진은 새로 저장할 때 지운다. 한 해치면 넉넉하다. */
const KEEP_DAYS = 400;

export interface DayPhotos {
  date: string;
  items: Array<{ before: Uint8Array | null; after: Uint8Array | null }>;
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "date" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function done<T>(request: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export async function savePhotos(record: DayPhotos): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put(record);
    // 오래된 것은 같이 지운다. 사진이 쌓이기만 하면 언젠가 저장 공간이 거절한다.
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
    const keys = (await done(store.getAllKeys())) ?? [];
    for (const key of keys) if (typeof key === "string" && key < cutoff) store.delete(key);
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
    return true;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

export async function loadPhotos(date: string): Promise<DayPhotos | null> {
  const db = await open();
  if (!db) return null;
  try {
    const found = await done(db.transaction(STORE, "readonly").objectStore(STORE).get(date));
    return found && Array.isArray((found as DayPhotos).items) ? (found as DayPhotos) : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function deletePhotos(date: string): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    await done(db.transaction(STORE, "readwrite").objectStore(STORE).delete(date));
  } catch {
    // 지우지 못해도 도구는 돈다.
  } finally {
    db.close();
  }
}

/** 사진이 남아 있는 날짜들. 내보내기가 무엇을 담을지 볼 때 쓴다. */
export async function listPhotoDates(): Promise<string[]> {
  const db = await open();
  if (!db) return [];
  try {
    const keys = (await done(db.transaction(STORE, "readonly").objectStore(STORE).getAllKeys())) ?? [];
    return keys.filter((key): key is string => typeof key === "string").sort();
  } catch {
    return [];
  } finally {
    db.close();
  }
}
