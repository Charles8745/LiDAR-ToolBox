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
  // Perspective-attenuated size, clamped so near points stay small dots.
  // (Without the clamp, points a couple of units away balloon to hundreds of px.)
  gl_PointSize = clamp(uPointSize * (12.0 / max(-mvPosition.z, 0.001)), 1.0, 5.0);
  gl_Position = projectionMatrix * mvPosition;
}
