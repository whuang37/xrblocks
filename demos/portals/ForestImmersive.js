import * as THREE from 'three';

const SPHERE_RADIUS = 50;
const IMMERSIVE_SCALE = 4.0;

/**
 * Full-surround twilight forest for "walk-in" mode.
 * Inverted sphere: twilight sky overhead, ring of pine silhouettes
 * around the user, fireflies drifting in 3D, distant lightning + moon.
 */
export class ForestImmersive extends THREE.Object3D {
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
    this._time += dt;

    const mat = this._sphere.material;
    mat.uniforms.uTime.value = this._time;

    if (camera) {
      const camWorld = camera.getWorldPosition(new THREE.Vector3());
      const camLocal = camWorld.clone().applyMatrix4(this._entryMatrixInv);
      mat.uniforms.uCamLocal.value.copy(camLocal);

      const portalQuat = new THREE.Quaternion().setFromRotationMatrix(
        this._entryMatrix
      );
      // vWorldDir is in world space (sphere is at world position = camera with
      // no rotation). To get a portal-local ray direction we only need to undo
      // the portal's own rotation — the camera quaternion does NOT belong here.
      const portalQuatInv = portalQuat.clone().invert();
      const rotMat4 = new THREE.Matrix4().makeRotationFromQuaternion(
        portalQuatInv
      );
      mat.uniforms.uViewRotation.value.setFromMatrix4(rotMat4);
    }

    if (camera) {
      camera.getWorldPosition(this.position);
    }
  }

  _buildSphere() {
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
        float fbm(vec2 p) {
          float v = 0.0; float a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * noise(p); p *= 2.07; a *= 0.5;
          }
          return v;
        }
        float fbm3(vec3 p) {
          float v = 0.0; float a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * noise3(p); p *= 2.07; a *= 0.5;
          }
          return v;
        }

        float starsLayer(vec3 rd, float density, float threshold) {
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
          return smoothstep(0.05, 0.0, d);
        }

        float raySphere(vec3 ro, vec3 rd, vec3 c, float rad) {
          vec3 oc = ro - c;
          float b = dot(oc, rd);
          float d = b * b - (dot(oc, oc) - rad * rad);
          if (d < 0.0) return -1.0;
          return -b - sqrt(d);
        }

        // Ray–vertical-cylinder intersection. Cylinder axis = Y, at xz=c,
        // radius r, between yMin and yMax. Returns nearest positive t or -1.
        float rayCylinder(vec3 ro, vec3 rd, vec2 c, float r,
                          float yMin, float yMax) {
          vec2 d = rd.xz;
          vec2 oc = ro.xz - c;
          float a = dot(d, d);
          if (a < 1e-6) return -1.0;
          float b = dot(oc, d);
          float disc = b * b - a * (dot(oc, oc) - r * r);
          if (disc < 0.0) return -1.0;
          float t = (-b - sqrt(disc)) / a;
          if (t < 0.0) return -1.0;
          float hy = ro.y + rd.y * t;
          if (hy < yMin || hy > yMax) return -1.0;
          return t;
        }

        // GROUND_Y is 1.6m below eye level (portal-local origin = eye level).
        const float GROUND_Y = -1.6;

        // Test ray against one tree at world xz = pos. Returns hit t (or -1)
        // and writes hit type via outId: 1=trunk, 2=canopy.
        float rayTree(vec3 ro, vec3 rd, vec2 pos, float scale, out int outId) {
          outId = 0;
          float best = 1e9;
          // Trunk from ground up to canopy base.
          float trunkTopY = GROUND_Y + 1.4 * scale;
          float trunkR = 0.10 * scale;
          float t = rayCylinder(ro, rd, pos, trunkR, GROUND_Y, trunkTopY);
          if (t > 0.0 && t < best) { best = t; outId = 1; }
          // Canopy: 4 stacked spheres, broad at base, narrow at top (pine).
          for (int k = 0; k < 4; k++) {
            float fk = float(k);
            float cy = trunkTopY + (0.4 + fk * 0.55) * scale;
            float cr = (0.95 - fk * 0.18) * scale;
            float ts = raySphere(ro, rd, vec3(pos.x, cy, pos.y), cr);
            if (ts > 0.0 && ts < best) { best = ts; outId = 2; }
          }
          return (best < 1e9) ? best : -1.0;
        }

        // Forest: 16 fixed trees around the portal-local origin. Positions are
        // hashed from index, NOT relative to user — they stay put as user walks.
        vec4 forest3D(vec3 ro, vec3 rd) {
          float bestT = 1e9; int bestId = 0; vec2 bestPos = vec2(0.0);
          float bestScale = 1.0;
          for (int i = 0; i < 18; i++) {
            float fi = float(i);
            // Two concentric rings of trees: 8 inner (4-7m), 10 outer (8-13m).
            float ringT = (fi < 8.0) ? fi / 8.0 : (fi - 8.0) / 10.0;
            float ang = ringT * 6.28318 + hash(vec2(fi, 1.7)) * 0.6;
            float radius = (fi < 8.0)
                ? mix(4.0, 7.0, hash(vec2(fi, 3.3)))
                : mix(8.0, 13.0, hash(vec2(fi, 5.1)));
            vec2 pos = vec2(cos(ang), sin(ang)) * radius;
            float scale = 1.6 + hash(vec2(fi, 9.7)) * 1.4;
            int id;
            float t = rayTree(ro, rd, pos, scale, id);
            if (t > 0.0 && t < bestT) {
              bestT = t; bestId = id; bestPos = pos; bestScale = scale;
            }
          }
          if (bestId == 0) return vec4(0.0, 0.0, 0.0, -1.0);
          vec3 hp = ro + rd * bestT;
          vec3 col;
          if (bestId == 1) {
            float bark = fbm(vec2(hp.y * 6.0,
                            atan(hp.z - bestPos.y, hp.x - bestPos.x) * 4.0));
            col = mix(vec3(0.030, 0.022, 0.015),
                      vec3(0.075, 0.055, 0.035), bark);
          } else {
            vec3 trunkTop = vec3(bestPos.x,
                                 GROUND_Y + 1.4 * bestScale,
                                 bestPos.y);
            vec3 n = normalize(hp - trunkTop);
            float topLight = max(n.y, 0.0);
            float needles = fbm(hp.xz * 6.0 + hp.y * 3.0);
            vec3 base = mix(vec3(0.025, 0.050, 0.028),
                            vec3(0.055, 0.100, 0.050), needles);
            col = base * (0.45 + topLight * 0.7);
          }
          float fog = smoothstep(3.0, 16.0, bestT);
          col = mix(col, vec3(0.10, 0.08, 0.18), fog * 0.6);
          return vec4(col, bestT);
        }

        // Fireflies: cloud of point lights in a 3D volume around the user.
        vec3 fireflies(vec3 ro, vec3 rd, float t) {
          vec3 col = vec3(0.0);
          // Step along ray for a few segments to find close fireflies.
          for (int i = 0; i < 12; i++) {
            float fi = float(i);
            float seed = fi * 17.7;
            // Position drifts slowly in 3D.
            vec3 pos = vec3(
              sin(t * 0.4 + seed) * 6.0 + cos(t * 0.13 + seed * 1.3) * 3.0,
              0.4 + sin(t * 0.7 + seed * 0.9) * 0.6 + 0.4,
              cos(t * 0.5 + seed * 1.1) * 6.0 + sin(t * 0.17 + seed) * 3.0);
            // Closest distance from ray to fly.
            vec3 oc = pos - ro;
            float along = dot(oc, rd);
            if (along < 0.2 || along > 12.0) continue;
            vec3 proj = ro + rd * along;
            float d = length(pos - proj);
            float pulse = 0.6 + 0.4 * sin(t * 4.0 + seed * 7.0);
            float intensity = smoothstep(0.08, 0.0, d) * pulse;
            // Distance falloff
            intensity *= 1.0 / (1.0 + along * 0.3);
            col += vec3(0.85, 1.00, 0.45) * intensity * 0.8;
          }
          return col;
        }

        void main() {
          vec3 rd = normalize(uViewRotation * vWorldDir);
          vec3 ro = uCamLocal;

          // ---- Twilight sky gradient ----
          float skyT = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 skyTop = vec3(0.04, 0.03, 0.16);
          vec3 skyMid = vec3(0.10, 0.07, 0.28);
          vec3 skyLow = vec3(0.28, 0.16, 0.32);
          vec3 col = mix(skyLow, skyMid, smoothstep(0.45, 0.65, skyT));
          col = mix(col, skyTop, smoothstep(0.65, 1.0, skyT));

          // Crescent moon high in the sky.
          {
            vec3 moonDir = normalize(vec3(0.45, 0.75, -0.55));
            float ang = dot(rd, moonDir);
            float halo = smoothstep(0.985, 1.0, ang);
            float disc = smoothstep(0.997, 0.9985, ang);
            // Crescent: subtract offset disc.
            vec3 biteDir = normalize(moonDir + vec3(0.04, 0.02, 0.0));
            float bite = smoothstep(0.997, 0.9985, dot(rd, biteDir));
            col += vec3(0.85, 0.85, 1.00) * halo * 0.5;
            col += vec3(1.00, 1.00, 0.95) * max(disc - bite, 0.0) * 1.3;
          }

          // Faint stars (only above horizon).
          if (rd.y > 0.0) {
            float s1 = starsLayer(rd, 80.0, 0.985);
            float s2 = starsLayer(rd, 180.0, 0.992);
            col += vec3(0.85, 0.90, 1.00) * (s1 * 0.6 + s2 * 0.45)
                 * smoothstep(0.0, 0.4, rd.y);
          }

          // Distant lightning flashes on the horizon (occasional).
          {
            float beat = floor(uTime * 0.4);
            float flashSeed = hash(vec2(beat, 11.3));
            if (flashSeed > 0.78) {
              float local = fract(uTime * 0.4);
              float flash = exp(-local * 8.0) * smoothstep(0.0, 0.05, local);
              float dirSeed = hash(vec2(beat, 23.7));
              vec3 lightDir = normalize(vec3(
                  sin(dirSeed * 6.28) * 0.9, 0.05, -cos(dirSeed * 6.28) * 0.9));
              float ang = dot(rd, lightDir);
              float glow = smoothstep(0.6, 1.0, ang) * smoothstep(-0.05, 0.15, rd.y);
              col += vec3(0.55, 0.65, 1.00) * glow * flash * 0.8;
            }
          }

          // ---- Drifting mist (low fog) ----
          float mistY = smoothstep(0.15, -0.1, rd.y); // strongest near horizon and below
          float mist = fbm3(rd * 4.0 + vec3(uTime * 0.05, 0.0, uTime * 0.03));
          col = mix(col, vec3(0.12, 0.10, 0.20), mistY * mist * 0.55);

          // ---- Ground at y=-1.6 (1.6m below eye level) ----
          float groundT = -1.0;
          {
            float gy = -1.6;
            if (rd.y < -0.001 && ro.y > gy) {
              float t = (gy - ro.y) / rd.y;
              if (t > 0.0 && t < 200.0) {
                groundT = t;
                vec3 gp = ro + rd * t;
                float gn = fbm(gp.xz * 0.4);
                vec3 ground = mix(vec3(0.03, 0.04, 0.02),
                                  vec3(0.08, 0.07, 0.04), gn);
                float fog = smoothstep(0.0, 25.0, t);
                col = mix(ground, col, fog * 0.7);
              }
            }
          }

          // ---- 3D pine trees scattered around user (real raycast) ----
          // Trees occlude sky AND ground when nearer than groundT.
          vec4 forest = forest3D(ro, rd);
          if (forest.a > 0.0) {
            if (groundT < 0.0 || forest.a < groundT) {
              col = forest.rgb;
            }
          }

          // Fireflies (additive, in 3D).
          col += fireflies(ro, rd, uTime);

          // Subtle noise to break up bands.
          col += (hash(gl_FragCoord.xy + uTime) - 0.5) * 0.012;

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
    this._sphere.raycast = () => {};
    this.add(this._sphere);
    this.visible = false;
  }
}
