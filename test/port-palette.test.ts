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

describe('expanded categories (遊艇 / 工程)', () => {
  it('has 10 categories with 其他 last and the two new ones before it', () => {
    expect(SHIP_CATEGORIES).toHaveLength(10);
    expect(SHIP_CATEGORIES[SHIP_CATEGORIES.length - 1]).toBe('其他');
    expect(SHIP_CATEGORIES).toContain('遊艇');
    expect(SHIP_CATEGORIES).toContain('工程');
  });
  it('keeps a colour per category', () => {
    expect(SHIP_CATEGORY_COLORS).toHaveLength(SHIP_CATEGORIES.length);
  });
  it('does not shift the indices of the original 7 categories', () => {
    expect(SHIP_CATEGORIES.indexOf('貨櫃')).toBe(0);
    expect(SHIP_CATEGORIES.indexOf('客運')).toBe(6);
  });
});

describe('TYPE_TO_CATEGORY gap fixes', () => {
  const cat = (t: string) => SHIP_CATEGORIES[shipCategoryIndex(t)];
  it('routes previously-unlisted official types to the right category', () => {
    expect(cat('拖船')).toBe('工作');
    expect(cat('起重船')).toBe('工作');
    expect(cat('多用途工作船')).toBe('工作');
    expect(cat('工作平台船')).toBe('工作');
    expect(cat('運輸補給船')).toBe('工作');
    expect(cat('拖船兼消防')).toBe('工作');
    expect(cat('漁船')).toBe('工作');
    expect(cat('運輸駁船')).toBe('散雜');
    expect(cat('多用途船')).toBe('散雜');
    expect(cat('化學液體船')).toBe('油品');
    expect(cat('油駁船')).toBe('油品');
    expect(cat('貨櫃輪(有導槽)')).toBe('貨櫃');
  });
});
