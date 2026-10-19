import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// SecureStore rejects values larger than ~2048 bytes, and a Supabase session
// (access + refresh token + user JSON) is usually bigger than that. So native
// values are split into numbered chunks and reassembled on read.
const CHUNK_SIZE = 1800;

function chunkKeys(key: string, count: number) {
  return Array.from({ length: count }, (_, i) => `${key}.${i}`);
}

async function nativeGetItem(key: string): Promise<string | null> {
  const rawCount = await SecureStore.getItemAsync(`${key}.count`);
  if (rawCount === null) {
    // Older/short values were written directly under the plain key.
    return SecureStore.getItemAsync(key);
  }

  const count = Number.parseInt(rawCount, 10);
  if (!Number.isFinite(count) || count <= 0) return null;

  let value = '';
  for (const chunkKey of chunkKeys(key, count)) {
    const part = await SecureStore.getItemAsync(chunkKey);
    if (part === null) return null;
    value += part;
  }
  return value;
}

async function nativeSetItem(key: string, value: string): Promise<void> {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    chunks.push(value.slice(i, i + CHUNK_SIZE));
  }

  const previous = await SecureStore.getItemAsync(`${key}.count`);
  await SecureStore.setItemAsync(`${key}.count`, String(chunks.length));
  for (let i = 0; i < chunks.length; i += 1) {
    await SecureStore.setItemAsync(`${key}.${i}`, chunks[i]);
  }

  // Clean up leftover chunks from a previously longer value.
  const previousCount = previous ? Number.parseInt(previous, 10) : 0;
  for (let i = chunks.length; i < previousCount; i += 1) {
    await SecureStore.deleteItemAsync(`${key}.${i}`);
  }

  // Never leave a legacy plain-key copy behind.
  await SecureStore.deleteItemAsync(key).catch(() => {});
}

async function nativeRemoveItem(key: string): Promise<void> {
  const rawCount = await SecureStore.getItemAsync(`${key}.count`);
  const count = rawCount ? Number.parseInt(rawCount, 10) : 0;
  for (const chunkKey of chunkKeys(key, count)) {
    await SecureStore.deleteItemAsync(chunkKey);
  }
  await SecureStore.deleteItemAsync(`${key}.count`);
  await SecureStore.deleteItemAsync(key);
}

const webStorage = {
  getItem(key: string) {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    try {
      localStorage?.setItem(key, value);
    } catch {}
  },
  removeItem(key: string) {
    try {
      localStorage?.removeItem(key);
    } catch {}
  },
};

/**
 * Storage adapter for Supabase Auth.
 * - Native (iOS/Android): Expo SecureStore (encrypted), chunked for size.
 * - Web: localStorage.
 */
export const authStorage = {
  getItem(key: string): Promise<string | null> | string | null {
    return Platform.OS === 'web' ? webStorage.getItem(key) : nativeGetItem(key);
  },
  setItem(key: string, value: string): Promise<void> | void {
    return Platform.OS === 'web'
      ? webStorage.setItem(key, value)
      : nativeSetItem(key, value);
  },
  removeItem(key: string): Promise<void> | void {
    return Platform.OS === 'web'
      ? webStorage.removeItem(key)
      : nativeRemoveItem(key);
  },
};
