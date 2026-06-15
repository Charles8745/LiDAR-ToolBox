attribute float aDistance;
attribute float aBirth;
attribute float aValue;

uniform float uTime;
uniform float uMaxDistance;
uniform float uPointSize;
uniform float uMaxPointSize;
uniform float uSizeAttenuation;

varying float vDist01;
varying float vValue01;
varying float vAge;

#include <fog_pars_vertex>

void main() {
  vDist01 = clamp(aDistance / uMaxDistance, 0.0, 1.0);
  vValue01 = clamp(aValue, 0.0, 1.0);
  vAge = uTime - aBirth;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  // Perspective-attenuated size, clamped so near points stay small dots.
  float sz = (uSizeAttenuation > 0.5) ? (uPointSize * (12.0 / max(-mvPosition.z, 0.001))) : uPointSize;
  gl_PointSize = clamp(sz, 1.0, uMaxPointSize);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
