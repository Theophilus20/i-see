import { describe, expect, it } from 'vitest';
import { taughtForScan, trustOf, type Taught } from '../../src/web/lib/teach';

const t = (over: Partial<Taught>): Taught => ({ kind: 'car', from: 'Headlight', to: 'Fog light', at: `${Math.random()}`, status: 'pending', entryId: 'a', regionId: 'r1', ...over });

describe('what a correction teaches I SEE', () => {
  it('trusts a person by their check questions, starting undecided', () => {
    expect(trustOf({ goldSeen: 0, goldRight: 0 })).toBe(0.5);
    expect(trustOf({ goldSeen: 2, goldRight: 2 })).toBeGreaterThanOrEqual(0.7);
    expect(trustOf({ goldSeen: 4, goldRight: 1 })).toBeLessThan(0.5);
  });

  it('sends a name once a second look agreed with it', () => {
    expect(taughtForScan({ taught: [t({ status: 'verified' })], goldSeen: 0, goldRight: 0 })).toEqual([{ kind: 'car', from: 'Headlight', to: 'Fog light' }]);
  });

  it('does not send a name taught once, unchecked or disputed', () => {
    expect(taughtForScan({ taught: [t({ status: 'pending' })], goldSeen: 5, goldRight: 5 })).toEqual([]);
    expect(taughtForScan({ taught: [t({ status: 'disputed' })], goldSeen: 5, goldRight: 5 })).toEqual([]);
  });

  it('sends a name made on two photos only by someone who does well on check questions', () => {
    const twice = [t({ status: 'disputed', entryId: 'a' }), t({ status: 'pending', entryId: 'b', to: 'fog light' })];
    expect(taughtForScan({ taught: twice, goldSeen: 3, goldRight: 3 })).toHaveLength(1);
    expect(taughtForScan({ taught: twice, goldSeen: 3, goldRight: 0 })).toEqual([]);
    // The same photo twice is one answer, not two.
    const samePhoto = [t({ entryId: 'a' }), t({ entryId: 'a' })];
    expect(taughtForScan({ taught: samePhoto, goldSeen: 3, goldRight: 3 })).toEqual([]);
  });
});
