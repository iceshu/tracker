import { Global } from "./global";
import { generateUUID, getLocationHref, isEmpty } from "../utils";
import { EVENT_TYPE, SDK } from "./constant";
import { Breadcrumb } from "./breadcrumb";
import { ISendData, ReportData } from "./typing";
import { IPluginParams } from "../plugins/common";
import { IOptionsParams } from "../typings/options";
import { SessionManager } from "./session-manager";
import { DeliveryStore, RecoveryOwnership, StoredEvent } from "./delivery-store";

const MAX_IN_FLIGHT = 4;
const REQUEST_TIMEOUT_MS = 10_000;
// Browsers cap the summed bodies of in-flight keepalive requests per document at 64 KiB.
const KEEPALIVE_QUOTA_BYTES = 64 * 1024;
let keepaliveBytesInFlight = 0;

interface PageIdentity {
  ownerId: string;
  // Held for the document's life; a free owner lock means its stored events are orphaned.
  owner: Promise<boolean>;
  // Event ids this document is posting, shared by every controller in it.
  active: Set<string>;
  snapshotId: string;
  snapshotRevisions: Map<string, number>;
  tab: Promise<{ id: string; canRecover: boolean } | undefined>;
}

const ownerLockPrefix = "tc-tracker.delivery-owner:";

// Shared by every controller (and SDK copy) in this document, never by a new page.
const pageIdentityKey = Symbol.for("tc-tracker.delivery-page");
function getPageIdentity(): PageIdentity {
  const page = document as Document & { [pageIdentityKey]?: PageIdentity };
  if (page[pageIdentityKey]) return page[pageIdentityKey]!;
  const identity: PageIdentity = {
    ownerId: generateUUID(),
    owner: Promise.resolve(false),
    active: new Set(),
    snapshotId: generateUUID(),
    snapshotRevisions: new Map(),
    tab: Promise.resolve(undefined),
  };
  page[pageIdentityKey] = identity;
  const acquireOwner = (): Promise<boolean> => new Promise((resolve) => {
    try {
      if (typeof navigator.locks?.request !== "function") { resolve(false); return; }
      void navigator.locks.request(`${ownerLockPrefix}${identity.ownerId}`, (lock) => {
        resolve(!!lock);
        return new Promise<void>((release) => {
          window.addEventListener("pagehide", () => release(), { once: true });
        });
      }).catch(() => resolve(false));
    } catch { resolve(false); }
  });
  identity.owner = acquireOwner();
  window.addEventListener("pageshow", (event) => {
    if ((event as PageTransitionEvent).persisted) identity.owner = acquireOwner();
  });
  // Frames share sessionStorage with the top page but must not replace its tab token.
  if (window.top !== window) return identity;
  const acquireTab = (): PageIdentity["tab"] => new Promise((resolve) => {
    try {
      if (typeof navigator.locks?.request !== "function") { resolve(undefined); return; }
      const key = "tc-tracker.delivery-tab";
      let id = sessionStorage.getItem(key) || generateUUID();
      sessionStorage.setItem(key, id);
      const claim = (tabId: string, recover: boolean, canRekey = true) => {
        void navigator.locks.request(`tc-tracker.delivery-tab:${tabId}`, { ifAvailable: true }, (lock) => {
          if (!lock) {
            if (!canRekey) { resolve(undefined); return; }
            id = generateUUID();
            try { sessionStorage.setItem(key, id); } catch { resolve(undefined); return; }
            claim(id, false, false);
            return;
          }
          resolve({ id: tabId, canRecover: recover });
          // Keep the tab identity exclusive while its document is alive.
          return new Promise<void>((release) => {
            window.addEventListener("pagehide", () => release(), { once: true });
          });
        }).catch(() => resolve(undefined));
      };
      claim(id, true);
    } catch { resolve(undefined); }
  });
  identity.tab = acquireTab();
  window.addEventListener("pageshow", (event) => {
    if (!(event as PageTransitionEvent).persisted) return;
    // A cached page may resume after its old snapshot was already delivered.
    // Treat resumed sampling as a new snapshot lifetime and reclaim the tab lock.
    identity.snapshotId = generateUUID();
    identity.tab = acquireTab();
  });
  return identity;
}

export class ReportDataController {
  apikey = "";
  dsn = "";
  userId = "";
  uuid: string;
  beforeDataReport: any;
  getUserId: any;
  breadcrumb: Breadcrumb;
  options: IOptionsParams;
  baseDeviceInfo = {};
  private readonly store?: DeliveryStore;
  private readonly scope: string;
  private readonly page?: PageIdentity;
  private storageWork: Promise<unknown> = Promise.resolve();
  private running = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly deliveries = new Map<string, Promise<boolean>>();
  private recoveryStarted = false;
  private stopped = false;
  private readonly abortRequests = new Set<() => void>();
  private readonly pendingPreparations = new Set<() => void>();
  private readonly recoveredListeners = new Set<(data: ReportData) => void>();

  constructor(params: Omit<IPluginParams, "reportData">) {
    const { options, breadcrumb, baseDeviceInfo } = params;
    this.breadcrumb = breadcrumb;
    this.uuid = generateUUID();
    this.dsn = options.dsn;
    this.apikey = options.apikey || "";
    this.options = options;
    this.getUserId = options.getUserId;
    this.baseDeviceInfo = baseDeviceInfo;
    this.beforeDataReport = options.beforeDataReport;
    this.scope = JSON.stringify([this.dsn, this.apikey]);
    if (options.recovery?.enabled !== false) {
      this.store = new DeliveryStore(this.scope, options.recovery);
      try { this.page = getPageIdentity(); } catch { /* No browser document context. */ }
    }
  }

  // Queue recovery before plugins can save/send. The predicate runs after registration.
  startRecovery(restoreDiagnostics: boolean | (() => boolean) = false): void {
    if (!this.store || this.recoveryStarted || this.stopped || !this.dsn) return;
    this.recoveryStarted = true;
    this.storageWork = this.storageWork.then(async () => {
      const enabled = typeof restoreDiagnostics === "function" ? restoreDiagnostics() : restoreDiagnostics;
      const tab = enabled && this.options.memoryMonitor?.enabled
        ? await this.page?.tab : undefined;
      if (this.stopped) return;
      const ownership = await this.probeOwnership();
      if (this.stopped) return;
      const rows = await this.store!.recover(tab?.canRecover ? tab.id : undefined, this.page?.ownerId, ownership);
      for (const row of rows) {
        void this.deliver(row, () => {
          let data: ReportData;
          try { data = JSON.parse(row.payload); } catch { return; }
          for (const listener of this.recoveredListeners) {
            try { listener(data); } catch { /* Observers must not affect delivery. */ }
          }
        });
      }
    }).catch(() => { /* Recovery is best effort; new events still send. */ });
  }

  // Owners whose lock is free have left; their rows are orphans this document may claim.
  private async probeOwnership(): Promise<RecoveryOwnership | undefined> {
    const page = this.page;
    if (!page || !(await page.owner)) return;
    const gone = new Set<string>();
    for (const owner of await this.store!.owners(page.ownerId)) {
      if (this.stopped) return;
      try {
        const free = await navigator.locks.request(`${ownerLockPrefix}${owner}`, { ifAvailable: true }, (lock) => !!lock);
        if (free) gone.add(owner);
      } catch { /* Unknown liveness: leave the rows to their owner. */ }
    }
    return { gone, active: page.active, claim: true };
  }

  onRecoveredReport(listener: (data: ReportData) => void): () => void {
    if (!this.stopped) this.recoveredListeners.add(listener);
    return () => { this.recoveredListeners.delete(listener); };
  }

  getAuthInfo() {
    return {
      userId: this.userId || this.getAuthId() || "",
      sdkVersion: SDK.VERSION,
      apikey: this.apikey,
    };
  }

  getAuthId(): string | number {
    if (typeof this.getUserId === "function") {
      const id = this.getUserId();
      if (typeof id === "string" || typeof id === "number") return id;
      console.error(`userId: ${id} 期望 string 或 number 类型，但是传入 ${typeof id}`);
    }
    return "";
  }

  getTransportData(data: any): ReportData {
    const info = {
      ...data,
      userInfo: this.getAuthInfo(),
      uuid: this.uuid,
      apiKey: this.apikey,
      appVersion: this.options.appVersion,
      pageUrl: getLocationHref(),
      deviceInfo: Global.deviceInfo,
      sessionID: SessionManager.getSessionId(),
    };
    if (![EVENT_TYPE.PERFORMANCE, EVENT_TYPE.RECORDSCREEN, EVENT_TYPE.WHITESCREEN].includes(data.type)) {
      info.breadcrumb = this.breadcrumb.getStack();
    }
    return info;
  }

  isSdkTransportUrl(targetUrl: string): boolean {
    return !!(this.dsn && targetUrl.includes(this.dsn));
  }

  isFilterHttpUrl(url: string): boolean {
    return Boolean(this.options.filterXhrUrlRegExp?.test(url));
  }

  private prepare(data: ISendData, id: string): Promise<StoredEvent | undefined> {
    return new Promise((resolve) => {
      const finish = (row?: StoredEvent) => {
        this.pendingPreparations.delete(cancel);
        resolve(row);
      };
      const cancel = () => finish();
      this.pendingPreparations.add(cancel);
      const freeze = (value: ReportData | false | null | undefined) => {
        if (!value || this.stopped) { finish(); return; }
        const payload = JSON.stringify({ ...value, eventId: id });
        finish({ id, scope: this.scope, payload, bytes: new Blob([payload]).size, createdAt: Date.now(), kind: "event" });
      };
      try {
        // Hooks receive original types and may sanitize cycles/BigInt before JSON.
        // Synchronous hooks freeze immediately; async hooks never occupy storageWork.
        const context = { ...this.getTransportData(data), eventId: id };
        const filtered = typeof this.beforeDataReport === "function"
          ? this.beforeDataReport(context) : context;
        if (filtered && typeof filtered.then === "function") {
          void Promise.resolve(filtered).then(freeze).catch(() => finish());
        } else {
          freeze(filtered);
        }
      } catch { finish(); }
    });
  }

  async send(data: ISendData): Promise<boolean> {
    if (this.stopped || isEmpty(this.dsn)) return false;
    try {
      const row = await this.prepare(data, generateUUID());
      if (!row) return false;
      const work = this.storageWork.then(async () => {
        if (this.store) {
          // Mark before the write so a sibling controller's recovery skips this row.
          this.page?.active.add(row.id);
          try {
            if (this.page && (await this.page.owner)) row.ownerId = this.page.ownerId;
            await this.store.put(row);
          } catch { /* Fall back to immediate delivery. */ }
        }
        return { delivery: this.deliver(row) };
      });
      this.storageWork = work.catch(() => {});
      const { delivery } = await work;
      return delivery ? await delivery : false;
    } catch { return false; }
  }

  async saveDiagnosticSnapshot(data: ISendData): Promise<void> {
    if (!this.store || !this.page || this.stopped || !this.dsn) return;
    const { snapshotId, ownerId, tab: identity } = this.page;
    const revision = (this.page.snapshotRevisions.get(this.scope) || 0) + 1;
    this.page.snapshotRevisions.set(this.scope, revision);
    const row = await this.prepare(data, snapshotId);
    const tab = await identity;
    const isCurrent = () => this.page!.snapshotId === snapshotId && this.page!.snapshotRevisions.get(this.scope) === revision;
    if (this.stopped || !isCurrent()) return;
    const work = this.storageWork.then(async () => {
      if (!isCurrent()) return;
      if (!row || row.bytes > 64 * 1024 || !tab) {
        await this.store!.remove(snapshotId, isCurrent);
        return;
      }
      row.kind = "snapshot";
      row.tabId = tab.id;
      row.ownerId = ownerId;
      await this.store!.put(row, isCurrent);
    });
    this.storageWork = work.catch(() => {});
    await this.storageWork;
  }

  async clearDiagnosticSnapshot(): Promise<void> {
    if (!this.store || !this.page) return;
    const snapshotId = this.page.snapshotId;
    const revision = (this.page.snapshotRevisions.get(this.scope) || 0) + 1;
    this.page.snapshotRevisions.set(this.scope, revision);
    const isCurrent = () => this.page!.snapshotId === snapshotId && this.page!.snapshotRevisions.get(this.scope) === revision;
    this.storageWork = this.storageWork.then(() => this.store!.remove(snapshotId, isCurrent)).catch(() => {});
    await this.storageWork;
  }

  private deliver(row: StoredEvent, onConfirmed?: () => void): Promise<boolean> {
    const existing = this.deliveries.get(row.id);
    if (existing) return existing;
    const result = this.acquireSlot().then(async () => {
      try {
        if (this.stopped) return false;
        const confirmed = await this.post(row);
        if (this.stopped) return false;
        if (confirmed) onConfirmed?.();
        if (this.stopped) return false;
        if (confirmed && this.store) {
          try { await this.store.remove(row.id); } catch { /* Keep stable id for replay if deletion fails. */ }
        }
        return confirmed;
      } finally {
        this.releaseSlot();
      }
    }).catch(() => false);
    this.deliveries.set(row.id, result);
    void result.then(() => {
      this.deliveries.delete(row.id);
      this.page?.active.delete(row.id);
    });
    return result;
  }

  // Bounded parallelism: one slow request must not hold every later event.
  private acquireSlot(): Promise<void> {
    if (this.running < MAX_IN_FLIGHT) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private releaseSlot(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.running--;
  }

  private post(row: StoredEvent): Promise<boolean> {
    return new Promise((resolve) => {
      const controller = typeof AbortController === "function" ? new AbortController() : undefined;
      // keepalive lets the request outlive pagehide, within the per-document body quota.
      const keepalive = keepaliveBytesInFlight + row.bytes <= KEEPALIVE_QUOTA_BYTES;
      if (keepalive) keepaliveBytesInFlight += row.bytes;
      let settled = false;
      const finish = (success: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (keepalive) keepaliveBytesInFlight -= row.bytes;
        this.abortRequests.delete(cancel);
        resolve(success);
      };
      const cancel = () => { finish(false); controller?.abort(); };
      const timer = setTimeout(cancel, REQUEST_TIMEOUT_MS);
      this.abortRequests.add(cancel);
      try {
        void fetch(this.dsn, {
          method: "POST",
          body: row.payload,
          headers: { "Content-Type": "application/json" },
          keepalive,
          signal: controller?.signal,
        }).then((response) => finish(response.ok), () => finish(false));
      } catch { finish(false); }
    });
  }

  destroy(): void {
    this.stopped = true;
    this.recoveredListeners.clear();
    for (const cancel of this.pendingPreparations) cancel();
    for (const cancel of [...this.abortRequests]) cancel();
  }
}
