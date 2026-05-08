import * as THREE from 'three';

import {CosmicScene} from './scenes/CosmicScene.js';

const SPHERE_RADIUS = 50;
const IMMERSIVE_SCALE = 4.0; // Push planets farther out so user doesn't reach them in 2 steps.

/**
 * Full-surround cosmic environment for "walk-in" mode.
 * Renders the cosmic raymarcher on an inverted sphere around the user,
 * with direction-based UVs so the scene wraps naturally in 360°.
 */
export class CosmicImmersive extends THREE.Object3D {
  constructor() {
    super();
    this._time = 0;
    this._buildSphere();
  }

  show(portalWorldMatrix, fromSide = 'front') {
    let m = portalWorldMatrix.clone();
    if (fromSide === 'back') {
      // User entered through the back face of the portal — apply a 180° yaw
      // so they spawn facing the scene rather than the wall behind it.
      m.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    }
    this._entryMatrix = m;
    this._entryMatrixInv = m.clone().invert();
    this.visible = true;
  }

  hide() {
    this.visible = false;
  }

  update(dt, camera) {
    if (!this.visible) return;
    this._time += dt * 4.0;

    const mat = this._sphere.material;
    mat.uniforms.uTime.value = this._time;

    if (camera) {
      // Camera world position → portal-local space = cosmic origin.
      const camWorld = camera.getWorldPosition(new THREE.Vector3());
      const camLocal = camWorld.clone().applyMatrix4(this._entryMatrixInv);
      mat.uniforms.uCamLocal.value.copy(camLocal);

      // Camera world quaternion → portal-local rotation for view directions.
      const portalQuat = new THREE.Quaternion().setFromRotationMatrix(
        this._entryMatrix
      );
      const portalQuatInv = portalQuat.clone().invert();
      // Build a rotation Matrix4, then extract upper-left 3×3 as Matrix3.
      const rotMat4 = new THREE.Matrix4().makeRotationFromQuaternion(
        portalQuatInv
      );
      mat.uniforms.uViewRotation.value.setFromMatrix4(rotMat4);
    }

    // Keep sphere centered on camera so it always surrounds the user.
    if (camera) {
      camera.getWorldPosition(this.position);
    }
  }

  _buildSphere() {
    const s = CosmicScene;
    const geom = new THREE.SphereGeometry(SPHERE_RADIUS, 64, 32);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: {value: 0},
        uCamLocal: {value: new THREE.Vector3(0, 0, 1.6)},
        uViewRotation: {value: new THREE.Matrix3()},
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldDir;
        void main() {
          // Direction from center to vertex (normalized sphere direction).
          vWorldDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uTime;
        uniform vec3 uCamLocal;
        uniform mat3 uViewRotation;
        varying vec3 vWorldDir;

        // ---------- shared helpers (3D to avoid spherical UV seam) ----------
        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float hash3(vec3 p) {
          p = fract(p * vec3(123.34, 456.21, 789.53));
          p += dot(p, p.yzx + 45.32);
          return fract(p.x * p.y * p.z);
        }
        float noise3(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          vec3 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash3(i), hash3(i + vec3(1,0,0)), u.x),
                mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), u.x), u.y),
            mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), u.x),
                mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), u.x), u.y),
            u.z);
        }
        float fbm3(vec3 p) {
          float v = 0.0; float a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * noise3(p); p *= 2.07; a *= 0.5;
          }
          return v;
        }
        float ridgedFbm3(vec3 p) {
          float v = 0.0; float a = 0.5;
          for (int i = 0; i < 4; i++) {
            float n = 1.0 - abs(noise3(p) * 2.0 - 1.0);
            v += a * n * n; p *= 2.13; a *= 0.5;
          }
          return v;
        }
        float warpedFbm3(vec3 p) {
          vec3 q = vec3(fbm3(p), fbm3(p + vec3(5.2, 1.3, 3.7)),
                        fbm3(p + vec3(9.1, 4.6, 2.8)));
          return fbm3(p + 4.0 * q);
        }

        // 2D hash/noise kept for starsLayer and raymarched object surfaces
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x)
                                + (d - b) * u.x * u.y;
        }
        float fbm(vec2 p) {
          float v = 0.0; float a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * noise(p); p *= 2.07; a *= 0.5;
          }
          return v;
        }

        float starsLayer(vec3 rd, float density, float threshold) {
          // Use octahedral mapping for seamless 2D grid on a sphere.
          vec3 a = abs(rd);
          float sum = a.x + a.y + a.z;
          vec2 oct = rd.xz / sum;
          if (rd.y < 0.0) {
            oct = (1.0 - abs(oct.yx)) * vec2(oct.x >= 0.0 ? 1.0 : -1.0,
                                              oct.y >= 0.0 ? 1.0 : -1.0);
          }
          vec2 uv = oct * 0.5 + 0.5;
          vec2 g = floor(uv * density);
          vec2 f = fract(uv * density);
          float h = hash(g);
          if (h < threshold) return 0.0;
          vec2 jitter = vec2(hash(g + 1.7), hash(g + 7.3)) * 0.6 + 0.2;
          float d = length(f - jitter);
          float twinkle = 0.5 + 0.5 * sin(uTime * (2.0 + h * 6.0) + h * 30.0);
          return smoothstep(0.05, 0.0, d) * (0.5 + twinkle * 0.5);
        }

        float raySphere(vec3 ro, vec3 rd, vec3 c, float rad) {
          vec3 oc = ro - c;
          float b = dot(oc, rd);
          float d = b * b - (dot(oc, oc) - rad * rad);
          if (d < 0.0) return -1.0;
          return -b - sqrt(d);
        }

        // ---------- cosmic scene helpers ----------
        ${s.helpers}

        void main() {
          // View direction in cosmic-local space.
          vec3 rd = normalize(uViewRotation * vWorldDir);
          vec3 ro = uCamLocal;

          // Forward-cone projection for 2D effects (comets, events).
          // Matches the disc-portal's p when looking forward.
          float forwardness = max(-rd.z, 0.0);
          vec2 p = rd.xy / max(-rd.z, 0.15);

          // ---- Nebula background (3D noise on direction, no UV seam) ----
          vec3 nDir = rd * 2.8;
          float n1 = warpedFbm3(nDir * 1.0 + vec3(uTime * 0.03, -uTime * 0.02, uTime * 0.01));
          float n2 = fbm3(nDir * 2.8 - vec3(uTime * 0.05, uTime * 0.04, -uTime * 0.03));
          float n3 = ridgedFbm3(nDir * 4.0 + vec3(-uTime * 0.04, uTime * 0.03, uTime * 0.02));
          float density = pow(n1 * 0.55 + n2 * 0.45, 1.6);
          float wisps = pow(n3, 2.2);
          vec3 nebulaA = vec3(0.05, 0.08, 0.30);
          vec3 nebulaB = vec3(0.55, 0.18, 0.70);
          vec3 nebulaC = vec3(0.95, 0.45, 0.25);
          vec3 nebulaD = vec3(0.35, 0.85, 1.00);
          vec3 col = mix(nebulaA, nebulaB, smoothstep(0.15, 0.7, n1));
          col = mix(col, nebulaC, smoothstep(0.55, 1.0, n2) * 0.9);
          col = mix(col, nebulaD, wisps * 0.6);
          col *= 0.15 + density * 2.4;
          col = mix(vec3(0.005, 0.005, 0.02), col, 0.92);

          // ---- Stars (octahedral mapping, no seam) ----
          float s1 = starsLayer(rd, 45.0, 0.975);
          float s2 = starsLayer(rd, 95.0, 0.985);
          float s3 = starsLayer(rd, 180.0, 0.992);
          float s4 = starsLayer(rd, 260.0, 0.996);
          col += vec3(0.9, 0.95, 1.0) *
                 (s1 * 1.1 + s2 * 0.9 + s3 * 0.7 + s4 * 0.6);

          // ---- Raymarched objects (true 3D, scaled positions) ----
          float t = uTime;
          float sc = ${IMMERSIVE_SCALE.toFixed(1)};

          vec3 sunPos = vec3(0.05, 0.65, -2.6) * sc;
          float sunRad = 0.18 * sc;
          vec3 sunDir = normalize(sunPos - ro);
          vec3 planetPos = vec3(-0.85, -0.10, -1.6) * sc;
          float planetRad = 0.40 * sc;
          float gasA = t * 0.05;
          vec3 gasPos = vec3(0.95 + sin(gasA) * 0.06,
                             0.10 + cos(gasA * 0.7) * 0.04,
                             -2.2 + cos(gasA) * 0.10) * sc;
          float gasRad = 0.42 * sc;
          float moonA = t * 0.18;
          vec3 moonOffset = vec3(cos(moonA) * 0.85,
                                 sin(moonA * 1.3) * 0.12,
                                 sin(moonA) * 0.85) * sc;
          vec3 moonPos = planetPos + moonOffset;
          float moonRad = 0.11 * sc;
          vec3 lightDirPlanet = normalize(sunPos - planetPos);
          vec3 lightDirMoon   = normalize(sunPos - moonPos);
          vec3 lightDirGas    = normalize(sunPos - gasPos);

          float tBest = 1e9; int hitId = 0;
          float tP = raySphere(ro, rd, planetPos, planetRad);
          float tM = raySphere(ro, rd, moonPos, moonRad);
          float tS = raySphere(ro, rd, sunPos, sunRad);
          float tG = raySphere(ro, rd, gasPos, gasRad);
          if (tP > 0.0 && tP < tBest) { tBest = tP; hitId = 1; }
          if (tM > 0.0 && tM < tBest) { tBest = tM; hitId = 2; }
          if (tS > 0.0 && tS < tBest) { tBest = tS; hitId = 3; }
          if (tG > 0.0 && tG < tBest) { tBest = tG; hitId = 4; }

          // Saturn-style ring around gas giant.
          float rt = 0.55;
          vec3 ringN = normalize(vec3(0.15, cos(rt), sin(rt)));
          float ringDenom = dot(rd, ringN);
          if (abs(ringDenom) > 1e-3) {
            float tR = dot(gasPos - ro, ringN) / ringDenom;
            if (tR > 0.0) {
              vec3 rp = ro + rd * tR - gasPos;
              float rr = length(rp);
              float inner = gasRad * 1.3;
              float outer = gasRad * 2.4;
              if (rr > inner && rr < outer) {
                float u = (rr - inner) / (outer - inner);
                float ang = atan(rp.z, rp.x) + t * 0.06;
                float bands = fbm(vec2(u * 40.0, 0.0)) * 0.55
                            + fbm(vec2(u * 140.0, 7.3)) * 0.30
                            + fbm(vec2(u * 320.0, 1.1)) * 0.15;
                bands = smoothstep(0.28, 0.78, bands);
                float gap1 = smoothstep(0.46, 0.49, u) - smoothstep(0.49, 0.53, u);
                float gap2 = smoothstep(0.72, 0.74, u) - smoothstep(0.74, 0.77, u);
                float gap3 = smoothstep(0.18, 0.20, u) - smoothstep(0.20, 0.22, u);
                bands *= 1.0 - clamp(gap1 + gap2 + gap3, 0.0, 1.0);
                float dust = fbm(vec2(ang * 60.0, u * 30.0));
                bands *= 0.55 + dust * 0.7;
                bands *= smoothstep(0.0, 0.06, u) * smoothstep(1.0, 0.94, u);
                vec3 ringCol = mix(vec3(1.00, 0.85, 0.55),
                                   vec3(0.90, 0.95, 1.10), u);
                vec3 ringHit = ro + rd * tR;
                vec3 toLight = normalize(sunPos - ringHit);
                float shadowT = raySphere(ringHit, toLight, gasPos, gasRad * 1.02);
                float shade = (shadowT > 0.0) ? 0.35 : 1.0;
                bool behind = (hitId == 4 && tR > tBest);
                if (!behind) {
                  col += ringCol * bands * shade * 1.6;
                }
              }
            }
          }

          // Sun glow + corona.
          {
            float breathe = 0.85 + 0.15 * sin(t * 0.6);
            vec3 oc = ro - sunPos;
            float b2 = dot(oc, rd);
            float closest = length(oc - rd * (-b2));
            float halo = smoothstep(0.9, 0.0, closest / (sunRad * 4.0));
            float coronaR = closest / sunRad;
            float angSun = atan(
                dot(rd - sunDir * dot(rd, sunDir), vec3(0.0, 1.0, 0.0)),
                dot(rd - sunDir * dot(rd, sunDir), vec3(1.0, 0.0, 0.0)));
            float corona = smoothstep(5.0, 1.0, coronaR)
                         * (0.5 + 0.5 * fbm(vec2(angSun * 4.0, t * 0.3 + coronaR)));
            col += vec3(1.0, 0.85, 0.55) * halo * 0.9 * breathe;
            col += vec3(1.0, 0.55, 0.20) * corona * 0.45;
          }

          // Planet shading.
          if (hitId == 1) {
            vec3 hp = ro + rd * tBest;
            vec3 n = normalize(hp - planetPos);
            col = shadePlanet(n, lightDirPlanet, rd,
                vec3(0.05, 0.20, 0.55), vec3(0.30, 0.55, 0.25),
                vec3(1.00, 1.00, 1.00));
          } else if (hitId == 2) {
            vec3 hp = ro + rd * tBest;
            vec3 n = normalize(hp - moonPos);
            float crater = fbm(vec2(n.x * 8.0, n.z * 8.0));
            float lon = atan(n.z, n.x);
            float lat = asin(clamp(n.y, -1.0, 1.0));
            float surface = fbm(vec2(lon, lat) * 4.0);
            vec3 base = mix(vec3(0.55, 0.50, 0.48),
                            vec3(0.85, 0.80, 0.75), surface);
            base *= 0.7 + crater * 0.5;
            float lambert = max(dot(n, lightDirMoon), 0.0);
            col = base * (0.1 + lambert);
          } else if (hitId == 3) {
            vec3 hp = ro + rd * tBest;
            vec3 n = normalize(hp - sunPos);
            float surf = fbm(vec2(n.x * 4.0 + t * 0.30, n.y * 4.0 - t * 0.20));
            float granules = fbm(vec2(n.x * 18.0 - t * 0.4, n.y * 18.0 + t * 0.3));
            vec3 c = mix(vec3(1.00, 0.55, 0.20),
                         vec3(1.00, 0.95, 0.80), surf);
            c += vec3(0.4, 0.15, 0.05) * (granules - 0.5) * 0.6;
            float limb = pow(max(dot(n, -rd), 0.0), 0.45);
            col = c * 1.6 * limb;
          } else if (hitId == 4) {
            vec3 hp = ro + rd * tBest;
            vec3 n = normalize(hp - gasPos);
            float lon = atan(n.z, n.x);
            float lat = asin(clamp(n.y, -1.0, 1.0));
            float bandNoise = fbm(vec2(lat * 6.0, lon * 0.5 + t * 0.05));
            float bands = sin(lat * 14.0 + bandNoise * 3.0) * 0.5 + 0.5;
            vec3 colA = vec3(0.95, 0.78, 0.50);
            vec3 colB = vec3(0.78, 0.55, 0.30);
            vec3 colC = vec3(1.00, 0.92, 0.72);
            vec3 base = mix(colA, colB, bands);
            base = mix(base, colC, smoothstep(0.55, 0.85,
                       fbm(vec2(lon * 2.0 + t * 0.1, lat * 2.0))) * 0.6);
            float spot = smoothstep(0.30, 0.0,
                length(vec2(lon - 1.0, lat + 0.3)));
            base = mix(base, vec3(0.90, 0.35, 0.20), spot * 0.7);
            float lambert = max(dot(n, lightDirGas), 0.0);
            float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.5);
            col = base * (0.35 + lambert * 0.95)
                + vec3(1.0, 0.75, 0.55) * rim * 0.55;
          }

          // ---- Comets (forward cone only) ----
          float fwdMask = smoothstep(0.0, 0.3, forwardness);
          if (fwdMask > 0.0) {
            col += cosmicComet(p, uTime, 0.13) * fwdMask;
            col += cosmicComet(p, uTime + 2.7, 0.61) * fwdMask;
            col += cosmicComet(p, uTime + 4.1, 0.84) * fwdMask;
          }

          // Tone-map.
          col = col / (col + vec3(1.0));
          col = pow(col, vec3(0.85));

          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });

    this._sphere = new THREE.Mesh(geom, mat);
    this._sphere.renderOrder = -100;
    this._sphere.frustumCulled = false;
    // Prevent raycast from hitting the sky sphere.
    this._sphere.raycast = () => {};
    this.add(this._sphere);
    this.visible = false;
  }
}
