import { describe, expect, it } from 'vitest';
import { parseFilter } from '../../src/query/filter.js';
import { bySourceId } from '../../src/query/sources.js';

const names = new Map([
  ['src_1', 'payments-api'],
  ['src_2', 'worker'],
]);
const filter = (where) => parseFilter({ project_id: 'prj_a', from: 0, to: 60_000, where });

describe('source filters use the source id', () => {
  it('turns names into ids, so a renamed source keeps its history', () => {
    const { where } = bySourceId(
      filter([
        { field: 'source', op: '=', value: 'payments-api' },
        { field: 'source', op: 'not_in', value: ['worker', 'gone'] },
        { field: 'source', op: 'contains', value: 'API' },
        { field: 'level', op: '=', value: 'error' },
      ]),
      names,
    );
    expect(where).toEqual([
      { field: 'source_id', op: '=', value: 'src_1' },
      { field: 'source_id', op: 'not_in', value: ['src_2', '-'] },
      { field: 'source_id', op: 'in', value: ['src_1'] },
      { field: 'level', op: '=', value: 'error' },
    ]);
  });

  it('matches nothing for a name no current source has, so a deleted source never leaks into a new one', () => {
    const { where } = bySourceId(filter([{ field: 'source', op: '=', value: 'old-worker' }]), names);
    expect(where).toEqual([{ field: 'source_id', op: '=', value: '-' }]);
  });
});
