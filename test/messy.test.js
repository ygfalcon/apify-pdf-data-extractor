import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreCorpus } from './accuracy-score.js';

test('clean and messy layouts score every expected field', async () => {
  const groups = await scoreCorpus();
  for (const [name, rows] of Object.entries(groups)) {
    const points = rows.reduce((sum, row) => sum + row.points, 0);
    const total = rows.reduce((sum, row) => sum + row.total, 0);
    const misses = rows.flatMap((row) => row.misses.map((miss) => `${row.name}: ${miss}`));
    assert.equal(points, total, `${name} ${points}/${total}\n${misses.join('\n')}`);
  }
});
