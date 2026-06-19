export type ZoneTier = 'district' | 'terminal';
export interface PortZone { label: string; lat: number; lon: number; tier: ZoneTier }

/**
 * Official KHB zone taxonomy (osmx2.aspx dropdown a01–a13): 4 commercial districts +
 * 9 container/terminal zones. Coordinates are derived from the real baked berth cloud
 * (data/berths-khh.json): districts = centroids of 4 lat-bands over the northern
 * commercial berths (where 蓬萊/鹽埕/苓雅/中島 actually are); terminals = centroids of
 * 9 lat-bands over the central-south berths (container centres + 洲際 + 海事). These are
 * COARSE area headers (non-survey-grade); the individual berth tier carries real precision.
 * North→south.
 */
export const PORT_ZONES: PortZone[] = [
  { label: '蓬萊商港區', tier: 'district', lat: 22.6161, lon: 120.2841 },
  { label: '鹽埕商港區', tier: 'district', lat: 22.6094, lon: 120.2895 },
  { label: '苓雅商港區', tier: 'district', lat: 22.6027, lon: 120.2897 },
  { label: '中島商港區', tier: 'district', lat: 22.5955, lon: 120.2929 },
  { label: '第一貨櫃中心', tier: 'terminal', lat: 22.6027, lon: 120.2907 },
  { label: '第二貨櫃中心', tier: 'terminal', lat: 22.5983, lon: 120.2910 },
  { label: '第三貨櫃中心', tier: 'terminal', lat: 22.5930, lon: 120.2934 },
  { label: '第四貨櫃中心', tier: 'terminal', lat: 22.5851, lon: 120.2981 },
  { label: '第五貨櫃中心', tier: 'terminal', lat: 22.5687, lon: 120.3073 },
  { label: '第六貨櫃中心', tier: 'terminal', lat: 22.5593, lon: 120.3212 },
  { label: '第七貨櫃中心', tier: 'terminal', lat: 22.5521, lon: 120.3236 },
  { label: '洲際二期', tier: 'terminal', lat: 22.5423, lon: 120.3247 },
  { label: '海事工作船渠', tier: 'terminal', lat: 22.5340, lon: 120.3115 },
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
