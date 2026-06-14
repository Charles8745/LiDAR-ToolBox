import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('frozen snapshot', () => {
  it('has a well-formed snapshot with berthing records at numbered berths', () => {
    const dir = resolve(__dirname, '../examples/kaohsiung-port/data/snapshots');
    const file = readdirSync(dir).find((f) => f.startsWith('khh-') && f.endsWith('.json'));
    expect(file, 'a khh-*.json snapshot must be committed').toBeDefined();
    const snap = JSON.parse(readFileSync(resolve(dir, file!), 'utf8'));
    expect(typeof snap.capturedAtMs).toBe('number');
    expect(Array.isArray(snap.berthing)).toBe(true);
    expect(snap.berthing.some((v: any) => typeof v.berthNo === 'number')).toBe(true);
  });
});
