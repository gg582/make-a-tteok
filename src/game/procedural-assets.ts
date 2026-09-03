/**
 * Procedural stylized props (Overcooked-style chunky primitives, smoothed).
 * Customers are NOT built here — they are AI-illustrated 2.5D billboard
 * sprites (see scene.ts), matching the Live2D-like direction.
 */
import * as THREE from 'three';

function std(color: number, roughness = 0.85): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

/** Open wooden basin (솥단지) that holds the dough. */
export function buildBasin(woodTex: THREE.Texture | null): THREE.Group {
  const g = new THREE.Group();
  // The basin is built from an opaque INNER shell (front half hidden) plus a
  // translucent OUTER shell. The outer shell renders after the customer
  // sprite (renderOrder 2 > 1) so any overlap is tinted dark, while the
  // opaque inner shell still writes depth so characters behind the basin
  // never bleed visibly through its near wall.
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x6b4a2e,
    roughness: 0.8,
    metalness: 0.05,
    map: woodTex,
  });
  const outerMat = wallMat.clone();
  outerMat.transparent = true;
  outerMat.opacity = 0.9;
  outerMat.depthWrite = false;
  const outer = new THREE.Mesh(
    new THREE.CylinderGeometry(1.25, 1.05, 1.15, 40, 1, true),
    outerMat
  );
  outer.position.y = 0.575;
  outer.renderOrder = 2;
  // Inner opaque shell: FULL cylinder (BackSide, so from the camera we see
  // the inside of the far wall). It writes depth all the way around, so the
  // customer sprite behind the basin can never bleed through the outer
  // translucent shell, and the dough inside stays visible above the floor.
  const innerMat = wallMat.clone();
  innerMat.side = THREE.BackSide;
  const inner = new THREE.Mesh(
    new THREE.CylinderGeometry(1.245, 1.045, 1.15, 40, 1, true),
    innerMat
  );
  inner.position.y = 0.575;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.09, 14, 40), wallMat.clone());
  (rim.material as THREE.MeshStandardMaterial).color.set(0x59391f);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 1.15;
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.08, 40), wallMat.clone());
  (floor.material as THREE.MeshStandardMaterial).color.set(0x4a3018);
  floor.position.y = 0.04;
  g.add(inner, outer, rim, floor);
  return g;
}

/** Domed glutinous rice dough body (bottom-anchored for scale.y fill). */
export function buildDoughGeometry(): THREE.LatheGeometry {
  const profile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.9, 0.0),
    new THREE.Vector2(1.0, 0.14),
    new THREE.Vector2(1.04, 0.45),
    new THREE.Vector2(1.0, 0.78),
    new THREE.Vector2(0.84, 0.94),
    new THREE.Vector2(0.48, 1.0),
    new THREE.Vector2(0.0, 1.0),
  ];
  return new THREE.LatheGeometry(profile, 48);
}

/** Wooden mallet (떡메) with rounded capsule head; pivot at the grip. */
export function buildMallet(woodTex: THREE.Texture | null): THREE.Group {
  const pivot = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x8a6238,
    roughness: 0.7,
    map: woodTex,
  });
  const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.9, 6, 12), mat);
  handle.position.y = -0.5;
  const headM = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.32, 8, 20), mat.clone());
  (headM.material as THREE.MeshStandardMaterial).color.set(0x6f4526);
  headM.position.y = -1.08;
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.055, 0.018, 8, 16),
    std(0x3a2a18, 0.6)
  );
  band.position.y = -0.88;
  band.rotation.x = Math.PI / 2;
  pivot.add(handle, headM, band);
  return pivot;
}

/** Small vessel props decorating the counter. */
export function buildVesselProp(
  id: 'seom' | 'mal' | 'doe' | 'hop',
  woodTex: THREE.Texture | null
): THREE.Object3D {
  if (id === 'seom') {
    // Straw rice sack (가마니): squashed sphere with rope band.
    const g = new THREE.Group();
    const sack = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 24, 18),
      std(0xc9a35f, 0.95)
    );
    sack.scale.set(1, 0.78, 1);
    const rope = new THREE.Mesh(
      new THREE.TorusGeometry(0.3, 0.03, 10, 24),
      std(0x7a5a30, 0.9)
    );
    rope.rotation.x = Math.PI / 2;
    rope.position.y = 0.12;
    g.add(sack, rope);
    return g;
  }
  if (id === 'mal') {
    // Gourd ladle (바가지): open half-sphere bowl.
    const bowl = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: 0xd9b06a,
        roughness: 0.7,
        side: THREE.DoubleSide,
      })
    );
    bowl.rotation.x = Math.PI;
    bowl.position.y = 0.26;
    return bowl;
  }
  if (id === 'doe') {
    // Wooden measuring box (됫박) with a rim band.
    const g = new THREE.Group();
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.24, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x9a6b3a, roughness: 0.8, map: woodTex })
    );
    box.position.y = 0.12;
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(0.37, 0.05, 0.37),
      std(0x54350f, 0.7)
    );
    band.position.y = 0.22;
    g.add(box, band);
    return g;
  }
  // Spoon (숟가락): slim handle + tiny bowl.
  const g = new THREE.Group();
  const mat = std(0xb9b3a6, 0.35);
  const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.32, 4, 8), mat);
  handle.rotation.z = Math.PI / 2.3;
  const cup = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), mat);
  cup.scale.set(1, 0.5, 1);
  cup.position.set(0.15, 0.08, 0);
  g.add(handle, cup);
  return g;
}
