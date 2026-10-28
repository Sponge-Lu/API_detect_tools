import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const RESULT_FILE = 'smoke-artifact-result.json';
type Outcome = 'passed' | 'failed';

function assertLocalDirectory(directory: string): void {
  if (lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== directory) {
    throw new Error(`Smoke artifacts must stay inside the project: ${directory}`);
  }
}

export function createPackagedSmokeArtifacts(root: string, kind: 'product' | 'driver') {
  let base = realpathSync(root);
  for (const name of ['.cache', 'architecture-refactor-tests']) {
    base = path.join(base, name);
    mkdirSync(base, { recursive: true });
    assertLocalDirectory(base);
  }
  const prefix = `packaged-${kind}-`;
  const fixture = mkdtempSync(path.join(base, `${prefix}${Date.now()}-`));
  let finished = false;

  return {
    fixture,
    finish(passed: boolean): void {
      if (finished) return;
      finished = true;
      try {
        assertLocalDirectory(base);
        assertLocalDirectory(fixture);
        writeFileSync(
          path.join(fixture, RESULT_FILE),
          JSON.stringify({
            version: 1,
            outcome: passed ? 'passed' : 'failed',
            completedAt: Date.now(),
          }),
          'utf8'
        );
        const completed: Array<{ directory: string; outcome: Outcome; completedAt: number }> = [];
        for (const entry of readdirSync(base, { withFileTypes: true })) {
          if (
            !entry.isDirectory() ||
            !entry.name.startsWith(prefix) ||
            !/^packaged-(product|driver)-\d+(?:-[a-zA-Z0-9]+)?$/.test(entry.name)
          )
            continue;
          const directory = path.join(base, entry.name);
          try {
            assertLocalDirectory(directory);
            const result = JSON.parse(readFileSync(path.join(directory, RESULT_FILE), 'utf8'));
            if (
              result?.version === 1 &&
              (result.outcome === 'passed' || result.outcome === 'failed') &&
              Number.isFinite(result.completedAt) &&
              result.completedAt > 0
            )
              completed.push({
                directory,
                outcome: result.outcome,
                completedAt: result.completedAt,
              });
          } catch {
            // Unmarked, active or unrecognized artifacts are never removed automatically.
          }
        }
        completed.sort(
          (a, b) =>
            b.completedAt - a.completedAt ||
            Number(b.directory === fixture) - Number(a.directory === fixture)
        );
        const retained = new Set<Outcome>();
        for (const entry of completed) {
          if (!retained.has(entry.outcome)) {
            retained.add(entry.outcome);
            continue;
          }
          if (entry.directory === fixture) continue;
          try {
            assertLocalDirectory(base);
            assertLocalDirectory(entry.directory);
            rmSync(entry.directory, { recursive: true, force: true });
          } catch (error) {
            console.warn(`Could not remove old smoke artifacts: ${entry.directory}`, error);
          }
        }
      } catch (error) {
        console.warn(`Could not finalize smoke artifacts: ${fixture}`, error);
      }
    },
  };
}
