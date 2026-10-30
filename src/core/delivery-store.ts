import { RecoveryOptions } from "../typings/options";

export interface StoredEvent {
  id: string;
  scope: string;
  payload: string;
  bytes: number;
  createdAt: number;
  kind: "event" | "snapshot";
  tabId?: string;
  ownerId?: string;
}

// Cross-document ownership of ordinary events. `gone` holds owners whose Web Lock
// was free when probed; `active` holds ids this document is delivering right now.
export interface RecoveryOwnership {
  gone: Set<string>;
  active: Set<string>;
  claim: boolean;
}

export class DeliveryStore {
  private readonly maxEvents: number;
  private readonly maxBytes: number;
  private readonly maxAgeMs: number;

  constructor(private readonly scope: string, options: RecoveryOptions = {}) {
    const limit = (value: number | undefined, fallback: number) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : fallback;
    this.maxEvents = limit(options.maxEvents, 100);
    this.maxBytes = limit(options.maxBytes, 1024 * 1024);
    this.maxAgeMs = limit(options.maxAgeMs, 24 * 60 * 60 * 1000);
  }

  // Every read/modify/write, including promotion and eviction, commits atomically.
  // A blocked/unavailable database must not hold up application reporting.
  private transact<T>(update: (rows: StoredEvent[], store: IDBObjectStore) => T): Promise<T> {
    return new Promise((resolve, reject) => {
      let db: IDBDatabase | undefined;
      let tx: IDBTransaction | undefined;
      let settled = false;
      const finish = (error?: unknown, value?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        db?.close();
        if (error) reject(error);
        else resolve(value as T);
      };
      const timer = setTimeout(() => {
        try { tx?.abort(); } catch { /* Already completed. */ }
        finish(new Error("Delivery storage timed out"));
      }, 2000);
      try {
        const request = indexedDB.open("tc-tracker-delivery", 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore("events", { keyPath: ["scope", "id"] });
          store.createIndex("scope", "scope");
        };
        request.onerror = () => finish(request.error || new Error("Delivery storage unavailable"));
        request.onblocked = () => finish(new Error("Delivery storage blocked"));
        request.onsuccess = () => {
          db = request.result;
          if (settled) { db.close(); return; }
          try {
            tx = db.transaction("events", "readwrite");
            const store = tx.objectStore("events");
            let value: T;
            tx.oncomplete = () => finish(undefined, value);
            tx.onabort = tx.onerror = () => finish(tx?.error || new Error("Delivery transaction aborted"));
            const rows = store.index("scope").getAll(this.scope);
            rows.onsuccess = () => {
              try {
                value = update(rows.result as StoredEvent[], store);
              } catch (error) {
                tx?.abort();
                finish(error);
              }
            };
          } catch (error) { finish(error); }
        };
      } catch (error) { finish(error); }
    });
  }

  private prune(rows: StoredEvent[], store: IDBObjectStore): StoredEvent[] {
    const now = Date.now();
    const alive = rows.filter((row) => {
      if (now - row.createdAt < this.maxAgeMs && row.bytes <= this.maxBytes) return true;
      store.delete([this.scope, row.id]);
      return false;
    }).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    let bytes = alive.reduce((total, row) => total + row.bytes, 0);
    let removed = 0;
    while (alive.length - removed > this.maxEvents || bytes > this.maxBytes) {
      const row = alive[removed++];
      bytes -= row.bytes;
      store.delete([this.scope, row.id]);
    }
    return alive.slice(removed);
  }

  put(row: StoredEvent, isCurrent?: () => boolean): Promise<boolean> {
    return this.transact((rows, store) => {
      if (isCurrent && !isCurrent()) return false;
      store.put(row);
      const retained = this.prune([...rows.filter((item) => item.id !== row.id), row], store);
      return retained.some((item) => item.id === row.id);
    });
  }

  remove(id: string, isCurrent?: () => boolean): Promise<void> {
    return this.transact((_rows, store) => {
      if (!isCurrent || isCurrent()) store.delete([this.scope, id]);
    });
  }

  // Distinct foreign owners of ordinary events, so the caller can probe their locks.
  owners(ownerId?: string): Promise<string[]> {
    return this.transact((rows, store) => {
      const owners = new Set<string>();
      for (const row of this.prune(rows, store)) {
        if (!row.tabId && row.ownerId && row.ownerId !== ownerId) owners.add(row.ownerId);
      }
      return [...owners];
    });
  }

  // Eligibility is re-checked inside the transaction, so two documents racing to
  // recover the same dead owner's rows cannot both claim them.
  recover(tabId?: string, ownerId?: string, ownership?: RecoveryOwnership): Promise<StoredEvent[]> {
    return this.transact((rows, store) => {
      const retained = this.prune(rows, store);
      const events: StoredEvent[] = [];
      for (const row of retained) {
        if (row.tabId) {
          // Snapshot-origin rows (promoted or not) stay gated by tab and monitoring opt-in.
          if (!tabId || row.tabId !== tabId || row.ownerId === ownerId) continue;
          if (row.kind === "snapshot") {
            row.kind = "event";
            store.put(row);
          }
        } else {
          if (row.ownerId) {
            const recoverable = row.ownerId === ownerId
              ? !!ownership && !ownership.active.has(row.id)
              : !!ownership?.gone.has(row.ownerId);
            if (!recoverable) continue;
          }
          if (ownership?.claim && ownerId && row.ownerId !== ownerId) {
            row.ownerId = ownerId;
            store.put(row);
          }
        }
        ownership?.active.add(row.id);
        events.push(row);
      }
      return events;
    });
  }
}
