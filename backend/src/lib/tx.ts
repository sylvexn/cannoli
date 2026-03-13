import { sqlite } from '../db';

const runInTx = sqlite.transaction((fn: () => unknown) => fn());

export function tx<T>(fn: () => T): T {
  return runInTx(fn) as T;
}
