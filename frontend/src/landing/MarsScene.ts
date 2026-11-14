// The 3D space scene of the landing page (plain Three.js, no React inside).
//
// The page animates one small object, `state`, with GSAP while the user scrolls. This file
// only draws what `state` says, every frame. That keeps scroll logic and 3D code apart.
//
// What is real: the globe texture is the NASA Viking colour mosaic (the same one the map
// uses), built from Mars Trek tiles, in its own colours. What is decoration: the glow, the stars,
// the floating red rocks, the orbit rings, and the two route lines with their START and GOAL
// points (an illustration of the idea, not calculated routes).
import * as THREE from 'three'

export interface SceneState {
  /** Globe position in scene units (0, 0 is the screen centre) and its size. */
  x: number
  y: number
  scale: number
  /** Which longitude faces the viewer (radians) and the forward tilt. */
  rotY: number
  rotX: number
  /** 1 = the globe turns slowly by itself, 0 = it holds `rotY` exactly. */
  spin: number
  /** 0 to 1: the Jezero pin. */
  marker: number
  /** 0 to 1: how much of the two route lines is drawn (with the START and GOAL labels). */
  routes: number
  /** 0 to 1: the two orbit rings. */
  rings: number
}

// From the Red Compass logo and the team's mock: bright red, a hot orange for glow, white.
const RED = 0xe8231f
const EMBER = 0xff4a1c
const LIGHT = 0xffffff
/** The glow around the planet: the orange-red of Mars itself. */
const GLOW = 0xff7038

export const JEZERO = { lat: 18.44, lon: 77.45 }
/** The far end of the illustrated routes: an invented "science goal" north-west of Jezero. */
export const ROUTE_GOAL = { lat: JEZERO.lat + 8.5, lon: JEZERO.lon - 11 }

/** A point on the unit globe, using the same mapping as the sphere's texture. */
function onGlobe(lat: number, lon: number, radius = 1): THREE.Vector3 {
  const phi = ((lon + 180) / 360) * Math.PI * 2
  const theta = ((90 - lat) / 180) * Math.PI
  return new THREE.Vector3(
    -Math.cos(phi) * Math.sin(theta) * radius,
    Math.cos(theta) * radius,
    Math.sin(phi) * Math.sin(theta) * radius,
  )
}

/** The globe rotation (around its axis) that turns a longitude towards the viewer. */
export function facingLongitude(lon: number): number {
  const p = onGlobe(0, lon)
  return -Math.atan2(p.x, p.z)
}

/** Shortest way from angle a to angle b. */
function angleDelta(a: number, b: number): number {
  return ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI
}

/**
 * A path over the globe surface between two places that winds like a real trail.
 * `detour` (degrees) pushes the whole path to one side, as when walking around a hill.
 * `wiggles` adds smaller bends on top: [how many, how wide in degrees, shift].
 * Both ends stay exactly on the two places.
 */
function trailPath(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  detour: number,
  wiggles: Array<[number, number, number]>,
): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = []
  const dLat = to.lat - from.lat
  const dLon = to.lon - from.lon
  const length = Math.hypot(dLat, dLon) || 1
  const STEPS = 90
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS
    // 0 at both ends, 1 in the middle: the bends fade out towards START and GOAL.
    const envelope = Math.sin(t * Math.PI)
    let side = envelope * detour
    for (const [count, width, shift] of wiggles) side += envelope * width * Math.sin(t * Math.PI * count + shift)
    // Move sideways, at a right angle to the direct line.
    points.push(onGlobe(from.lat + dLat * t + (-dLon / length) * side, from.lon + dLon * t + (dLat / length) * side, 1.006))
  }
  return new THREE.CatmullRomCurve3(points)
}

/** A soft round glow, used for the stars and the halos of the rocks. */
function glowTexture(): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(canvas)
}

/**
 * One rock shape: a ball pushed in and out by a few waves, so it gets lumps, flat sides and
 * edges. The push depends only on the direction of each point, so the surface stays closed.
 * The faces are left flat (not smoothed), which is what makes it read as broken stone.
 */
function rockGeometry(seed: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 3)
  const position = geometry.attributes.position
  const v = new THREE.Vector3()
  const k = (n: number) => 1.3 + Math.abs(Math.sin(seed * 12.9898 + n * 78.233)) * 2.2
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).normalize()
    const big = Math.sin(v.x * k(1) + seed) * Math.sin(v.y * k(2) + seed * 2) * Math.sin(v.z * k(3) + seed * 3)
    const mid = Math.sin(v.x * k(4) * 2.3 + v.y * 1.7 + seed) * Math.sin(v.z * k(5) * 2.1 - v.x * 1.3)
    const small = Math.sin(v.x * 11 + seed) * Math.sin(v.y * 13 + seed) * Math.sin(v.z * 12 + seed)
    // Rounding the push to steps makes flat faces with sharp edges between them.
    const push = 0.34 * big + 0.16 * mid + 0.05 * small
    v.multiplyScalar(1 + Math.round(push * 9) / 9)
    position.setXYZ(i, v.x, v.y, v.z)
  }
  geometry.computeVertexNormals()
  return geometry
}

/**
 * The rock surface, painted on a canvas: `color` is the red-brown stone with darker and
 * lighter grains, `bump` is the same grains in grey, used to make the surface look rough.
 * It is a drawing of Mars-like stone, not a photo of a real rock.
 */
function rockTextures(): { color: THREE.Texture; bump: THREE.Texture } {
  const SIZE = 256
  const make = () => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = SIZE
    return { canvas, ctx: canvas.getContext('2d')! }
  }
  const color = make()
  const bump = make()
  color.ctx.fillStyle = '#8f2f1c'
  color.ctx.fillRect(0, 0, SIZE, SIZE)
  bump.ctx.fillStyle = '#808080'
  bump.ctx.fillRect(0, 0, SIZE, SIZE)
  const blob = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, squash: number, angle: number, fill: string) => {
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.ellipse(x, y, r, r * squash, angle, 0, Math.PI * 2)
    ctx.fill()
  }
  // Large soft patches, then grains, then small pits.
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * SIZE
    const y = Math.random() * SIZE
    const r = i < 60 ? 14 + Math.random() * 26 : i < 700 ? 2 + Math.random() * 6 : 0.5 + Math.random() * 1.6
    const squash = 0.5 + Math.random() * 0.6
    const angle = Math.random() * Math.PI
    const dark = Math.random() < 0.55
    const alpha = i < 60 ? 0.16 : 0.3 + Math.random() * 0.35
    blob(color.ctx, x, y, r, squash, angle, dark ? `rgba(48,10,6,${alpha})` : `rgba(226,104,62,${alpha})`)
    blob(bump.ctx, x, y, r, squash, angle, dark ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`)
  }
  // A few thin cracks.
  color.ctx.strokeStyle = 'rgba(30,6,4,0.7)'
  bump.ctx.strokeStyle = 'rgba(0,0,0,0.8)'
  for (let i = 0; i < 14; i++) {
    let x = Math.random() * SIZE
    let y = Math.random() * SIZE
    const steps: Array<[number, number]> = [[x, y]]
    for (let j = 0; j < 9; j++) steps.push([(x += (Math.random() - 0.5) * 34), (y += (Math.random() - 0.5) * 34)])
    for (const ctx of [color.ctx, bump.ctx]) {
      ctx.lineWidth = 1
      ctx.beginPath()
      steps.forEach(([px, py], n) => (n ? ctx.lineTo(px, py) : ctx.moveTo(px, py)))
      ctx.stroke()
    }
  }
  const texture = (canvas: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(canvas)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    return t
  }
  return { color: texture(color.canvas, true), bump: texture(bump.canvas, false) }
}

/** A small text label that always faces the viewer (START, GOAL). */
function labelSprite(text: string, background: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.font = "600 52px 'Unbounded', 'Inter', sans-serif"
  const width = Math.min(500, ctx.measureText(text).width + 72)
  ctx.fillStyle = background
  ctx.beginPath()
  ctx.roundRect((512 - width) / 2, 14, width, 100, 50)
  ctx.fill()
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 256, 68)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }))
  // The anchor is below the label, so it always sits above its point on screen, whatever
  // way the globe is turned.
  sprite.center.set(0.5, -0.75)
  sprite.scale.set(0.15, 0.0375, 1)
  sprite.renderOrder = 10
  return sprite
}

/** `textures`: the planet's mosaic, first a small one (fast), then sharper ones that replace it. */
export function createMarsScene(canvas: HTMLCanvasElement, textures: Array<Promise<THREE.Texture | null>>) {
  const state: SceneState = { x: 0, y: -2.6, scale: 2.1, rotY: 0, rotX: 0.25, spin: 1, marker: 0, routes: 0, rings: 1 }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 300)
  camera.position.set(0, 0, 6)

  // The sun from above and behind the viewer's left, and a little cool fill light.
  scene.add(new THREE.AmbientLight(0x8fa8ff, 0.35))
  const sun = new THREE.DirectionalLight(0xfff1e6, 2.4)
  sun.position.set(-3, 4, 4)
  scene.add(sun)

  const glow = glowTexture()

  // Stars: many small ones and a few bright ones.
  const starField = (count: number, size: number, opacity: number) => {
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 60)
      positions.set([v.x, v.y, v.z], i * 3)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: 0xffffff, map: glow, size, sizeAttenuation: true, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }),
    )
    scene.add(points)
    return points
  }
  const smallStars = starField(3200, 0.5, 0.75)
  const brightStars = starField(160, 1.5, 0.95)

  // Floating red rocks: real stone shapes with a rough red-brown surface, lit by the sun,
  // each one tumbling slowly. Four different shapes are shared by all the rocks.
  const ROCKS = 150
  const BIG_ROCKS = 12
  const SHAPES = 4
  const rocks = new THREE.Group()
  scene.add(rocks)
  const stone = rockTextures()
  const rockMaterial = new THREE.MeshStandardMaterial({
    map: stone.color,
    bumpMap: stone.bump,
    bumpScale: 2.2,
    roughness: 0.92,
    metalness: 0.04,
    // A little warm light of their own, so the side away from the sun is dark red, not black.
    emissive: 0x4a0d06,
    emissiveIntensity: 0.22,
  })
  const rockMeshes = Array.from({ length: SHAPES }, (_, shape) => {
    const mesh = new THREE.InstancedMesh(rockGeometry(shape * 7.31 + 1.7), rockMaterial, Math.ceil(ROCKS / SHAPES))
    mesh.count = 0
    rocks.add(mesh)
    return mesh
  })
  // What is needed to turn each rock again every frame.
  const rockItems: Array<{ mesh: THREE.InstancedMesh; index: number; position: THREE.Vector3; scale: THREE.Vector3; turn: THREE.Vector3; speed: THREE.Vector3 }> = []
  const haloPositions = new Float32Array(ROCKS * 3)
  const dummy = new THREE.Object3D()
  const tint = new THREE.Color()
  for (let i = 0; i < ROCKS; i++) {
    const big = i < BIG_ROCKS
    // The big rocks stay at the sides and near the viewer, where their surface can be seen
    // and they do not cover the text.
    const side = Math.random() < 0.5 ? -1 : 1
    const x = big ? side * (2.6 + Math.random() * 2.2) : (Math.random() * 2 - 1) * 5.4
    const y = (Math.random() * 2 - 1) * (big ? 2.0 : 2.6) + 0.2
    // Not too near the viewer: a rock close to the camera looks as if it floats above the page.
    const z = big ? -0.2 + Math.random() * 1.3 : -2.4 + Math.random() * 3.6
    // Most rocks are tiny, a few are larger.
    const size = big ? 0.05 + Math.random() * 0.06 : 0.008 + Math.random() ** 3 * 0.04
    const mesh = rockMeshes[i % SHAPES]
    const item = {
      mesh,
      index: mesh.count++,
      position: new THREE.Vector3(x, y, z),
      // Stretched and flattened by a random amount, so no two look the same.
      scale: new THREE.Vector3(size * (0.8 + Math.random() * 0.9), size * (0.55 + Math.random() * 0.6), size * (0.7 + Math.random() * 0.7)),
      turn: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      speed: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(big ? 0.35 : 0.9),
    }
    rockItems.push(item)
    // From dark rust to a brighter red.
    mesh.setColorAt(item.index, tint.setHSL(0.02 + Math.random() * 0.035, 0.7, 0.34 + Math.random() * 0.3))
    haloPositions.set([x, y, z], i * 3)
  }
  const turnRocks = (time: number) => {
    for (const item of rockItems) {
      dummy.position.copy(item.position)
      dummy.scale.copy(item.scale)
      dummy.rotation.set(item.turn.x + item.speed.x * time, item.turn.y + item.speed.y * time, item.turn.z + item.speed.z * time)
      dummy.updateMatrix()
      item.mesh.setMatrixAt(item.index, dummy.matrix)
    }
    for (const mesh of rockMeshes) mesh.instanceMatrix.needsUpdate = true
  }
  turnRocks(0)
  for (const mesh of rockMeshes) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  // A faint red haze around each rock ties them to the red of the logo.
  const haloGeometry = new THREE.BufferGeometry()
  haloGeometry.setAttribute('position', new THREE.BufferAttribute(haloPositions, 3))
  rocks.add(
    new THREE.Points(
      haloGeometry,
      new THREE.PointsMaterial({ color: EMBER, map: glow, size: 0.2, sizeAttenuation: true, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }),
    ),
  )

  // A few large, soft, out-of-focus embers close to the viewer give the picture depth.
  const nearPositions = new Float32Array(26 * 3)
  for (let i = 0; i < 26; i++) nearPositions.set([(Math.random() * 2 - 1) * 4.2, (Math.random() * 2 - 1) * 2.1, 1.5 + Math.random() * 2], i * 3)
  const nearGeometry = new THREE.BufferGeometry()
  nearGeometry.setAttribute('position', new THREE.BufferAttribute(nearPositions, 3))
  rocks.add(
    new THREE.Points(
      nearGeometry,
      new THREE.PointsMaterial({ color: RED, map: glow, size: 0.34, sizeAttenuation: true, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }),
    ),
  )

  // group: place and size · tilt: forward lean · globe: turns around its axis.
  const group = new THREE.Group()
  const tilt = new THREE.Group()
  scene.add(group)
  group.add(tilt)

  // The planet keeps the real colours of the NASA mosaic (no tint).
  const globeMaterial = new THREE.MeshStandardMaterial({ color: 0x9c6b56, roughness: 1, metalness: 0 })
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 128), globeMaterial)
  tilt.add(globe)
  let disposed = false
  for (const texture of textures) {
    void texture.then((map) => {
      if (!map) return // keep what is shown
      if (disposed) return map.dispose()
      // Never replace a sharper mosaic with a smaller one that arrived late.
      const current = globeMaterial.map?.image as { width?: number } | undefined
      if ((current?.width ?? 0) >= (map.image as { width: number }).width) return map.dispose()
      globeMaterial.map?.dispose()
      globeMaterial.map = map
      globeMaterial.color.set(0xffffff)
      globeMaterial.needsUpdate = true
    })
  }

  // Orange-red rim glow around the planet. It stays still while the globe turns.
  const rim = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 96, 96),
    new THREE.ShaderMaterial({
      uniforms: { glowColor: { value: new THREE.Color(GLOW) } },
      vertexShader: 'varying vec3 vNormal; void main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'varying vec3 vNormal; uniform vec3 glowColor; void main() { float i = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0); gl_FragColor = vec4(glowColor, 1.0) * i; }',
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  )
  group.add(rim)

  // Two thin orbit rings, red and white, like the swoosh and the orbit line of the logo.
  const ring = (radius: number, color: number, rx: number, rz: number) => {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.0035, 8, 200), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 }))
    mesh.rotation.set(rx, 0, rz)
    group.add(mesh)
    return mesh
  }
  const redRing = ring(1.42, RED, Math.PI / 2.25, 0.35)
  const whiteRing = ring(1.6, LIGHT, Math.PI / 1.9, -0.5)

  // A pin on the surface: a dot with a ring that pulses, and a label above it.
  const makePin = (place: { lat: number; lon: number }, color: number, label: THREE.Sprite) => {
    const pin = new THREE.Group()
    const normal = onGlobe(place.lat, place.lon).normalize()
    pin.position.copy(normal.clone().multiplyScalar(1.008))
    pin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.011, 32), new THREE.MeshBasicMaterial({ color, transparent: true }))
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.0045, 24), new THREE.MeshBasicMaterial({ color: color === LIGHT ? RED : LIGHT, transparent: true }))
    core.position.z = 0.001
    const pulse = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.0235, 64), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide }))
    label.position.set(0, 0, 0.01)
    pin.add(dot, core, pulse, label)
    globe.add(pin)
    return { pin, dot, core, pulse, label }
  }
  const start = makePin(JEZERO, RED, labelSprite('START', '#e8231f', '#ffffff'))
  const goal = makePin(ROUTE_GOAL, LIGHT, labelSprite('GOAL', '#ffffff', '#0c1a3d'))

  // Two routes between the two points, winding like trails over the ground:
  //   red   = the shortest: almost direct, with the small bends any real path has
  //   white = the gentler one: a wide detour with more turns, as if it went around hills
  // Each is a thin bright line on top of a wider, faint one, which reads as a glow.
  const routeLine = (path: THREE.CatmullRomCurve3, color: number) => {
    const part = (radius: number, opacity: number) => {
      const geometry = new THREE.TubeGeometry(path, 260, radius, 10, false)
      globe.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })))
      return { geometry, total: geometry.index ? geometry.index.count : 0 }
    }
    return [part(0.0105, 0.22), part(0.0034, 1)]
  }
  const routeLines = [
    ...routeLine(trailPath(JEZERO, ROUTE_GOAL, 0.25, [[3, 0.55, 0.4], [7, 0.18, 1.3]]), RED),
    ...routeLine(trailPath(JEZERO, ROUTE_GOAL, 2.9, [[2, 0.9, 0.2], [5, 0.5, 2.1], [9, 0.16, 0.7]]), LIGHT),
  ]

  const resize = () => {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()

  const setOpacity = (object: THREE.Mesh | THREE.Sprite, value: number) => {
    ;(object.material as THREE.Material & { opacity: number }).opacity = value
  }

  const pinWorld = new THREE.Vector3()
  const globeWorld = new THREE.Vector3()
  const clock = new THREE.Clock()
  let frame = 0
  let running = true
  const draw = () => {
    if (!running) return
    frame = requestAnimationFrame(draw)
    const time = clock.getElapsedTime()

    group.position.set(state.x, state.y, 0)
    group.scale.setScalar(state.scale)
    tilt.rotation.x = state.rotX
    // Blend between the slow self-turn and the exact angle the page asks for.
    const auto = time * 0.035
    globe.rotation.y = auto + angleDelta(auto, state.rotY) * (1 - state.spin)

    // The rings hide while the routes are shown, so they do not cross the lines and the text.
    const ringOpacity = state.rings * (1 - state.routes)
    setOpacity(redRing, 0.75 * ringOpacity)
    setOpacity(whiteRing, 0.35 * ringOpacity)
    redRing.rotation.z = 0.35 + time * 0.05
    whiteRing.rotation.z = -0.5 - time * 0.03

    smallStars.rotation.y = time * 0.003
    brightStars.rotation.y = time * 0.003
    // The rocks drift slowly, like dust in orbit.
    rocks.rotation.y = Math.sin(time * 0.05) * 0.12
    rocks.rotation.z = time * 0.006
    rocks.position.y = Math.sin(time * 0.2) * 0.04
    turnRocks(time)

    const beat = (time * 0.8) % 1
    // The labels are drawn on top of everything, so without this they would show through
    // the planet when their point has turned to the far side.
    const facing = (item: typeof start) => {
      item.pin.getWorldPosition(pinWorld)
      globe.getWorldPosition(globeWorld)
      const towards = pinWorld.clone().sub(globeWorld).normalize().dot(camera.position.clone().sub(pinWorld).normalize())
      return THREE.MathUtils.smoothstep(towards, 0.12, 0.35)
    }
    const showPin = (item: typeof start, amount: number) => {
      item.pin.visible = amount > 0.01
      item.pulse.scale.setScalar(1 + 0.7 * beat)
      setOpacity(item.pulse, amount * (1 - beat))
      setOpacity(item.dot, amount)
      setOpacity(item.core, amount)
    }
    const startFacing = facing(start)
    const goalFacing = facing(goal)
    showPin(start, state.marker * startFacing)
    showPin(goal, state.routes * goalFacing)
    // The START label appears with the routes: before that the pin is "Jezero", not a start.
    setOpacity(start.label, state.routes * startFacing)
    setOpacity(goal.label, state.routes * goalFacing)

    for (const line of routeLines) {
      // Draw whole triangles only: a count that is a multiple of 3.
      line.geometry.setDrawRange(0, Math.floor((line.total * state.routes) / 3) * 3)
    }

    renderer.render(scene, camera)
  }
  draw()

  // No drawing while the tab is hidden.
  const onVisibility = () => {
    running = !document.hidden
    if (running) draw()
    else cancelAnimationFrame(frame)
  }
  document.addEventListener('visibilitychange', onVisibility)

  return {
    state,
    dispose() {
      disposed = true
      running = false
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', onVisibility)
      observer.disconnect()
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose()
        const material = mesh.material as (THREE.Material & { map?: THREE.Texture | null }) | THREE.Material[] | undefined
        if (Array.isArray(material)) material.forEach((m) => m.dispose())
        else if (material) {
          if (material.map && material.map !== glow) material.map.dispose()
          material.dispose()
        }
      })
      stone.bump.dispose()
      glow.dispose()
      renderer.dispose()
    },
  }
}

/**
 * The Mars colour mosaic as one texture, from NASA Trek tiles drawn on a canvas.
 * Level 2 is 8 x 4 tiles (2048 px wide, fast). Level 3 is 16 x 8 tiles (4096 px wide, sharp
 * enough for the close view of step 3).
 * Returns null when the tiles cannot be loaded, the globe then keeps a plain Mars colour.
 */
export async function loadMarsTexture(level: 2 | 3 = 2): Promise<THREE.Texture | null> {
  const LEVEL = level
  const COLUMNS = 2 ** (LEVEL + 1)
  const ROWS = 2 ** LEVEL
  const SIZE = 256
  const base = 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0//default/default028mm'
  try {
    const canvas = document.createElement('canvas')
    canvas.width = COLUMNS * SIZE
    canvas.height = ROWS * SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const jobs: Array<Promise<void>> = []
    for (let row = 0; row < ROWS; row++) {
      for (let column = 0; column < COLUMNS; column++) {
        jobs.push(
          fetch(`${base}/${LEVEL}/${row}/${column}.jpg`)
            .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(String(response.status)))))
            .then((blob) => createImageBitmap(blob))
            .then((bitmap) => ctx.drawImage(bitmap, column * SIZE, row * SIZE)),
        )
      }
    }
    await Promise.all(jobs)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    return texture
  } catch (err) {
    console.warn('[landing] Mars texture not loaded, using a plain colour', err)
    return null
  }
}
