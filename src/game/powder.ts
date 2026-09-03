/**
 * Roasted soybean powder (볶은 콩가루) particle system.
 *
 * Primary path: Three.js TSL compute shaders executed by WebGPURenderer —
 * on a WebGPU backend these compile to WGSL compute kernels integrating
 * 50,000 powder grains on the GPU (burst, billow, gravity, basin settling).
 * On any construction failure a CPU Points fallback keeps the game playable.
 */
import * as THREE from 'three';
import { Sprite, SpriteNodeMaterial, WebGPURenderer } from 'three/webgpu';
import {
  Fn,
  If,
  clamp,
  cos,
  float,
  hash,
  instancedArray,
  instanceIndex,
  mix,
  sin,
  texture,
  uint,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

export interface PowderBurst {
  count: number;
  speed: number;
  spread: number;
}

export interface Powder {
  object3d: THREE.Object3D;
  burst(origin: THREE.Vector3, opts: Partial<PowderBurst>): void;
  setFloorY(y: number): void;
  update(dt: number): void;
  /** Dark tint for black-bean pours (searchdeul / 서리태 콩가루). */
  setDark(dark: boolean): void;
}

/** Soft round sprite texture generated at runtime (no asset fetch). */
export function makePowderSprite(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const GPU_COUNT = 50000;

class GpuPowder implements Powder {
  object3d: THREE.Object3D;
  private renderer: WebGPURenderer;
  private computeUpdate: { isComputeNode?: boolean } & object;
  private uEmit = uniform(0.0);
  private uSeed = uniform(1.0);
  private uOrigin = uniform(new THREE.Vector3(0, 2, 0));
  private uSpread = uniform(0.5);
  private uSpeed = uniform(3.0);
  private uFloorY = uniform(1.0);
  private uDt = uniform(1 / 60);
  private uDark = uniform(0.0);

  constructor(renderer: WebGPURenderer, spriteTex: THREE.Texture) {
    this.renderer = renderer;

    const positions = instancedArray(GPU_COUNT, 'vec3');
    const velocities = instancedArray(GPU_COUNT, 'vec3');
    const lives = instancedArray(GPU_COUNT, 'float');

    const computeInit = Fn(() => {
      positions.element(instanceIndex).assign(vec3(0.0, -1000.0, 0.0));
      velocities.element(instanceIndex).assign(vec3(0.0));
      lives.element(instanceIndex).assign(0.0);
    })().compute(GPU_COUNT);

    const uEmit = this.uEmit;
    const uSeed = this.uSeed;
    const uOrigin = this.uOrigin;
    const uSpread = this.uSpread;
    const uSpeed = this.uSpeed;
    const uFloorY = this.uFloorY;
    const uDt = this.uDt;

    this.computeUpdate = Fn(() => {
      const pos = positions.element(instanceIndex);
      const vel = velocities.element(instanceIndex);
      const life = lives.element(instanceIndex);
      const seed = uint(uSeed);
      const dt = uDt;

      If(life.lessThanEqual(0.0), () => {
        // Dead grain: probabilistically respawn while a burst is emitting.
        const roll = hash(instanceIndex.add(seed));
        If(roll.lessThan(uEmit).and(uEmit.greaterThan(0.0)), () => {
          const a = hash(instanceIndex.add(seed).add(uint(101)));
          const b = hash(instanceIndex.add(seed).add(uint(202)));
          const c = hash(instanceIndex.add(seed).add(uint(303)));
          const theta = a.mul(float(Math.PI * 2));
          const rr = b.sqrt().mul(uSpread);
          pos.assign(
            vec3(
              uOrigin.x.add(cos(theta).mul(rr)),
              uOrigin.y,
              uOrigin.z.add(sin(theta).mul(rr))
            )
          );
          vel.assign(
            vec3(
              cos(theta).mul(rr).mul(1.6),
              uSpeed.negate().mul(c.mul(0.5).add(0.8)),
              sin(theta).mul(rr).mul(1.6)
            )
          );
          life.assign(c.mul(1.3).add(1.0));
        });
      }).Else(() => {
        vel.y.subAssign(dt.mul(9.8));
        pos.addAssign(vel.mul(dt));
        // Settle on the dough surface inside the basin.
        If(pos.y.lessThan(uFloorY), () => {
          pos.y.assign(uFloorY);
          vel.assign(vec3(0.0));
          life.subAssign(dt.mul(1.6));
        });
        life.subAssign(dt.mul(0.35));
        If(life.lessThanEqual(0.0), () => {
          pos.assign(vec3(0.0, -1000.0, 0.0));
          vel.assign(vec3(0.0));
        });
      });
    })().compute(GPU_COUNT);

    const material = new SpriteNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    const lifeV = varying(lives.element(instanceIndex));
    const yellowTint = mix(
      vec3(0.95, 0.8, 0.52),
      vec3(0.78, 0.6, 0.33),
      hash(instanceIndex.add(uint(7)))
    );
    const blackTint = mix(
      vec3(0.32, 0.25, 0.22),
      vec3(0.18, 0.13, 0.12),
      hash(instanceIndex.add(uint(7)))
    );
    const tint = mix(yellowTint, blackTint, this.uDark);
    material.colorNode = vec4(tint, 1.0)
      .mul(texture(spriteTex, uv()))
      .mul(vec4(1.0, 1.0, 1.0, clamp(lifeV, 0.0, 1.0)));
    material.scaleNode = vec2(hash(instanceIndex.add(uint(17))).mul(0.05).add(0.035));
    material.positionNode = positions.toAttribute();

    const sprite = new Sprite(material);
    sprite.frustumCulled = false;
    this.object3d = sprite;

    void renderer.computeAsync(computeInit);
  }

  burst(origin: THREE.Vector3, opts: Partial<PowderBurst>): void {
    const count = opts.count ?? 1200;
    this.uOrigin.value.copy(origin);
    this.uSpeed.value = opts.speed ?? 3.0;
    this.uSpread.value = opts.spread ?? 0.5;
    // Emission probability across all dead grains for the next frames.
    this.uEmit.value = Math.min(0.6, Math.max(0.004, count / GPU_COUNT));
  }

  setFloorY(y: number): void {
    this.uFloorY.value = y;
  }

  setDark(dark: boolean): void {
    this.uDark.value = dark ? 1 : 0;
  }

  update(dt: number): void {
    this.uDt.value = Math.min(dt, 1 / 30);
    this.uSeed.value = (this.uSeed.value + 1) % 9973;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.renderer as any).compute(this.computeUpdate);
    // Emission lasts only a couple of frames per burst.
    this.uEmit.value *= 0.55;
    if (this.uEmit.value < 0.004) this.uEmit.value = 0;
  }
}

class CpuPowder implements Powder {
  object3d: THREE.Object3D;
  private readonly N = 6000;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private cursor = 0;
  private floorY = 1.0;
  private geo: THREE.BufferGeometry;
  private mat: THREE.PointsMaterial;

  constructor(spriteTex: THREE.Texture) {
    this.pos = new Float32Array(this.N * 3);
    this.vel = new Float32Array(this.N * 3);
    this.life = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) this.pos[i * 3 + 1] = -1000;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.075,
      map: spriteTex,
      transparent: true,
      depthWrite: false,
      color: 0xe9c079,
      opacity: 0.9,
    });
    this.mat = mat;
    const points = new THREE.Points(this.geo, mat);
    points.frustumCulled = false;
    this.object3d = points;
  }

  burst(origin: THREE.Vector3, opts: Partial<PowderBurst>): void {
    const count = Math.min(opts.count ?? 800, 1500);
    const speed = opts.speed ?? 3.0;
    const spread = opts.spread ?? 0.5;
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.N;
      const theta = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * spread;
      this.pos[i * 3] = origin.x + Math.cos(theta) * rr;
      this.pos[i * 3 + 1] = origin.y;
      this.pos[i * 3 + 2] = origin.z + Math.sin(theta) * rr;
      this.vel[i * 3] = Math.cos(theta) * rr * 1.6;
      this.vel[i * 3 + 1] = -speed * (0.8 + Math.random() * 0.5);
      this.vel[i * 3 + 2] = Math.sin(theta) * rr * 1.6;
      this.life[i] = 1.0 + Math.random() * 1.3;
    }
  }

  setFloorY(y: number): void {
    this.floorY = y;
  }

  setDark(dark: boolean): void {
    this.mat.color.set(dark ? 0x4a3a33 : 0xe9c079);
  }

  update(dt: number): void {
    const d = Math.min(dt, 1 / 30);
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) continue;
      this.vel[i * 3 + 1] -= 9.8 * d;
      this.pos[i * 3] += this.vel[i * 3] * d;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * d;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * d;
      if (this.pos[i * 3 + 1] < this.floorY) {
        this.pos[i * 3 + 1] = this.floorY;
        this.vel[i * 3] = this.vel[i * 3 + 1] = this.vel[i * 3 + 2] = 0;
        this.life[i] -= d * 1.6;
      }
      this.life[i] -= d * 0.35;
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -1000;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

/** Create the powder system: GPU compute when possible, CPU fallback otherwise. */
export function createPowder(
  renderer: WebGPURenderer,
  spriteTex: THREE.Texture
): Powder {
  try {
    return new GpuPowder(renderer, spriteTex);
  } catch (err) {
    console.warn('[powder] GPU compute unavailable, using CPU fallback', err);
    return new CpuPowder(spriteTex);
  }
}
