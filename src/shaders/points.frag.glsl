uniform sampler2D uRamp;
uniform float uFade;          // 0 = accumulate, 1 = fade
uniform float uFadeDuration;  // seconds
uniform float uColorMode;     // 0 = color by distance, 1 = color by value

varying float vDist01;
varying float vValue01;
varying float vAge;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float soft = smoothstep(0.5, 0.38, d);

  float coord = mix(vDist01, vValue01, step(0.5, uColorMode));
  vec3 col = texture2D(uRamp, vec2(coord, 0.5)).rgb;
  float alpha = soft;
  if (uFade > 0.5) {
    alpha *= clamp(1.0 - vAge / max(uFadeDuration, 0.001), 0.0, 1.0);
    if (alpha < 0.01) discard;
  }
  gl_FragColor = vec4(col, alpha);
}
