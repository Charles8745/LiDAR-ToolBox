attribute float aDistance;
attribute float aBirth;
attribute float aValue;

uniform float uTime;
uniform float uMaxDistance;
uniform float uPointSize;
uniform float uMaxPointSize;

varying float vDist01;
varying float vValue01;
varying float vAge;

void main() {
  vDist01 = clamp(aDistance / uMaxDistance, 0.0, 1.0);
  vValue01 = clamp(aValue, 0.0, 1.0);
  vAge = uTime - aBirth;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  // Perspective-attenuated size, clamped so near points stay small dots.
  gl_PointSize = clamp(uPointSize * (12.0 / max(-mvPosition.z, 0.001)), 1.0, uMaxPointSize);
  gl_Position = projectionMatrix * mvPosition;
}
