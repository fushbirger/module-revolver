import * as THREE from 'three';

export function mk(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

// flat-shaded, desaturated material helper (ULTRAKILL-ish)
const std = (color, o = {}) =>
  new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true, ...o, color });

/* ------------------------------------------------------------------ CASINO + ROUND PEDESTAL TABLE
   The environment is constructed once and is deliberately not animated.
   The table is a fixed, round, dark-wood veneer pedestal table. */
function seeded(seed) {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
}

function makeVeneerTexture() {
  const c = Object.assign(document.createElement('canvas'), { width: 768, height: 768 });
  const g = c.getContext('2d');
  const rand = seeded(7319);
  const base = g.createLinearGradient(0, 0, 768, 768);
  base.addColorStop(0, '#493025'); base.addColorStop(.45, '#302019'); base.addColorStop(1, '#211714');
  g.fillStyle = base; g.fillRect(0, 0, 768, 768);

  // Long, irregular veneer fibres with subtle tonal variation.
  for (let i = 0; i < 210; i++) {
    const y = rand() * 768, amp = 2 + rand() * 11, freq = .004 + rand() * .012;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= 768; x += 24) {
      const yy = y + Math.sin(x * freq + i) * amp + Math.sin(x * freq * .31 + i * 2) * amp * .55;
      g.lineTo(x, yy);
    }
    const light = rand() > .55;
    g.strokeStyle = light ? `rgba(150,104,70,${.035 + rand()*.075})` : `rgba(8,5,4,${.07 + rand()*.11})`;
    g.lineWidth = .5 + rand() * 2.3; g.stroke();
  }
  // A few quiet knots and flowing grain loops make it read as wood, not a flat colour.
  for (let k = 0; k < 7; k++) {
    const x = 60 + rand() * 648, y = 60 + rand() * 648;
    for (let r = 5; r < 42; r += 5) {
      g.beginPath(); g.ellipse(x, y, r * (1.6 + rand()*.25), r * .42, rand()*.18, 0, Math.PI*2);
      g.strokeStyle = `rgba(145,96,63,${.08-r/900})`; g.lineWidth = 1; g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function addBox(parent, w, h, d, mat, x, y, z, rx=0, ry=0, rz=0) {
  const m = mk(new THREE.BoxGeometry(w,h,d), mat, x,y,z,rx,ry,rz);
  parent.add(m); return m;
}

export function createEnvironment(scene) {
  const woodTex = makeVeneerTexture();
  const wood = new THREE.MeshStandardMaterial({ map: woodTex, roughness: .58, metalness: .04 });
  const darkWood = std(0x211714, { roughness: .72 });
  const blackMetal = std(0x101114, { roughness: .48, metalness: .72 });
  const brass = std(0x756044, { roughness: .42, metalness: .72 });
  const wall = std(0x111014, { roughness: .94 });
  const velvet = std(0x251316, { roughness: .96 });
  const floorMat = std(0x171619, { roughness: .34, metalness: .22 });

  // Casino floor, room shell and ceiling. The camera remains inside the room.
  scene.add(mk(new THREE.PlaneGeometry(24,24), floorMat, 0,-1.43,-1.0, -Math.PI/2,0,0, false));
  scene.add(mk(new THREE.BoxGeometry(19,.22,19), wall, 0,6.1,-1.0, 0,0,0, false));
  scene.add(mk(new THREE.BoxGeometry(19,8.0,.34), wall, 0,2.55,-9.4, 0,0,0, false));
  scene.add(mk(new THREE.BoxGeometry(.34,8.0,18.8), wall, -9.35,2.55,-.1, 0,0,0, false));
  scene.add(mk(new THREE.BoxGeometry(.34,8.0,18.8), wall, 9.35,2.55,-.1, 0,0,0, false));

  // Dark polished floor inlays: restrained brass lines and a central circular carpet.
  for (let i = -3; i <= 3; i++) {
    const line = mk(new THREE.BoxGeometry(.012,.006,18), std(0x38302a,{roughness:.5,metalness:.45}), i*2.25,-1.418,-1.0,0,0,0,false);
    scene.add(line);
  }
  const carpet = mk(new THREE.CylinderGeometry(4.65,4.65,.025,96), std(0x211719,{roughness:1}), 0,-1.405,-.2,0,0,0,false);
  scene.add(carpet);
  const carpetEdge = mk(new THREE.TorusGeometry(4.52,.025,6,96), brass, 0,-1.385,-.2,Math.PI/2,0,0,false);
  scene.add(carpetEdge);

  // Far-wall velvet panels, vertical brass reveals and architectural pilasters.
  for (let i=0;i<7;i++) {
    const x=-7.2+i*2.4;
    scene.add(mk(new THREE.BoxGeometry(2.05,4.4,.08), velvet, x,2.55,-9.18,0,0,0,false));
    scene.add(mk(new THREE.BoxGeometry(.035,4.55,.11), brass, x-1.08,2.55,-9.10,0,0,0,false));
  }
  for (const x of [-7.8,-5.2,5.2,7.8]) {
    const pillar = new THREE.Group(); pillar.position.set(x,0,-7.2);
    pillar.add(
      mk(new THREE.BoxGeometry(.48,6.4,.5), blackMetal,0,1.75,0),
      mk(new THREE.BoxGeometry(.62,.18,.64), brass,0,-1.35,0),
      mk(new THREE.BoxGeometry(.62,.18,.64), brass,0,4.95,0),
      mk(new THREE.BoxGeometry(.54,5.7,.56), velvet,0,1.75,.04)
    ); scene.add(pillar);
  }

  // Distant casino cabinets: recognisable silhouettes, subdued screens, no UI text.
  for (let i=0;i<5;i++) {
    const x=-6.4+i*3.2, cab=new THREE.Group(); cab.position.set(x,-1.38,-8.05);
    cab.add(
      mk(new THREE.BoxGeometry(1.15,2.65,.72), blackMetal,0,1.32,0),
      mk(new THREE.BoxGeometry(.91,1.12,.045), std(0x282127,{roughness:.42,metalness:.25}),0,1.77,.38),
      mk(new THREE.BoxGeometry(.86,.46,.05), std(0x36251e,{roughness:.45}),0,.86,.39),
      mk(new THREE.BoxGeometry(1.2,.08,.78), brass,0,2.67,0),
      mk(new THREE.BoxGeometry(1.22,.16,.82), blackMetal,0,.08,0),
      mk(new THREE.BoxGeometry(.12,1.95,.08), brass,-.51,1.35,.39),
      mk(new THREE.BoxGeometry(.12,1.95,.08), brass,.51,1.35,.39),
      mk(new THREE.BoxGeometry(.68,.07,.06), brass,0,1.02,.44)
    );
    // Small physical control keys below each dark screen; no glowing self-lit figures.
    for(let b=0;b<3;b++) cab.add(mk(new THREE.CylinderGeometry(.035,.035,.025,10),brass,-.22+b*.22,1.02,.455,Math.PI/2,0,0));
    const screen = mk(new THREE.PlaneGeometry(.72,.88), new THREE.MeshBasicMaterial({color:i%2?0x40262d:0x34302a}),0,1.78,.411,0,0,0,false);
    cab.add(screen); scene.add(cab);
  }

  // Overhead casino canopy and circular brass light track above the table.
  const canopy = mk(new THREE.TorusGeometry(3.85,.075,8,96), brass,0,5.15,-.35,Math.PI/2,0,0,false);
  scene.add(canopy);
  const innerTrack = mk(new THREE.TorusGeometry(3.25,.035,6,96), blackMetal,0,5.08,-.35,Math.PI/2,0,0,false);
  scene.add(innerTrack);
  addBox(scene, 7.8,.12,.18, blackMetal,0,5.55,-.35);

  // Pendant fixtures with actual point lights; these lights reveal the silhouettes
  // from above and behind instead of making the figures glow by themselves.
  const bulbs=[];
  const fixturePositions=[[-3.0,4.85,-2.8],[-1.1,5.0,-3.8],[1.1,5.0,-3.8],[3.0,4.85,-2.8],[-3.8,4.75,.1],[3.8,4.75,.1]];
  for (let i=0;i<fixturePositions.length;i++) {
    const [x,y,z]=fixturePositions[i], fixture=new THREE.Group(); fixture.position.set(x,y,z);
    fixture.add(
      mk(new THREE.CylinderGeometry(.035,.035,.48,8), brass,0,.18,0),
      mk(new THREE.TorusGeometry(.28,.035,6,24), brass,0,-.08,0),
      mk(new THREE.SphereGeometry(.12,12,10), new THREE.MeshBasicMaterial({color:0xe0c18a}),0,-.08,0)
    ); scene.add(fixture);
    const light=new THREE.PointLight(0xd8c39b, 34, 8, 1.8);
    light.position.set(x,y-.18,z); light.castShadow = i===1 || i===2; scene.add(light);
    bulbs.push({mesh:fixture, light});
  }
  // A low, warm central pool of light keeps the tabletop readable.
  const tablePool = new THREE.SpotLight(0xe1c99e, 95, 12, Math.PI/3.2, .48, 1.2);
  tablePool.position.set(0,5.35,.4); tablePool.target.position.set(0,.05,-.25);
  tablePool.castShadow=true; scene.add(tablePool,tablePool.target);

  // Round veneer tabletop, layered edge, dark apron and a single central pedestal.
  const table = new THREE.Group();
  table.name='Permanent round wooden-veneer pedestal table';
  const radius=2.58, topY=.14, thickness=.24;
  table.add(
    mk(new THREE.CylinderGeometry(radius,radius,thickness,112,1,false), darkWood,0,topY-thickness/2,0),
    mk(new THREE.CircleGeometry(radius-.025,112), wood,0,topY+.003,0,-Math.PI/2,0,0,false),
    mk(new THREE.TorusGeometry(radius-.035,.045,8,112), brass,0,topY-.015,0,Math.PI/2,0,0,false),
    mk(new THREE.TorusGeometry(radius-.12,.018,6,112), darkWood,0,topY-.025,0,Math.PI/2,0,0,false)
  );
  // Veneer lip and subtle underside apron.
  table.add(mk(new THREE.CylinderGeometry(radius-.06,radius-.06,.12,112),darkWood,0,topY-.22,0));
  table.add(mk(new THREE.TorusGeometry(radius-.08,.018,6,112),brass,0,topY-.245,0,Math.PI/2,0,0,false));

  // Pedestal: broad weighted foot, turned central column and collars.
  const footProfile=[new THREE.Vector2(0,0),new THREE.Vector2(.92,0),new THREE.Vector2(1.02,.07),new THREE.Vector2(1.02,.15),new THREE.Vector2(.88,.22),new THREE.Vector2(.62,.28),new THREE.Vector2(.42,.34),new THREE.Vector2(.34,.42),new THREE.Vector2(.34,1.18),new THREE.Vector2(.43,1.25),new THREE.Vector2(.48,1.32),new THREE.Vector2(.38,1.39),new THREE.Vector2(0,1.39)];
  const pedestal = mk(new THREE.LatheGeometry(footProfile,48),darkWood,0,-1.42,0);
  table.add(pedestal);
  table.add(
    mk(new THREE.TorusGeometry(.39,.035,8,48),brass,0,-.10,0,Math.PI/2,0,0,false),
    mk(new THREE.TorusGeometry(.38,.025,8,48),brass,0,-.02,0,Math.PI/2,0,0,false),
    mk(new THREE.TorusGeometry(.98,.025,8,96),brass,0,-1.12,0,Math.PI/2,0,0,false)
  );
  table.position.set(0,0,0);
  scene.add(table);
  // Static room and table; only the game objects are animated by main.js.
  return bulbs;
}

/* ------------------------------------------------------------------ REVOLVER
   Modelled on the reference: exposed drum between two rails, hex barrel,
   knurled rod under the barrel, spur hammer, raked grip.
   Barrel points +Z. Cylinder rotates on its own Z axis.
   Chambers sit at y = +/-0.075: slot 0 (top, in line with the barrel) is "live".
   Everything is symmetric every 180 deg so the two chambers look identical.   */
export function createGun(scene) {
  const root = new THREE.Group();
  const body = new THREE.Group();   // offset so the spin pivot is mid-gun
  body.position.z = -0.22;
  root.add(body);

  const dark  = std(0x17181a, { roughness: 0.6, metalness: 0.6 });
  const steel = std(0x6b6e72, { roughness: 0.35, metalness: 0.85 });
  const grip  = std(0x101011, { roughness: 0.9 });
  const bore  = new THREE.MeshBasicMaterial({ color: 0x020202 });
  const X = Math.PI / 2; // lay cylinders along Z

  // grip (rakes backward as it goes down)
  const gripGrp = new THREE.Group();
  gripGrp.position.set(0, -0.19, -0.36);
  gripGrp.rotation.x = 0.38;
  gripGrp.add(
    mk(new THREE.BoxGeometry(0.15, 0.42, 0.22), dark),
    mk(new THREE.BoxGeometry(0.17, 0.32, 0.15), grip, 0, -0.02, 0),
    mk(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 8), steel, 0, 0, 0, 0, 0, X)
  );

  // hammer
  const hammer = new THREE.Group();
  hammer.position.set(0, 0.12, -0.27);
  hammer.add(
    mk(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.05, -0.1), new THREE.Vector3(0, 0.17, -0.17)
    ]), 10, 0.022, 6, false), steel),
    mk(new THREE.BoxGeometry(0.03, 0.02, 0.07), steel, 0, 0.18, -0.2, 0.5, 0, 0)
  );

  // trigger
  const trigger = new THREE.Group();
  trigger.position.set(0, -0.1, -0.17);
  trigger.add(mk(new THREE.BoxGeometry(0.025, 0.11, 0.035), steel, 0, -0.04, 0.02, -0.35, 0, 0));

  // primer / thumb lever: flat paddles either side of the frame, thumb pulls them down
  const primer = new THREE.Group();
  primer.position.set(0, 0.1, -0.1);
  [-1, 1].forEach(sx => primer.add(
    mk(new THREE.BoxGeometry(0.022, 0.05, 0.12), steel, sx * 0.085, 0, -0.01),
    mk(new THREE.BoxGeometry(0.022, 0.07, 0.05), steel, sx * 0.085, 0.035, -0.07, -0.3, 0, 0)
  ));

  // cylinder (drum): rotates on Z
  const cyl = new THREE.Group();
  cyl.position.set(0, 0.08, 0.12);
  cyl.add(
    mk(new THREE.CylinderGeometry(0.15, 0.15, 0.34, 20), steel, 0, 0, 0, X, 0, 0),
    // two chambers: top (live slot) and bottom, rear + front faces
    mk(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 10), bore, 0,  0.075, -0.172, X, 0, 0),
    mk(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 10), bore, 0, -0.075, -0.172, X, 0, 0),
    mk(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 10), bore, 0,  0.075,  0.172, X, 0, 0),
    mk(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 10), bore, 0, -0.075,  0.172, X, 0, 0)
  );
  // four long flutes (90 deg symmetric -> no tell for the hidden chamber)
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4;
    cyl.add(mk(new THREE.BoxGeometry(0.035, 0.03, 0.24), bore,
      Math.cos(a) * 0.145, Math.sin(a) * 0.145, 0.0, 0, 0, a, false));
  }

  // rails, shroud, clamps, barrel, knurled rod
  body.add(
    gripGrp, hammer, trigger, primer, cyl,
    mk(new THREE.BoxGeometry(0.13, 0.34, 0.16), dark, 0, 0.07, -0.2),                 // frame
    mk(new THREE.BoxGeometry(0.13, 0.14, 0.2),  dark, 0, -0.07, -0.25),               // lower frame
    mk(new THREE.CylinderGeometry(0.016, 0.016, 0.6, 8), steel, 0, 0.2, 0.2, X, 0, 0),   // top rail
    mk(new THREE.CylinderGeometry(0.016, 0.016, 0.4, 8), steel, 0, -0.045, 0.1, X, 0, 0),// bottom rail
    mk(new THREE.CylinderGeometry(0.165, 0.165, 0.14, 20), dark, 0, 0.08, 0.31, X, 0, 0),// shroud
    mk(new THREE.BoxGeometry(0.12, 0.38, 0.05), dark, 0, 0.1, 0.49),                   // clamp
    mk(new THREE.CylinderGeometry(0.065, 0.065, 0.5, 6), steel, 0, 0.155, 0.74, X, Math.PI / 6, 0), // hex barrel
    mk(new THREE.CylinderGeometry(0.032, 0.032, 0.02, 8), bore, 0, 0.155, 0.995, X, 0, 0),         // muzzle
    mk(new THREE.CylinderGeometry(0.018, 0.018, 0.26, 8), steel, 0, 0.02, 0.4, X, 0, 0),           // knurled rod
    mk(new THREE.CylinderGeometry(0.028, 0.028, 0.06, 8), dark, 0, 0.02, 0.55, X, 0, 0)
  );

  root.position.set(0, 0.62, 0.35);
  scene.add(root);
  return { root, cyl, hammer, trigger, primer };
}


/* ------------------------------------------------------------------ CHESS-CLOCK MACHINE
   Sits at the front of the table facing the camera. Two dials + decorative
   paddles on top, and a raised back panel with one needle gauge per player:
   needle sweeps right (full) -> left (dead) as lives count down.            */
export function createMachine(scene, n = 3) {
  const W = Math.max(1.3, n * 0.4 + 0.2);
  const grp = new THREE.Group();
  grp.position.set(0, 0.14, 1.85);

  const metal  = std(0x1a1b1e, { roughness: 0.7, metalness: 0.45 });
  const plate  = std(0x2c2d30, { roughness: 0.6, metalness: 0.5 });
  const faceM  = std(0x9a9689, { roughness: 0.9 });
  const inkM   = new THREE.MeshBasicMaterial({ color: 0x0b0b0c });
  const pipM   = new THREE.MeshBasicMaterial({ color: 0xb8b2a2 });
  const needleM = new THREE.MeshBasicMaterial({ color: 0xa33039 });
  const screenMat = new THREE.MeshBasicMaterial({ color: 0x3b8c5a }); // status lamp
  const X = Math.PI / 2;

  grp.add(
    mk(new THREE.BoxGeometry(W, 0.36, 0.55), metal, 0, 0.18, 0.05),
    mk(new THREE.BoxGeometry(W + 0.04, 0.04, 0.58), plate, 0, 0.38, 0.05)
  );

  // two clock faces with ticks
  const dx = W / 2 - 0.32;
  [-1, 1].forEach(sx => {
    const cx = sx * dx, cy = 0.2;
    grp.add(
      mk(new THREE.CylinderGeometry(0.19, 0.19, 0.03, 20), faceM, cx, cy, 0.335, X, 0, 0, false),
      mk(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 8), inkM, cx, cy, 0.35, X, 0, 0, false),
      mk(new THREE.BoxGeometry(0.012, 0.1, 0.01), inkM, cx, cy + 0.05, 0.355, 0, 0, sx * 0.6, false)
    );
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      grp.add(mk(new THREE.BoxGeometry(0.012, 0.035, 0.01), inkM,
        cx + Math.sin(a) * 0.15, cy + Math.cos(a) * 0.15, 0.352, 0, 0, -a, false));
    }
  });

  // status lamp between the faces (main.js recolours screenMat)
  grp.add(mk(new THREE.BoxGeometry(0.2, 0.07, 0.02), screenMat, 0, 0.2, 0.335, 0, 0, 0, false));

  // decorative paddles
  const makePaddle = (sx) => {
    const g = new THREE.Group();
    g.position.set(sx * dx, 0.4, -0.12);
    g.add(mk(new THREE.BoxGeometry(0.4, 0.07, 0.3), plate, 0, 0.035, 0.15));
    return g;
  };
  const lever = makePaddle(1);
  const lever2 = makePaddle(-1);
  const knob = mk(new THREE.SphereGeometry(0.05, 8, 8), std(0x7a2a2e, { roughness: 0.5 }), 0, 0.1, 0.15);
  lever.add(knob);
  grp.add(lever, lever2);

  // raised back panel, one needle gauge per player
  grp.add(mk(new THREE.BoxGeometry(W, 0.5, 0.08), metal, 0, 0.63, -0.26));
  const needles = [];
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 0.4, y = 0.64;
    grp.add(
      mk(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 20), plate, x, y, -0.21, X, 0, 0, false),
      mk(new THREE.CylinderGeometry(0.145, 0.145, 0.02, 20), faceM, x, y, -0.19, X, 0, 0, false)
    );
    for (let k = 0; k < 5; k++) {
      const a = -0.9 + k * 0.45;
      grp.add(mk(new THREE.BoxGeometry(0.01, 0.025, 0.008), inkM,
        x - Math.sin(a) * 0.115, y + Math.cos(a) * 0.115, -0.178, 0, 0, a, false));
    }
    for (let p = 0; p <= i; p++) {   // player-number pips
      grp.add(mk(new THREE.BoxGeometry(0.018, 0.018, 0.01), pipM,
        x + (p - i / 2) * 0.035, 0.85, -0.215, 0, 0, 0, false));
    }
    const needle = new THREE.Group();
    needle.position.set(x, y, -0.172);
    needle.rotation.z = -0.9;
    needle.add(
      mk(new THREE.BoxGeometry(0.014, 0.12, 0.008), needleM, 0, 0.055, 0, 0, 0, 0, false),
      mk(new THREE.CylinderGeometry(0.02, 0.02, 0.01, 8), inkM, 0, 0, 0, X, 0, 0, false)
    );
    grp.add(needle);
    needles.push(needle);
  }

  // small light so the gauges stay readable in the dark room
  const lamp = new THREE.PointLight(0xcfc8b8, 4, 4);
  lamp.position.set(0, 1.1, 0.8);
  grp.add(lamp);

  scene.add(grp);
  return { root: grp, lever, lever2, knob, screenMat, needles };
}

/* ------------------------------------------------------------------ SHADOW PEOPLE + CHAIRS
   Human silhouettes are intentionally featureless. Their form is revealed by
   the casino fixtures; they do not emit light and are never animated as a group. */
function capsuleBetween(a,b,radius,material,parent) {
  const va=new THREE.Vector3(...a), vb=new THREE.Vector3(...b), delta=vb.clone().sub(va);
  const mesh=mk(new THREE.CapsuleGeometry(radius,Math.max(.01,delta.length()-radius*2),4,8),material);
  mesh.position.copy(va.add(vb).multiplyScalar(.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
  parent.add(mesh); return mesh;
}

export function createMafiaPlayer(scene, id, name, x, y, z, rotY, aimAngle) {
  const root = new THREE.Group();
  root.position.set(x,y,z); root.rotation.y=rotY;

  const silhouette = std(0x171619,{roughness:.98,metalness:.02});
  const silhouetteDeep = std(0x0c0c0f,{roughness:1,metalness:0});
  const chairWood = std(0x241a17,{roughness:.78});
  const chairLeather = std(0x171417,{roughness:.92});
  const chairIron = std(0x111216,{roughness:.58,metalness:.68});
  const brass = std(0x55432e,{roughness:.48,metalness:.7});

  // High-backed casino chair with a shaped upholstered back, seat and visible frame.
  const chair=new THREE.Group(); chair.position.set(0,-.45,-.18);
  chair.add(
    mk(new THREE.BoxGeometry(.96,.13,.9),chairWood,0,0,0),
    mk(new THREE.BoxGeometry(.84,.09,.78),chairLeather,0,.075,.015),
    mk(new THREE.BoxGeometry(.11,1.55,.12),chairWood,-.4,.77,-.38),
    mk(new THREE.BoxGeometry(.11,1.55,.12),chairWood,.4,.77,-.38),
    mk(new THREE.BoxGeometry(.88,.19,.12),chairWood,0,1.48,-.38),
    mk(new THREE.BoxGeometry(.78,.1,.1),brass,0,1.12,-.32),
    mk(new THREE.BoxGeometry(.72,1.15,.08),chairLeather,0,.77,-.39),
    mk(new THREE.BoxGeometry(.08,1.12,.08),chairIron,-.39,-.56,-.35),
    mk(new THREE.BoxGeometry(.08,1.12,.08),chairIron,.39,-.56,-.35),
    mk(new THREE.BoxGeometry(.08,1.12,.08),chairIron,-.39,-.56,.35),
    mk(new THREE.BoxGeometry(.08,1.12,.08),chairIron,.39,-.56,.35),
    mk(new THREE.BoxGeometry(.84,.08,.08),chairIron,0,-.38,-.35),
    mk(new THREE.BoxGeometry(.84,.08,.08),chairIron,0,-.38,.35),
    // Upholstered arm pads and carved wooden rails make the chair read as furniture.
    mk(new THREE.BoxGeometry(.16,.13,.78),chairWood,-.49,.48,.02),
    mk(new THREE.BoxGeometry(.16,.13,.78),chairWood,.49,.48,.02),
    mk(new THREE.BoxGeometry(.19,.075,.72),chairLeather,-.49,.555,.02),
    mk(new THREE.BoxGeometry(.19,.075,.72),chairLeather,.49,.555,.02),
    mk(new THREE.BoxGeometry(.045,.78,.09),brass,-.49,.02,.02),
    mk(new THREE.BoxGeometry(.045,.78,.09),brass,.49,.02,.02)
  );
  // Subtle upholstery seams and inset backrest piping catch the overhead light.
  const piping = std(0x49362d,{roughness:.9});
  chair.add(
    mk(new THREE.BoxGeometry(.018,.94,.012),piping,-.34,.78,-.335,0,0,0,false),
    mk(new THREE.BoxGeometry(.018,.94,.012),piping,.34,.78,-.335,0,0,0,false),
    mk(new THREE.BoxGeometry(.68,.018,.012),piping,0,1.22,-.335,0,0,0,false)
  );

  // Seated torso: tapered coat-like silhouette, shoulders and neck, with no face detail.
  const torsoProfile=[new THREE.Vector2(0,-1.0),new THREE.Vector2(.28,-.98),new THREE.Vector2(.32,-.75),new THREE.Vector2(.34,-.38),new THREE.Vector2(.31,-.05),new THREE.Vector2(.43,.22),new THREE.Vector2(.48,.36),new THREE.Vector2(.34,.48),new THREE.Vector2(.16,.53),new THREE.Vector2(0,.53)];
  const torso=mk(new THREE.LatheGeometry(torsoProfile,16),silhouette,0,.67,.02);
  const shoulders=mk(new THREE.SphereGeometry(1,16,12),silhouette,0,1.03,.02);
  shoulders.scale.set(.48,.23,.31);
  const neck=mk(new THREE.CylinderGeometry(.105,.13,.22,10),silhouetteDeep,0,1.28,.01);
  const head=new THREE.Group(); head.position.set(0,1.54,.02);
  const headShape=mk(new THREE.SphereGeometry(.245,16,12),silhouette,0,0,0);
  headShape.scale.set(.88,1.12,.94); head.add(headShape);

  // Arms hang naturally toward the tabletop. The left arm remains the animated game arm.
  const arm=new THREE.Group(); arm.position.set(-.43,1.02,.12);
  capsuleBetween([0,0,0],[-.13,-.42,.22],.115,silhouette,arm);
  capsuleBetween([-.13,-.42,.22],[-.08,-.84,.66],.09,silhouette,arm);
  const hand=mk(new THREE.SphereGeometry(.105,10,8),silhouetteDeep,-.08,-.91,.72); hand.scale.set(.8,1.15,1.25); arm.add(hand);
  const restingArm=new THREE.Group(); restingArm.position.set(.43,1.02,.12);
  capsuleBetween([0,0,0],[.13,-.42,.2],.115,silhouette,restingArm);
  capsuleBetween([.13,-.42,.2],[.1,-.82,.62],.09,silhouette,restingArm);
  const restingHand=mk(new THREE.SphereGeometry(.1,10,8),silhouetteDeep,.1,-.89,.68); restingHand.scale.set(.85,1.1,1.2); restingArm.add(restingHand);

  root.add(chair,torso,shoulders,neck,head,arm,restingArm);
  scene.add(root);
  return {id,name,root,head,arm,aimAngle,lives:3,isDead:false,armTarget:0,armYaw:0,glow:silhouette};
}

