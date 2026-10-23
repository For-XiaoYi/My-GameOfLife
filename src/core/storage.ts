/**
 * 存档仓库：优先用 IndexedDB（容量大、能直接存 TypedArray）；
 * 在 file:// 或隐私模式下 IndexedDB 可能不可用，自动退回 localStorage。
 */
import type { EdgeMode } from './world.ts';
import type { CustomPatternRecord, LibraryConfig } from './library.ts';

export interface ViewState {
  scale: number;
  ox: number;
  oy: number;
}

export interface SnapshotRecord {
  id: string;
  name: string;
  created: number;
  gen: number;
  population: number;
  edge: EdgeMode;
  width: number;
  height: number;
  packed: Uint8Array;
  view: ViewState;
  thumb: string;
}

export interface ClipRecord {
  id: string;
  name: string;
  created: number;
  width: number;
  height: number;
  startGen: number;
  endGen: number;
  startPacked: Uint8Array;
  startPopulation: number;
  deltas: Int32Array[];
  thumb: string;
}

export interface AutoSaveRecord {
  width: number;
  height: number;
  gen: number;
  population: number;
  edge: EdgeMode;
  packed: Uint8Array;
  view: ViewState;
  savedAt: number;
}

const DB_NAME = 'life-studio';
const DB_VERSION = 2;
const STORE_SNAPSHOTS = 'snapshots';
const STORE_CLIPS = 'clips';
const STORE_PATTERNS = 'patterns';
const STORE_META = 'meta';
const LS_PREFIX = 'life-studio:';
// 记住上次用的是哪种存储：file:// 下 indexedDB 时好时坏，
// 每次启动重新赌一次会让界面里存的东西在两种存储之间「消失」
const MODE_KEY = LS_PREFIX + 'storage-mode';

export function uid(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function bytesToB64(a: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < a.length; i += chunk) {
    s += String.fromCharCode.apply(null, Array.from(a.subarray(i, i + chunk)));
  }
  return btoa(s);
}

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function i32ToB64(a: Int32Array): string {
  return bytesToB64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
}

function b64ToI32(s: string): Int32Array {
  const bytes = b64ToBytes(s);
  return new Int32Array(bytes.buffer, 0, bytes.byteLength >> 2);
}

export class Store {
  mode: 'idb' | 'local' = 'local';
  available = true;
  private db: IDBDatabase | null = null;

  /**
   * 选定一种存储后就不再变：
   * file:// 下 Chrome 的 indexedDB 有时秒开、有时永远不回调，
   * 如果每次启动都重新赌一次，界面里存的东西会在两种存储之间「消失」。
   */
  private rememberMode(mode: 'idb' | 'local'): void {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* 隐私模式下可能写不了，忽略 */
    }
  }

  private hasLocalData(): boolean {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(LS_PREFIX)) continue;
        if (k === MODE_KEY) continue;
        return true;
      }
    } catch {
      /* 读不了就当没有 */
    }
    return false;
  }

  async init(): Promise<void> {
    // 1) 上次已经定过存储方式，沿用，保证前后两次读到的是同一份数据
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(MODE_KEY);
    } catch {
      remembered = null;
    }
    if (remembered === 'local') {
      this.useLocal();
      return;
    }

    if (typeof indexedDB !== 'undefined') {
      try {
        this.db = await Promise.race([
          new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
              const db = req.result;
              if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id' });
              if (!db.objectStoreNames.contains(STORE_CLIPS)) db.createObjectStore(STORE_CLIPS, { keyPath: 'id' });
              if (!db.objectStoreNames.contains(STORE_PATTERNS)) db.createObjectStore(STORE_PATTERNS, { keyPath: 'id' });
              if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
            req.onblocked = () => reject(new Error('indexedDB blocked'));
          }),
          // file:// 下 Chrome 的 indexedDB 可能永远不回调，超时后直接退回 localStorage
          new Promise<IDBDatabase>((_, reject) =>
            window.setTimeout(() => reject(new Error('indexedDB timeout')), 3000),
          ),
        ]);
        // 老版本可能已经把数据写在 localStorage 里：那份数据在 idb 里看不见，
        // 这种情况继续用 localStorage，别让人以为存档丢了
        if (!remembered && this.hasLocalData()) {
          this.useLocal();
          return;
        }
        this.mode = 'idb';
        this.rememberMode('idb');
        return;
      } catch {
        this.db = null;
      }
    }
    this.useLocal();
  }

  private useLocal(): void {
    this.db = null;
    // 先做一次读写自检
    try {
      localStorage.setItem(LS_PREFIX + 'probe', '1');
      localStorage.removeItem(LS_PREFIX + 'probe');
      this.mode = 'local';
      this.rememberMode('local');
    } catch {
      this.mode = 'local';
      this.available = false;
    }
  }

  get persistent(): boolean {
    return this.available;
  }

  // ---------------- 快照 ----------------

  async listSnapshots(): Promise<SnapshotRecord[]> {
    if (this.mode === 'idb' && this.db) {
      const rows = await this.idbAll<SnapshotRecord>(STORE_SNAPSHOTS);
      return rows.sort((a, b) => b.created - a.created);
    }
    return this.localAll<SnapshotRecord>('snapshot').sort((a, b) => b.created - a.created);
  }

  async saveSnapshot(rec: SnapshotRecord): Promise<void> {
    if (this.mode === 'idb' && this.db) {
      await this.idbPut(STORE_SNAPSHOTS, rec);
      return;
    }
    this.localPut('snapshot', rec.id, {
      ...rec,
      packed: bytesToB64(rec.packed),
    });
  }

  async deleteSnapshot(id: string): Promise<void> {
    if (this.mode === 'idb' && this.db) {
      await this.idbDelete(STORE_SNAPSHOTS, id);
      return;
    }
    localStorage.removeItem(LS_PREFIX + 'snapshot:' + id);
  }

  // ---------------- 片段 ----------------

  async listClips(): Promise<ClipRecord[]> {
    if (this.mode === 'idb' && this.db) {
      const rows = await this.idbAll<ClipRecord>(STORE_CLIPS);
      return rows.sort((a, b) => b.created - a.created);
    }
    return this.localAll<ClipRecord>('clip').sort((a, b) => b.created - a.created);
  }

  async saveClip(rec: ClipRecord): Promise<void> {
    if (this.mode === 'idb' && this.db) {
      await this.idbPut(STORE_CLIPS, rec);
      return;
    }
    this.localPut('clip', rec.id, {
      ...rec,
      startPacked: bytesToB64(rec.startPacked),
      deltas: rec.deltas.map(i32ToB64),
    });
  }

  async deleteClip(id: string): Promise<void> {
    if (this.mode === 'idb' && this.db) {
      await this.idbDelete(STORE_CLIPS, id);
      return;
    }
    localStorage.removeItem(LS_PREFIX + 'clip:' + id);
  }

  // ---------------- 自动存档 ----------------

  async getAutoSave(): Promise<AutoSaveRecord | null> {
    if (this.mode === 'idb' && this.db) {
      const row = await this.idbGet<{ key: string; value: AutoSaveRecord }>(STORE_META, 'autosave');
      return row?.value ?? null;
    }
    const raw = localStorage.getItem(LS_PREFIX + 'meta:autosave');
    if (!raw) return null;
    try {
      const v = JSON.parse(raw) as Omit<AutoSaveRecord, 'packed'> & { packed: string };
      return { ...v, packed: b64ToBytes(v.packed) };
    } catch {
      return null;
    }
  }

  async setAutoSave(rec: AutoSaveRecord): Promise<void> {
    if (this.mode === 'idb' && this.db) {
      await this.idbPut(STORE_META, { key: 'autosave', value: rec });
      return;
    }
    this.localSetRaw('meta:autosave', JSON.stringify({ ...rec, packed: bytesToB64(rec.packed) }));
  }

  async clearAutoSave(): Promise<void> {
    if (this.mode === 'idb' && this.db) {
      await this.idbDelete(STORE_META, 'autosave');
      return;
    }
    localStorage.removeItem(LS_PREFIX + 'meta:autosave');
  }

  // ---------------- 自定义图案 / 图案库配置 ----------------

  async listCustomPatterns(): Promise<CustomPatternRecord[]> {
    if (this.mode === 'idb' && this.db) {
      const rows = await this.idbAll<CustomPatternRecord>(STORE_PATTERNS);
      return rows.sort((a, b) => a.created - b.created);
    }
    return this.localAll<CustomPatternRecord>('pattern').sort((a, b) => a.created - b.created);
  }

  async saveCustomPattern(rec: CustomPatternRecord): Promise<void> {
    if (this.mode === 'idb' && this.db) {
      await this.idbPut(STORE_PATTERNS, rec);
      return;
    }
    this.localPut('pattern', rec.id, rec);
  }

  async deleteCustomPattern(id: string): Promise<void> {
    if (this.mode === 'idb' && this.db) {
      await this.idbDelete(STORE_PATTERNS, id);
      return;
    }
    localStorage.removeItem(LS_PREFIX + 'pattern:' + id);
  }

  async getLibraryConfig(): Promise<LibraryConfig | null> {
    if (this.mode === 'idb' && this.db) {
      const row = await this.idbGet<{ key: string; value: LibraryConfig }>(STORE_META, 'library');
      return row?.value ?? null;
    }
    const raw = localStorage.getItem(LS_PREFIX + 'meta:library');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as LibraryConfig;
    } catch {
      return null;
    }
  }

  async setLibraryConfig(cfg: LibraryConfig): Promise<void> {
    if (this.mode === 'idb' && this.db) {
      await this.idbPut(STORE_META, { key: 'library', value: cfg });
      return;
    }
    this.localSetRaw('meta:library', JSON.stringify(cfg));
  }

  // ---------------- 底层 ----------------

  private idbAll<T>(store: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as T[]);
      req.onerror = () => reject(req.error);
    });
  }

  private idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  private idbPut<T>(store: string, value: T): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(store, 'readwrite');
      tx.objectStore(store).put(value as unknown as object);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  private idbDelete(store: string, key: IDBValidKey): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private localIndexOf(kind: string): string[] {
    const out: string[] = [];
    const prefix = LS_PREFIX + kind + ':';
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
    return out;
  }

  private localAll<T>(kind: string): T[] {
    const out: T[] = [];
    for (const k of this.localIndexOf(kind)) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      try {
        const v = JSON.parse(raw) as Record<string, unknown>;
        if (kind === 'snapshot') v.packed = b64ToBytes(v.packed as string);
        if (kind === 'clip') {
          v.startPacked = b64ToBytes(v.startPacked as string);
          v.deltas = (v.deltas as string[]).map(b64ToI32);
        }
        out.push(v as T);
      } catch {
        /* 忽略坏数据 */
      }
    }
    return out;
  }

  private localPut(kind: string, id: string, value: unknown): void {
    this.localSetRaw(kind + ':' + id, JSON.stringify(value));
  }

  private localSetRaw(key: string, json: string): void {
    try {
      localStorage.setItem(LS_PREFIX + key, json);
    } catch {
      this.available = false;
      throw new Error('本地存储空间不足，导出成文件更保险');
    }
  }
}
