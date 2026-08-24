import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { layoutCommits } from './index';
test('dump', () => {
  const lines = readFileSync(new URL('./__tmp_log.txt', import.meta.url), 'utf8').trim().split('\n');
  const listCommits = lines.map((l) => {
    const [hash, parents] = l.split('|');
    return { hash, parents: parents ? parents.trim().split(/\s+/).filter(Boolean) : [] } as any;
  });
  const rows = layoutCommits(listCommits);
  const out = rows.map((r) =>
    [
      r.commit.hash.slice(0, 7),
      'col=' + r.nodeColumn,
      'colour=' + r.nodeColour,
      'p@' + JSON.stringify(r.listParentColumns),
      'in=[' + r.listInputLanes.map((l: any) => (l ? l.hash.slice(0, 4) : '.')).join(' ') + ']',
      'out=[' + r.listOutputLanes.map((l: any) => (l ? l.hash.slice(0, 4) : '.')).join(' ') + ']',
    ].join(' ')
  );
  console.log('\n' + out.join('\n'));
});
