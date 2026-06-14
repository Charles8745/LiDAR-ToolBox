import { describe, it, expect } from 'vitest';
import { shipCategoryIndex, statusIndex, valueFor, SHIP_CATEGORY_COLORS, SHIP_CATEGORIES } from '../examples/kaohsiung-port/palette';

describe('palette', () => {
  it('maps known ship types to their category index', () => {
    expect(shipCategoryIndex('全貨櫃船')).toBe(SHIP_CATEGORIES.indexOf('貨櫃'));
    expect(shipCategoryIndex('液化天然氣船')).toBe(SHIP_CATEGORIES.indexOf('LNG'));
  });
  it('maps unknown types to 其他 (last category)', () => {
    expect(shipCategoryIndex('飛碟')).toBe(SHIP_CATEGORIES.indexOf('其他'));
  });
  it('valueFor returns the texel center for NearestFilter', () => {
    expect(valueFor(0, 3)).toBeCloseTo(1 / 6);
    expect(valueFor(2, 3)).toBeCloseTo(5 / 6);
  });
  it('has one color per ship category', () => {
    expect(SHIP_CATEGORY_COLORS).toHaveLength(SHIP_CATEGORIES.length);
  });
  it('orders statuses occupied/free/incoming', () => {
    expect(statusIndex('occupied')).toBe(0);
    expect(statusIndex('incoming')).toBe(2);
  });
});
