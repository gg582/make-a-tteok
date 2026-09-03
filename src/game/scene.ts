/**
 * TteokScene — the 2.5D marketplace stage.
 *
 * Rendered with Three.js WebGPURenderer (WGSL shaders on WebGPU, automatic
 * WebGL2 fallback). Customers and the mallet are Live2D-style sprite actors
 * (AI-generated cel-shaded illustrations with squash & stretch motion);
 * the basin and dough stay 3D so the SSS-style dough can visibly rise as
 * the only in-game gauge, and the roasted soybean powder runs as a GPU
 * compute particle system.
 */
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { buildBasin, buildVesselProp } from './procedural-assets';
import { MalletSprite, SpriteActor } from './sprite-actor';
import { createPowder, makePowderSprite, type Powder } from './powder';
import type { Grade, Vessel } from './metrology';

const BASIN_POS = new THREE.Vector3(0, 1.22, 0.45);
const BASIN_FLOOR = BASIN_POS.y + 0.1;
const DOUGH_MAX_HEIGHT = 1.0;

// Chibi customer sprites paired with their artbook (미형) counterparts.
// Every look ships with happy/angry expression variants for verdicts.
interface FaceSet {
  neutral: string;
  happy: string;
  angry: string;
}
const face = (base: string): FaceSet => ({
  neutral: `/assets/textures/${base}.png`,
  happy: `/assets/textures/${base}_happy.png`,
  angry: `/assets/textures/${base}_angry.png`,
});

const CUSTOMER_SETS: Array<{ chibi: FaceSet; artbook: FaceSet }> = [
  { chibi: face('customer_1'), artbook: face('artbook_1') },
  { chibi: face('customer_2'), artbook: face('artbook_2') },
  { chibi: face('customer_3'), artbook: face('artbook_3') },
];

// Extended artbook looks for the same age/gender archetypes, so every
// customer — elder, middle-aged, granny — appears as a 미형 variant.
const ARTBOOK_EXTRA: FaceSet[] = [
  face('artbook_elder'),
  face('artbook_middle'),
  face('artbook_granny'),
];

// Each volume beautifies its core customer plus these extra archetypes
// (indexes into ARTBOOK_EXTRA: elder 0, middle 1, granny 2). Only with all
// three volumes applied is every customer 미형.
const ARTBOOK_EXTRA_BY_CORE: number[][] = [
  [0, 1], // artbook_1: elder + middle
  [2, 1], // artbook_2: granny + middle
  [0, 2], // artbook_3: elder + granny
];

interface FaceTexSet {
  neutral: THREE.Texture;
  happy: THREE.Texture;
  angry: THREE.Texture;
}

export class TteokScene {
  private renderer!: WebGPURenderer;
  private scene = new THREE.Scene();
  private camera!: THREE.PerspectiveCamera;
  private baseCamPos = new THREE.Vector3(0, 3.9, 6.9);
  private baseLookY = 1.7;
  private clock = new THREE.Clock();
  private canvas: HTMLCanvasElement;

  private dough!: THREE.Mesh;
  private doughPulse = 0;
  private basin!: THREE.Group;
  private mallet: MalletSprite | null = null;
  private customer: SpriteActor | null = null;
  private customerTexs: FaceTexSet[] = [];
  private artbookTexs: FaceTexSet[] = [];
  private artbookExtraTexs: FaceTexSet[] = [];
  private appliedArtbooks = new Set<number>();
  private powder: Powder | null = null;
  private coinTex: THREE.Texture | null = null;

  private shakeAmp = 0;
  private fillCurrent = 0.02;
  private fillTarget = 0.02;
  private basinFlipT = -1;
  private coins: Array<{ mesh: THREE.Mesh; t: number; from: THREE.Vector3 }> = [];
  private elapsed = 0;

  /** Optional per-frame callback (drives React-side timers). */
  onFrame: ((dt: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init(): Promise<void> {
    this.renderer = new WebGPURenderer({
      canvas: this.canvas,
      antialias: true,
    });
    await this.renderer.init();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color(0xd9a86c);
    // Warm haze blending the ground into the painted backdrop.
    this.scene.fog = new THREE.Fog(0xd9a86c, 9, 30);

    this.camera = new THREE.PerspectiveCamera(
      42,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 3.9, 6.9);
    this.camera.lookAt(0, 1.7, 0);
    this.fitCameraToViewport();

    // Warm marketplace lighting for the 3D props.
    const hemi = new THREE.HemisphereLight(0xffe6c0, 0x6b4c30, 1.7);
    const sun = new THREE.DirectionalLight(0xffd9a0, 3.2);
    sun.position.set(4, 9, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -6;
    sun.shadow.camera.right = 6;
    sun.shadow.camera.top = 6;
    sun.shadow.camera.bottom = -6;
    const lantern = new THREE.PointLight(0xff9a3c, 20, 12, 1.6);
    lantern.position.set(-2.4, 3.2, 1.6);
    const fillLight = new THREE.PointLight(0xfff0d0, 10, 10, 1.8);
    fillLight.position.set(2.5, 2.6, 3.5);
    this.scene.add(hemi, sun, lantern, fillLight);

    // Generated textures.
    const loader = new THREE.TextureLoader();
    const tex = (url: string, repeat = 1) => {
      const t = loader.load(url);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
      return t;
    };
    const woodTex = tex('/assets/textures/pine_wood_worn.png');
    const riceTex = tex('/assets/textures/rice_dough_albedo.png', 2);
    this.coinTex = tex('/assets/textures/sangpyeong_tongbo.png');
    this.coinTex.wrapS = this.coinTex.wrapT = THREE.ClampToEdgeWrapping;
    // Await sprite textures so aspect ratios are known before rig creation.
    const loadTex = async (u: string) => {
      const t = await loader.loadAsync(u);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const loadFace = async (f: FaceSet): Promise<FaceTexSet> => ({
      neutral: await loadTex(f.neutral),
      happy: await loadTex(f.happy),
      angry: await loadTex(f.angry),
    });
    this.customerTexs = await Promise.all(CUSTOMER_SETS.map((s) => loadFace(s.chibi)));
    this.artbookTexs = await Promise.all(CUSTOMER_SETS.map((s) => loadFace(s.artbook)));
    this.artbookExtraTexs = await Promise.all(ARTBOOK_EXTRA.map(loadFace));

    // 2.5D painted backdrop (Hanyang market), slightly curved vignette feel.
    const backdropTex = loader.load('/assets/textures/market_backdrop.jpg');
    backdropTex.colorSpace = THREE.SRGBColorSpace;
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 19.1),
      new THREE.MeshBasicMaterial({ map: backdropTex, fog: false })
    );
    backdrop.position.set(0, 6.4, -13);
    this.scene.add(backdrop);

    // Ground strip blending the backdrop into the counter.
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(24, 40),
      new THREE.MeshStandardMaterial({ color: 0xc89858, roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Counter table.
    const counterMat = new THREE.MeshStandardMaterial({
      map: woodTex,
      color: 0xc09058,
      roughness: 0.8,
    });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.4, 2.9), counterMat);
    counter.position.set(0, 1.0, 0.2);
    counter.castShadow = counter.receiveShadow = true;
    this.scene.add(counter);
    for (const [x, z] of [[-3.2, -1], [3.2, -1], [-3.2, 1.4], [3.2, 1.4]] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.0, 0.35), counterMat);
      leg.position.set(x, 0.5, z);
      leg.castShadow = true;
      this.scene.add(leg);
    }

    // Basin (솥단지) and dough.
    this.basin = buildBasin(woodTex);
    this.basin.position.copy(BASIN_POS);
    this.basin.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
    this.scene.add(this.basin);

    const doughGeo = new THREE.CylinderGeometry(1.02, 0.95, 1, 36, 8);
    doughGeo.translate(0, 0.5, 0); // anchor bottom so scale.y rises upward
    const doughMat = new THREE.MeshPhysicalMaterial({
      map: riceTex,
      color: 0xfff7ea,
      roughness: 0.3,
      transmission: 0.42,
      thickness: 1.4,
      attenuationColor: new THREE.Color(0xffe4bb),
      attenuationDistance: 1.8,
      sheen: 0.7,
      sheenColor: new THREE.Color(0xfff3d6),
      clearcoat: 0.75, // sesame oil gloss
      clearcoatRoughness: 0.35,
      ior: 1.35,
    });
    this.dough = new THREE.Mesh(doughGeo, doughMat);
    this.dough.position.set(BASIN_POS.x, BASIN_FLOOR, BASIN_POS.z);
    this.dough.scale.set(1, 0.02, 1);
    this.dough.castShadow = this.dough.receiveShadow = true;
    this.scene.add(this.dough);

    // Mallet sprite leaning beside the basin.
    const malletTex = await loader.loadAsync('/assets/textures/mallet_sprite.png');
    malletTex.colorSpace = THREE.SRGBColorSpace;
    this.mallet = new MalletSprite(malletTex, 1.5);
    this.mallet.setPosition(1.9, BASIN_POS.y + 1.15, BASIN_POS.z + 0.1);
    this.scene.add(this.mallet.mesh);

    // Vessel props lined on the counter.
    const props: Array<[Vessel['id'], number, number]> = [
      ['seom', -2.9, -0.4],
      ['mal', -2.0, 0.9],
      ['doe', 2.1, 0.9],
      ['hop', 2.9, -0.3],
    ];
    for (const [id, x, z] of props) {
      const p = buildVesselProp(id, woodTex);
      p.position.set(x, 1.22, z);
      p.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = true;
      });
      this.scene.add(p);
    }

    // Powder particles (GPU compute or CPU fallback).
    this.powder = createPowder(this.renderer, makePowderSprite());
    this.scene.add(this.powder.object3d);

    this.spawnCustomer();
    window.addEventListener('resize', this.handleResize);
    this.renderer.setAnimationLoop(this.frame);
  }

  private handleResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.fitCameraToViewport();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  /**
   * The scene is composed for landscape. On narrow (portrait/phone) screens
   * we widen the FOV and pull the camera back so the customer, basin and
   * mallet all stay inside the frame instead of being cropped away.
   */
  private fitCameraToViewport(): void {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera.aspect = aspect;
    // t = 0 at desktop-wide (1.6+), t = 1 around a tall phone (~0.46).
    const t = THREE.MathUtils.clamp((1.6 - aspect) / (1.6 - 0.46), 0, 1);
    this.camera.fov = 42 + t * 34; // up to ~76° on portrait phones
    const dist = 6.9 + t * 3.4;
    this.baseCamPos.set(0, 3.9 + t * 0.9, dist);
    this.baseLookY = 1.7 + t * 0.35;
    this.camera.position.copy(this.baseCamPos);
    this.camera.lookAt(0, this.baseLookY, 0);
    this.camera.updateProjectionMatrix();
  }

  /** Fresh customer for a new round; restores basin/dough state. */
  resetRound(): void {
    this.spawnCustomer();
    this.customer?.talk();
    this.fillCurrent = this.fillTarget = 0.02;
    this.basinFlipT = -1;
    this.basin.rotation.set(0, 0, 0);
    this.basin.position.copy(BASIN_POS);
    for (const c of this.coins) this.scene.remove(c.mesh);
    this.coins = [];
  }

  /** Apply purchased artbook volumes (core indexes 0-2); empty = all chibi. */
  setArtbooks(coreIndexes: number[]): void {
    this.appliedArtbooks = new Set(
      coreIndexes.filter((i) => i >= 0 && i < CUSTOMER_SETS.length)
    );
    this.spawnCustomer();
  }

  private spawnCustomer(): void {
    if (this.customer) this.scene.remove(this.customer.mesh);
    // On narrow screens everything compresses horizontally, so nudge the
    // customer toward the center and shrink them a touch to stay visible.
    const aspect = window.innerWidth / window.innerHeight;
    const pt = THREE.MathUtils.clamp((1.1 - aspect) / (1.1 - 0.46), 0, 1);
    // Partial application: each applied volume swaps in its own 미형 core
    // customer and adds its extra 미형 archetypes; the rest stay chibi.
    const pool: Array<{ set: FaceTexSet; artbook: boolean }> =
      CUSTOMER_SETS.map((_, i) => ({
        set: this.appliedArtbooks.has(i)
          ? this.artbookTexs[i]
          : this.customerTexs[i],
        artbook: this.appliedArtbooks.has(i),
      }));
    const extras = new Set<number>();
    for (const i of this.appliedArtbooks) {
      for (const e of ARTBOOK_EXTRA_BY_CORE[i] ?? []) extras.add(e);
    }
    for (const e of extras) {
      pool.push({ set: this.artbookExtraTexs[e], artbook: true });
    }
    const pick = pool[Math.floor(Math.random() * pool.length)] ?? pool[0];
    if (!pick) return;
    // Artbook illustrations are taller and push further left so the speech
    // bubble never covers the character; chibi keeps the chunky size.
    const height = (pick.artbook ? 3.9 : 3.8) * (1 - pt * 0.18);
    const x = (pick.artbook ? -3.15 : -2.35) * (1 - pt * 0.38);
    this.customer = new SpriteActor(pick.set.neutral, height, pick.artbook);
    this.customer.setExpressions(pick.set.happy, pick.set.angry);
    // z = -2.45 keeps the character fully behind the basin wall (z = -0.8),
    // so the depth-based occlusion always hides any overlap cleanly.
    this.customer.setPosition(x, 0.72, -2.45);
    this.scene.add(this.customer.mesh);
    this.customer.spawn();
  }

  /** Dark soybean powder pour (검은 콩 part of a two-bean order). */
  setPowderDark(dark: boolean): void {
    this.powder?.setDark(dark);
  }

  /** Mix ratio 0..1 darkens the dough (searchdeul kneaded in). */
  setMixRatio(ratio: number): void {
    const r = THREE.MathUtils.clamp(ratio, 0, 1);
    const c = new THREE.Color(0xfff7ea).lerp(new THREE.Color(0x8a7460), r * 0.65);
    (this.dough.material as THREE.MeshPhysicalMaterial).color.copy(c);
  }

  /** Fill ratio 0..1 drives dough height (the only gauge the player gets). */
  setFill(ratio: number): void {
    this.fillTarget = THREE.MathUtils.clamp(ratio, 0.02, 1);
  }

  /** Visual feedback for a pour: powder burst, dough pulse, screen shake. */
  pour(vessel: Vessel, scoopOut: boolean): void {
    const hop = vessel.deltaHop;
    const count = hop >= 1500 ? 3200 : hop >= 100 ? 1400 : hop >= 10 ? 450 : 90;
    const origin = new THREE.Vector3(
      BASIN_POS.x + (Math.random() - 0.5) * 0.4,
      BASIN_POS.y + 2.6,
      BASIN_POS.z + (Math.random() - 0.5) * 0.3
    );
    this.powder?.burst(origin, {
      count,
      speed: scoopOut ? 2.2 : 3.4,
      spread: hop >= 1500 ? 0.9 : hop >= 100 ? 0.55 : 0.3,
    });
    this.doughPulse = Math.min(1, 0.3 + hop / 1500);
    this.shakeAmp = Math.min(1.8, this.shakeAmp + vessel.shake);
  }

  /** Swing the mallet sprite onto the dough (one rhythmic pound). */
  pound(): void {
    this.mallet?.pound();
  }

  /** Customer verdict reaction. */
  react(grade: Grade): void {
    this.customer?.react(grade);
    if (grade === 'fail') {
      this.basinFlipT = 0;
      this.shakeAmp = 2.2;
      this.powder?.burst(new THREE.Vector3(BASIN_POS.x, BASIN_POS.y + 1.4, BASIN_POS.z), {
        count: 2600,
        speed: 1.6,
        spread: 1.4,
      });
    }
    if (grade === 'perfect') this.tossCoins();
  }

  private tossCoins(): void {
    if (!this.coinTex) return;
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.coinTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      const coin = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), mat);
      const from = new THREE.Vector3(
        (Math.random() - 0.5) * 0.8,
        2.6 + Math.random() * 0.4,
        -1.1
      );
      coin.position.copy(from);
      this.scene.add(coin);
      this.coins.push({ mesh: coin, t: -i * 0.12, from });
    }
  }

  private frame = (): void => {
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    this.elapsed += dt;
    this.onFrame?.(dt);

    // Dough fill easing + pulse squash.
    this.fillCurrent += (this.fillTarget - this.fillCurrent) * Math.min(1, dt * 6);
    this.doughPulse = Math.max(0, this.doughPulse - dt * 2.2);
    const h = this.fillCurrent * DOUGH_MAX_HEIGHT;
    const squash = 1 + this.doughPulse * 0.18;
    this.dough.scale.set(squash, Math.max(0.02, h) / squash, squash);
    const doughTop = BASIN_FLOOR + this.dough.scale.y;
    this.powder?.setFloorY(doughTop + 0.03);
    this.powder?.update(dt);

    // Mallet swing; the impact frame dents the dough.
    if (this.mallet?.update(dt)) {
      this.doughPulse = 0.55;
      this.shakeAmp = Math.min(1.6, this.shakeAmp + 0.45);
    }

    // Customer sprite actor.
    this.customer?.update(dt, this.elapsed);

    // Basin flip on failure.
    if (this.basinFlipT >= 0) {
      this.basinFlipT += dt * 2.4;
      const t = Math.min(1, this.basinFlipT);
      const ease = t * t;
      this.basin.rotation.z = -ease * 1.35;
      this.basin.position.y = BASIN_POS.y + Math.sin(t * Math.PI) * 0.5;
      this.basin.position.x = BASIN_POS.x - ease * 0.9;
      if (t >= 1) this.basinFlipT = -1;
    }

    // Flying coins (perfect grade tip).
    for (const coin of this.coins) {
      coin.t += dt;
      if (coin.t < 0) continue;
      const t = coin.t / 0.9;
      if (t >= 1) {
        this.scene.remove(coin.mesh);
        continue;
      }
      const target = new THREE.Vector3(0.6, 1.35, 0.9);
      coin.mesh.position.lerpVectors(coin.from, target, t);
      coin.mesh.position.y += Math.sin(t * Math.PI) * 1.1;
      coin.mesh.rotation.y += dt * 12;
      coin.mesh.lookAt(this.camera.position);
    }
    if (this.coins.length && this.coins.every((c) => c.t >= 1)) this.coins = [];

    // Camera shake + subtle idle sway (drives the 2.5D parallax).
    this.shakeAmp = Math.max(0, this.shakeAmp - dt * 2.4);
    const s = this.shakeAmp * 0.14;
    this.camera.position.set(
      this.baseCamPos.x + Math.sin(this.elapsed * 0.4) * 0.12 + (Math.random() - 0.5) * s,
      this.baseCamPos.y + Math.sin(this.elapsed * 0.7) * 0.06 + (Math.random() - 0.5) * s,
      this.baseCamPos.z + (Math.random() - 0.5) * s
    );
    this.camera.lookAt(0, this.baseLookY, 0);

    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
  }
}
