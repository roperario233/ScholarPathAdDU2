import { describe, expect, it, vi } from 'vitest';
import { memoizeLast } from '../src/lib/memoizeLast';

describe('memoizeLast', () => {
  it('returns the same result while the arguments are identical', () => {
    const compute = vi.fn((list, owner) => list.filter((entry) => entry.owner === owner));
    const select = memoizeLast(compute);
    const list = [{ owner: 'a' }, { owner: 'b' }];
    const first = select(list, 'a');
    expect(select(list, 'a')).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('recomputes when any argument changes', () => {
    const compute = vi.fn((list, owner) => list.filter((entry) => entry.owner === owner));
    const select = memoizeLast(compute);
    const list = [{ owner: 'a' }];
    select(list, 'a');
    select([...list], 'a');
    select(list, 'b');
    expect(compute).toHaveBeenCalledTimes(3);
  });
});
