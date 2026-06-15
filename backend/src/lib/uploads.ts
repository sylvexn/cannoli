/**
 * Persistent upload storage.
 *
 * User avatars/banners and team logos/banners are written to disk and served
 * back via `GET /uploads/:dir/:file`. These files MUST live on the same
 * persistent volume as the SQLite DB — the Coolify data volume is mounted at
 * the DB's directory (`backend/data/`, or wherever CANNOLI_DB_PATH points).
 *
 * The previous code wrote to `${process.cwd()}/uploads/`, which is OUTSIDE the
 * volume, so every redeploy silently wiped every uploaded avatar and logo.
 * Storing them in an `uploads/` dir alongside the DB makes them durable with
 * no extra volume/infra. Override with CANNOLI_UPLOADS_DIR if needed.
 */
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

const DATA_DIR = process.env.CANNOLI_DB_PATH
  ? dirname(resolve(process.env.CANNOLI_DB_PATH))
  : resolve(import.meta.dir, '../../data');

export const UPLOADS_DIR = process.env.CANNOLI_UPLOADS_DIR
  ? resolve(process.env.CANNOLI_UPLOADS_DIR)
  : resolve(DATA_DIR, 'uploads');

// Ensure the base dir exists up front; Bun.write also creates intermediate
// dirs per key, but creating it here surfaces permission problems at boot.
mkdirSync(UPLOADS_DIR, { recursive: true });

/** Absolute on-disk path for an uploads key like "team-logos/abc.png". */
export function uploadsPath(key: string): string {
  return resolve(UPLOADS_DIR, key);
}

/** Persist an uploaded file under `key` on the durable uploads volume. */
export async function writeUpload(key: string, file: Blob): Promise<void> {
  await Bun.write(uploadsPath(key), file);
}
