import { describe, expect, it } from 'vitest';
import { clauseLabel, clauseToSearch, parseSearch } from '../../app/src/lib/search.js';

describe('search syntax', () => {
  it('parses field:value tokens into clauses and keeps the rest as text', () => {
    expect(parseSearch('level:error status:>=500 payment failed')).toEqual({
      clauses: [
        { field: 'level', op: '=', value: 'error' },
        { field: 'fields.status', op: '>=', value: 500 },
      ],
      text: 'payment failed',
    });
  });

  it('supports lists, negation, exists and quotes', () => {
    expect(parseSearch('source:api,worker').clauses[0]).toEqual({
      field: 'source',
      op: 'in',
      value: ['api', 'worker'],
    });
    expect(parseSearch('user_id:!u_1').clauses[0]).toEqual({
      field: 'fields.user_id',
      op: '!=',
      value: 'u_1',
    });
    expect(parseSearch('code:*').clauses[0]).toEqual({ field: 'fields.code', op: 'exists' });
    expect(parseSearch('route:"/a b"').clauses[0]).toEqual({ field: 'fields.route', op: '=', value: '/a b' });
    expect(parseSearch('"exact phrase"').text).toBe('exact phrase');
  });

  it('treats invalid keys and URLs as free text', () => {
    expect(parseSearch('https://example.com/x')).toEqual({ clauses: [], text: 'https://example.com/x' });
  });

  it('labels and round-trips clauses', () => {
    const c = { field: 'source', op: 'in', value: ['api', 'worker'] };
    expect(clauseLabel(c)).toBe('source = api, worker');
    expect(parseSearch(clauseToSearch(c)).clauses[0]).toEqual(c);
    const n = { field: 'fields.status', op: '>=', value: 500 };
    expect(parseSearch(clauseToSearch(n)).clauses[0]).toEqual(n);
  });
});
