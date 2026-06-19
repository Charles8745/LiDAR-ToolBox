export type ZoneTier = 'district' | 'terminal';
export interface PortZone { label: string; lat: number; lon: number; tier: ZoneTier }

/**
 * Official KHB zone taxonomy (osmx2.aspx dropdown a01–a13): 4 commercial districts +
 * 9 container/terminal zones. Coordinates are hand-placed against the NLSC basemap
 * (coarse area headers, not survey-grade) — calibrated visually in the final task.
 * North→south along the commercial wharf line.
 */
export const PORT_ZONES: PortZone[] = [
  { label: '蓬萊商港區', tier: 'district', lat: 22.6180, lon: 120.2790 },
  { label: '鹽埕商港區', tier: 'district', lat: 22.6120, lon: 120.2840 },
  { label: '苓雅商港區', tier: 'district', lat: 22.6040, lon: 120.2900 },
  { label: '中島商港區', tier: 'district', lat: 22.5930, lon: 120.2980 },
  { label: '第一貨櫃中心', tier: 'terminal', lat: 22.6090, lon: 120.2870 },
  { label: '第二貨櫃中心', tier: 'terminal', lat: 22.6000, lon: 120.2940 },
  { label: '第三貨櫃中心', tier: 'terminal', lat: 22.5870, lon: 120.3030 },
  { label: '第四貨櫃中心', tier: 'terminal', lat: 22.5760, lon: 120.3070 },
  { label: '第五貨櫃中心', tier: 'terminal', lat: 22.5650, lon: 120.3110 },
  { label: '第六貨櫃中心', tier: 'terminal', lat: 22.5540, lon: 120.3170 },
  { label: '第七貨櫃中心', tier: 'terminal', lat: 22.5470, lon: 120.3270 },
  { label: '洲際二期', tier: 'terminal', lat: 22.5420, lon: 120.3300 },
  { label: '海事工作船渠', tier: 'terminal', lat: 22.5700, lon: 120.3000 },
];

/** [fadeInStart, fullStart, fullEnd, fadeOutEnd] in world units (camera→sceneCenter distance). */
export type Band = [number, number, number, number];
export interface LodBands { district: Band; terminal: Band; berth: Band }

/**
 * Nominal bands for WORLD_SCALE=0.025 (1u=40m). Far→district, mid→terminal, near→berth.
 * Bands overlap at the seams for cross-fade and cover [0,∞) with no dead zone.
 * Tuned visually in the final task; live as constants in main.ts.
 */
export const DEFAULT_BANDS: LodBands = {
  district: [120, 180, 1e9, 1e9],
  terminal: [40, 70, 170, 220],
  berth: [0, 0, 55, 90],
};

/** Opacity ∈ [0,1] for a tier at a given global camera distance. 0 outside the band. */
export function tierOpacity(tier: keyof LodBands, camDist: number, bands: LodBands): number {
  const [inStart, full0, full1, outEnd] = bands[tier];
  if (camDist < inStart || camDist >= outEnd) return 0;
  if (camDist < full0) return (camDist - inStart) / (full0 - inStart || 1);
  if (camDist <= full1) return 1;
  return (outEnd - camDist) / (outEnd - full1 || 1);
}

/** Secondary per-label declutter for the berth tier: visible only within nearRadius. */
export function berthDeclutterVisible(labelDistToCamera: number, nearRadius: number): boolean {
  return labelDistToCamera <= nearRadius;
}
