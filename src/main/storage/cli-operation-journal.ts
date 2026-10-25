import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { getApplicationStorage, type ApplicationStorage } from './application-storage';
import { encodePayload, decodePayload } from './database/payload-codec';
import { writeTextFileAtomically } from '../utils/atomic-json';

interface JournalFile {
  path: string;
  before: string | null;
  afterHash: string;
  mode?: number;
}
interface JournalPayload {
  files: JournalFile[];
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function bytes(filename: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function prepareCliOperation(
  profileId: string,
  files: Array<{
    path: string;
    content: string;
    nextContent: string;
    exists: boolean;
    mode?: number | null;
  }>
): Promise<string | undefined> {
  const storage = getApplicationStorage();
  if (!storage) return undefined;
  storage.assertWritable();
  if (
    storage.database.connection
      .prepare(
        "SELECT 1 FROM app_operations WHERE profile_id = ? AND state IN ('prepared','recovery-required')"
      )
      .get(profileId)
  )
    throw new Error(
      'Client files have an unresolved operation; recover or review the external changes first'
    );
  const captured: JournalFile[] = [];
  for (const file of files) {
    const relative = path.relative(path.join(storage.root, 'storage'), path.resolve(file.path));
    if (
      storage.documentId(file.path) ||
      relative === '' ||
      (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
    )
      throw new Error('Client configuration cannot target application storage');
    const original = await bytes(file.path);
    if (
      Boolean(original) !== file.exists ||
      (original && original.toString('utf8') !== file.content)
    )
      throw new Error('Client file changed after preview');
    if (original && !Buffer.from(original.toString('utf8')).equals(original))
      throw new Error('Client files must contain valid UTF-8');
    captured.push({
      path: file.path,
      before: original?.toString('base64') ?? null,
      afterHash: hash(Buffer.from(file.nextContent)),
      mode: file.mode ?? undefined,
    });
  }
  const id = randomUUID();
  storage.database.connection
    .prepare('INSERT INTO app_operations VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, 'cli-files', 'prepared', profileId, Date.now(), encodePayload({ files: captured }));
  return id;
}

export function commitCliOperation(id: string | undefined, commit?: () => void): void {
  const storage = getApplicationStorage();
  if (!id || !storage) {
    commit?.();
    return;
  }
  storage.assertWritable();
  storage.database.transaction(() => {
    commit?.();
    storage.database.connection
      .prepare(
        "UPDATE app_operations SET state = 'committed' WHERE operation_id = ? AND state = 'prepared'"
      )
      .run(id);
  });
}

export async function recoverCliOperations(
  storage: ApplicationStorage,
  operationId?: string
): Promise<string[]> {
  const operations = storage.database.connection
    .prepare(
      "SELECT operation_id, payload FROM app_operations WHERE kind = 'cli-files' AND state IN ('prepared','recovery-required')" +
        (operationId ? ' AND operation_id = ?' : '')
    )
    .all(...(operationId ? [operationId] : [])) as Array<{ operation_id: string; payload: string }>;
  const conflicts: string[] = [];
  for (const operation of operations) {
    const payload = decodePayload<JournalPayload>(operation.payload);
    let conflict = false;
    for (const file of [...payload.files].reverse()) {
      const current = await bytes(file.path);
      const original = file.before === null ? null : Buffer.from(file.before, 'base64');
      if (current === null ? original === null : original?.equals(current)) continue;
      if (!current || hash(current) !== file.afterHash) {
        conflict = true;
        continue;
      }
      if (original)
        await writeTextFileAtomically(file.path, original.toString('utf8'), { mode: file.mode });
      else await fs.unlink(file.path);
    }
    storage.database.connection
      .prepare('UPDATE app_operations SET state = ? WHERE operation_id = ?')
      .run(conflict ? 'recovery-required' : 'rolled-back', operation.operation_id);
    if (conflict) conflicts.push(operation.operation_id);
  }
  return conflicts;
}
