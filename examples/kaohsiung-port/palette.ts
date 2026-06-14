import type { RGB } from '../../src/core/types';

export const SHIP_CATEGORIES = ['貨櫃', '油品', '散雜', 'LNG', '工作', '軍艦', '客運', '其他'] as const;
export type ShipCategory = typeof SHIP_CATEGORIES[number];

const TYPE_TO_CATEGORY: Record<string, ShipCategory> = {
  '全貨櫃船': '貨櫃', '半貨櫃船': '貨櫃',
  '油輪': '油品', '油品船': '油品', '油化船': '油品',
  '液化氣體船': 'LNG', '液化天然氣船': 'LNG',
  '散裝船': '散雜', '雜貨船': '散雜', '小貨船': '散雜', '水泥專用船': '散雜', '駛上駛下貨船': '散雜',
  '客貨船': '客運', '工作船': '工作', '漁業巡護船': '工作', '軍用艦艇': '軍艦',
};

export const SHIP_CATEGORY_COLORS: RGB[] = [
  [90, 156, 255], [255, 174, 90], [202, 168, 106], [185, 138, 255],
  [138, 160, 170], [90, 230, 120], [90, 220, 230], [200, 200, 210],
];

export function shipCategoryIndex(shipType: string): number {
  const cat = TYPE_TO_CATEGORY[shipType] ?? '其他';
  return SHIP_CATEGORIES.indexOf(cat);
}

export const STATUS_CATEGORIES = ['occupied', 'free', 'incoming'] as const;
export const STATUS_COLORS: RGB[] = [[255, 110, 110], [90, 230, 160], [255, 209, 90]];
export function statusIndex(s: 'occupied' | 'free' | 'incoming'): number {
  return STATUS_CATEGORIES.indexOf(s);
}

export const BASE_COLORS: RGB[] = [[47, 110, 116], [127, 224, 232]]; // coastline, quay

/** Normalized value for category `index` of `n` (NearestFilter texel center). */
export function valueFor(index: number, n: number): number { return (index + 0.5) / n; }
