/**
 * Harbor Docks floodlights: high masts on a regular grid over the container yard. The masts are real objects
 * (HarborYard.ts places one on every grid point that lies on the quay); these constants and the GLSL below let
 * the container, quay and machinery shaders light their surfaces from the same grid without real point lights.
 */
export const MAST_GRID = {
  /** Spacing in metres along x and z. */
  cellX: 96, cellZ: 68,
  /** World position of one grid point. */
  originX: -192, originZ: -32,
  /** Lamp height above the quay (m) and the quay's level. */
  height: 26, quayY: 3,
};

/**
 * `vec3 mastLight(vec3 worldPos, vec3 normal)`: warm sodium light from the four masts around a point (diffuse),
 * and `float mastSpec(vec3 worldPos, vec3 normal, vec3 viewDir, float power)`: their highlights on wet surfaces.
 */
export const MAST_LIGHT_GLSL = /* glsl */ `
  const vec2 MAST_CELL = vec2(${MAST_GRID.cellX.toFixed(1)}, ${MAST_GRID.cellZ.toFixed(1)});
  const vec2 MAST_ORIGIN = vec2(${MAST_GRID.originX.toFixed(1)}, ${MAST_GRID.originZ.toFixed(1)});
  const float MAST_Y = ${(MAST_GRID.quayY + MAST_GRID.height).toFixed(1)};
  const vec3 MAST_COLOR = vec3(1.0, 0.7, 0.4);
  vec3 mastLight(vec3 wp, vec3 n) {
    vec2 base = floor((wp.xz - MAST_ORIGIN) / MAST_CELL);
    float sum = 0.0;
    for (int j = 0; j <= 1; j++) for (int i = 0; i <= 1; i++) {
      vec2 lp = (base + vec2(float(i), float(j))) * MAST_CELL + MAST_ORIGIN;
      vec3 L = vec3(lp.x, MAST_Y, lp.y) - wp;
      float d2 = dot(L, L);
      // Soft falloff: a pool about 45 m across under each mast, fading into the next one.
      float att = 1.0 / (1.0 + d2 / 700.0);
      sum += max(dot(n, L * inversesqrt(d2)), 0.0) * att * att;
    }
    return MAST_COLOR * sum * 5.5;
  }
  float mastSpec(vec3 wp, vec3 n, vec3 v, float power) {
    vec2 base = floor((wp.xz - MAST_ORIGIN) / MAST_CELL);
    float sum = 0.0;
    for (int j = 0; j <= 1; j++) for (int i = 0; i <= 1; i++) {
      vec2 lp = (base + vec2(float(i), float(j))) * MAST_CELL + MAST_ORIGIN;
      vec3 L = vec3(lp.x, MAST_Y, lp.y) - wp;
      float d2 = dot(L, L);
      float att = 1.0 / (1.0 + d2 / 1600.0);
      sum += pow(max(dot(n, normalize(L * inversesqrt(d2) + v)), 0.0), power) * att;
    }
    return sum;
  }`;
