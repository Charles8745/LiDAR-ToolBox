attribute float aDistance;
attribute float aBirth;

uniform float uTime;
uniform float uMaxDistance;
uniform float uPointSize;

varying float vDist01;
varying float vAge;

void main() {
  vDist01 = clamp(aDistance / uMaxDistance, 0.0, 1.0);
  vAge = uTime - aBirth;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uPointSize * (300.0 / max(-mvPosition.z, 0.001));
  gl_Position = projectionMatrix * mvPosition;
}
