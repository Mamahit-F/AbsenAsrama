/**
 * Poligon presisi batas wilayah Kampus Universitas Klabat (UNKLAB), Airmadidi.
 * Mengikuti jalan lingkar luar kampus dari sisi utara (di atas Pioneer Chapel),
 * turun di sisi timur termasuk area gerbang timur hingga batas Jl. Arnold Mononutu,
 * berbelok ke barat daya di atas Sarikana Oil melewati area SMP Advent UNKLAB,
 * lalu melengkung sepanjang jalan lingkar barat kembali ke utara.
 */
export const UNKLAB_CENTER = {
  lat: 1.4172,
  lon: 124.9835,
} as const;

export const UNKLAB_POLYGON: readonly [number, number][] = [
  [1.42010, 124.98265],
  [1.42018, 124.98315],
  [1.42022, 124.98365],
  [1.42015, 124.98420],
  [1.41996, 124.98472],
  [1.41965, 124.98498],
  [1.41918, 124.98520],
  [1.41862, 124.98524],
  [1.41795, 124.98528],
  [1.41748, 124.98528],
  [1.41736, 124.98576],
  [1.41712, 124.98598],
  [1.41655, 124.98596],
  [1.41612, 124.98582],
  [1.41580, 124.98556],
  [1.41538, 124.98520],
  [1.41485, 124.98478],
  [1.41442, 124.98438],
  [1.41410, 124.98395],
  [1.41392, 124.98345],
  [1.41390, 124.98290],
  [1.41415, 124.98245],
  [1.41455, 124.98225],
  [1.41512, 124.98218],
  [1.41568, 124.98212],
  [1.41618, 124.98188],
  [1.41668, 124.98162],
  [1.41708, 124.98172],
  [1.41758, 124.98212],
  [1.41812, 124.98248],
  [1.41868, 124.98276],
  [1.41918, 124.98282],
  [1.41968, 124.98265],
];

export const UNKLAB_BOUNDS = {
  minLat: 1.41390,
  maxLat: 1.42022,
  minLon: 124.98162,
  maxLon: 124.98598,
} as const;

export function isInsideUnklabBounds(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (
    lat < UNKLAB_BOUNDS.minLat ||
    lat > UNKLAB_BOUNDS.maxLat ||
    lon < UNKLAB_BOUNDS.minLon ||
    lon > UNKLAB_BOUNDS.maxLon
  ) {
    return false;
  }

  let inside = false;
  const n = UNKLAB_POLYGON.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [yi, xi] = UNKLAB_POLYGON[i];
    const [yj, xj] = UNKLAB_POLYGON[j];
    const intersects =
      (yi > lat) !== (yj > lat) &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
