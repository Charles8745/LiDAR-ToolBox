uniform sampler2D uRamp;
uniform float uFade;          // 0 = accumulate, 1 = fade
uniform float uFadeDuration;  // seconds

varying float vDist01;
varying float vAge;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float soft = smoothstep(0.5, 0.1, d);

  vec3 col = texture2D(uRamp, vec2(vDist01, 0.5)).rgb;
  float alpha = soft;
  if (uFade > 0.5) {
    alpha *= clamp(1.0 - vAge / uFadeDuration, 0.0, 1.0);
  }
  gl_FragColor = vec4(col, alpha);
}
