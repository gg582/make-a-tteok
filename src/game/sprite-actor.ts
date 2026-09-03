/**
 * SpriteActor — a 2.5D "paper doll" character: an unlit illustration on a
 * bottom-anchored plane, animated with Live2D-style squash & stretch,
 * breathing, nods, jumps and rage shakes. Reads as a Live2D rig without
 * needing per-part artwork.
 */
import * as THREE from 'three';
import type { Grade } from './metrology';

type ReactState = 'idle' | Grade;

export class SpriteActor {
  readonly mesh: THREE.Mesh;
  private basePos: THREE.Vector3;
  private state: ReactState = 'idle';
  private stateT = 0;
  private spawnT = 0; // entrance ease
  private talkPulse = 0;
  private phase = Math.random() * Math.PI * 2;
  /** Artbook mode = visual-novel style breathing/sway (Live2D-like). */
  private artbook: boolean;
  private neutralTex: THREE.Texture;
  private happyTex: THREE.Texture | null = null;
  private angryTex: THREE.Texture | null = null;

  constructor(texture: THREE.Texture, height = 3.0, artbook = false) {
    this.artbook = artbook;
    const img = texture.image as { width: number; height: number };
    const aspect = img && img.height ? img.width / img.height : 0.55;
    const geo = new THREE.PlaneGeometry(height * aspect, height);
    geo.translate(0, height / 2, 0); // anchor at the feet
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.05,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 1; // before the translucent basin wall (2)
    this.basePos = new THREE.Vector3();
    this.neutralTex = texture;
  }

  /** Attach expression variants swapped in on verdict (happy / angry). */
  setExpressions(happy: THREE.Texture | null, angry: THREE.Texture | null): void {
    this.happyTex = happy;
    this.angryTex = angry;
  }

  private setFace(tex: THREE.Texture | null): void {
    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    const next = tex ?? this.neutralTex;
    if (mat.map !== next) {
      mat.map = next;
      mat.needsUpdate = true;
    }
  }

  setPosition(x: number, y: number, z: number): void {
    this.basePos.set(x, y, z);
    this.mesh.position.copy(this.basePos);
  }

  /** Pop-in entrance when a new customer arrives. */
  spawn(): void {
    this.spawnT = 0.0001;
    this.state = 'idle';
    this.stateT = 0;
    this.mesh.rotation.set(0, 0, 0);
    this.setFace(this.neutralTex);
  }

  /** Small squash bounce when the customer barks a line. */
  talk(): void {
    this.talkPulse = 1;
  }

  react(grade: Grade): void {
    this.state = grade;
    this.stateT = 0;
    // Face swap so the three verdicts read differently:
    // perfect = beaming smile, success(애매) = blank default face + nod,
    // fail = furious pout.
    if (grade === 'perfect') this.setFace(this.happyTex);
    else if (grade === 'success') this.setFace(this.neutralTex);
    else this.setFace(this.angryTex);
  }

  update(dt: number, elapsed: number): void {
    const m = this.mesh;
    let sx = 1;
    let sy = 1;
    let y = this.basePos.y;
    let rotZ = 0;
    let rotX = 0;

    // Entrance: elastic overshoot scale-in.
    if (this.spawnT > 0) {
      this.spawnT = Math.min(1, this.spawnT + dt * 2.6);
      const t = this.spawnT;
      const back = 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2) * Math.sin((t - 1) * 6);
      sx = sy = Math.max(0.01, back);
      if (t >= 1) this.spawnT = 0;
    }

    // Idle breathing (Live2D-style param loop).
    const breathe = Math.sin((elapsed + this.phase) * 2.1);
    if (this.artbook) {
      // Visual-novel sway: gentle breathing + drifting tilt + slow bob,
      // like a Live2D rig with a "waiting" motion group.
      sy *= 1 + breathe * 0.024;
      sx *= 1 - breathe * 0.012;
      rotZ += Math.sin((elapsed + this.phase) * 0.9) * 0.028;
      y += Math.sin((elapsed + this.phase) * 0.6) * 0.05;
    } else {
      sy *= 1 + breathe * 0.018;
      sx *= 1 - breathe * 0.01;
      rotZ += Math.sin((elapsed + this.phase) * 1.2) * 0.02;
    }

    // Talk squash.
    if (this.talkPulse > 0) {
      this.talkPulse = Math.max(0, this.talkPulse - dt * 3);
      const k = Math.sin(this.talkPulse * Math.PI);
      sy *= 1 - k * 0.08;
      sx *= 1 + k * 0.06;
    }

    // Reactions.
    if (this.state !== 'idle') {
      this.stateT += dt;
      const t = this.stateT;
      if (this.state === 'perfect') {
        const decay = Math.max(0, 1 - t / 2.0);
        y += Math.abs(Math.sin(t * 8)) * 0.4 * decay;
        rotZ += Math.sin(t * 8) * 0.12 * decay;
        sy *= 1 + Math.sin(t * 16) * 0.04 * decay;
        if (t > 2.0) this.state = 'idle';
      } else if (this.state === 'success') {
        const decay = Math.max(0, 1 - t / 1.4);
        rotX += Math.sin(t * 7) * 0.18 * decay; // nodding
        if (t > 1.4) this.state = 'idle';
      } else {
        // fail: furious tremble + lean-in threat
        const decay = Math.max(0, 1 - t / 1.8);
        rotZ += Math.sin(t * 26) * 0.05 * decay;
        rotX -= 0.12 * Math.min(1, t * 4) * decay;
        const grow = 1 + Math.min(1, t * 4) * 0.1 * decay;
        sx *= grow;
        sy *= grow;
        if (t > 1.8) this.state = 'idle';
      }
    }

    m.position.set(this.basePos.x, y, this.basePos.z);
    m.scale.set(sx, sy, 1);
    m.rotation.set(rotX, 0, rotZ);
  }
}

/** Swinging mallet sprite (떡메): rests angled, slams down on pound. */
export class MalletSprite {
  readonly mesh: THREE.Mesh;
  private poundT = -1;
  private baseY: number;

  constructor(texture: THREE.Texture, size = 1.7) {
    const img = texture.image as { width: number; height: number };
    const aspect = img && img.height ? img.width / img.height : 1;
    const geo = new THREE.PlaneGeometry(size * aspect, size);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.05,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 3; // mallet floats in front of the basin
    this.baseY = 0;
  }

  setPosition(x: number, y: number, z: number): void {
    this.baseY = y;
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.z = -0.55;
  }

  pound(): void {
    if (this.poundT < 0) this.poundT = 0;
  }

  /** Returns true exactly once at the impact frame. */
  update(dt: number): boolean {
    if (this.poundT < 0) return false;
    this.poundT += dt * 4.6;
    const t = this.poundT;
    let impact = false;
    if (t < 0.3) {
      const k = t / 0.3;
      const e = k * k;
      this.mesh.rotation.z = -0.55 - e * 0.75;
      this.mesh.position.y = this.baseY - e * 0.55;
    } else if (t < 1) {
      if (t - dt * 4.6 < 0.3) impact = true;
      const k = (t - 0.3) / 0.7;
      const spring = Math.sin(k * Math.PI) * 0.18 * (1 - k);
      this.mesh.rotation.z = -1.3 + k * 0.75 + spring;
      this.mesh.position.y = this.baseY - 0.55 + k * 0.55;
    } else {
      this.mesh.rotation.z = -0.55;
      this.mesh.position.y = this.baseY;
      this.poundT = -1;
    }
    return impact;
  }
}
