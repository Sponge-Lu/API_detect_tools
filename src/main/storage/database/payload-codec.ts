import { encryptField, decryptField } from '../../config-field-crypto';

// Unindexed per-entity fields may include credentials or arbitrary user templates.
// Encrypt the entire extension before SQLite can write it to a page or WAL.
export function encodePayload(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Storage payload must be JSON serializable');
  return encryptField(serialized);
}

export function decodePayload<T>(value: string): T {
  if (!value.startsWith('encrypted:v1:')) throw new Error('Unprotected database payload');
  return JSON.parse(decryptField(value)) as T;
}
