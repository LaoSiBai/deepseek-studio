import type { RunRecord } from '../types';

type Listener = (record: RunRecord) => void;

const listeners = new Set<Listener>();

export function onRestoreRun(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function restoreRun(record: RunRecord): void {
  listeners.forEach((listener) => listener(record));
}
