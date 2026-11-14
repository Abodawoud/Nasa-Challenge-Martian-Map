// The 3D Mars of the landing page (plain Three.js, no React inside).
//
// The page animates one small object, `state`, with GSAP while the user scrolls. This file
// only draws what `state` says, every frame. That keeps scroll logic and 3D code apart.
//
// The globe texture is the real NASA Viking colour mosaic (the same one the map uses),
// built from Mars Trek tiles. Everything else here (rings, glow, route lines) is decoration.
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
  /** 0 to 1: how much of the two route lines is drawn. */
  routes: number
}

// From the Red Compass logo: bright red, and white with a little blue for the light accent.
const RED = 0xe8231f
const LIGHT = 0xdfe6ff
/** The rim glow: a cool navy-blue light, like the planet seen against the logo's navy sky. */
const GLOW = 0x5f7fe0

export const JEZERO = { lat: 18.44, lon: 77.45 }

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

/** A smooth line over the globe surface between two places, bent sideways by `bend` degrees. */
function surfacePath(from: { lat: number; lon: number }, to: { lat: number; lon: number }, bend: number): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = []
  for (let i = 0; i <= 24; i++) {
    const t = i / 24
    const side = Math.sin(t * Math.PI) * bend
    // Bend at a right angle to the direct line.
    const dLat = to.lat - from.lat
    const dLon = to.lon - from.lon
    const length = Math.hypot(dLat, dLon) || 1
    points.push(onGlobe(from.lat + dLat * t + (-dLon / length) * side, from.lon + dLon * t + (dLat / length) * side, 1.004))
  }
  return new THREE.CatmullRomCurve3(points)
}

export function createMarsScene(canvas: HTMLCanvasElement, texture: Promise<THREE.Texture | null>) {
  const state: SceneState = { x: 0, y: -2.6, scale: 2.1, rotY: 0, rotX: 0.25, spin: 1, marker: 0, routes: 0 }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200)
  camera.position.set(0, 0, 6)

  // Light from the upper left, like a low sun: one side bright, the other in shadow.
  scene.add(new THREE.AmbientLight(0x8fa8ff, 0.35))
  const sun = new THREE.DirectionalLight(0xfff1e6, 2.4)
  sun.position.set(-4, 2.5, 4)
  scene.add(sun)

  // Stars.
  const starPositions = new Float32Array(1600 * 3)
  for (let i = 0; i < 1600; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(40 + Math.random() * 30)
    starPositions.set([v.x, v.y, v.z], i * 3)
  }
  const starGeometry = new THREE.BufferGeometry()
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xcfdcff, size: 0.09, sizeAttenuation: true, transparent: true, opacity: 0.8 }))
  scene.add(stars)

  // group: place and size · tilt: forward lean · globe: turns around its axis.
  const group = new THREE.Group()
  const tilt = new THREE.Group()
  scene.add(group)
  group.add(tilt)

  const globeMaterial = new THREE.MeshStandardMaterial({ color: 0x9c6b56, roughness: 1, metalness: 0 })
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 96), globeMaterial)
  tilt.add(globe)
  void texture.then((map) => {
    if (!map) return // keep the plain Mars colour
    globeMaterial.map = map
    globeMaterial.color.set(0xffffff)
    globeMaterial.needsUpdate = true
  })

  // Rim glow in the logo's navy-blue. It stays still while the globe turns.
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(1.16, 64, 64),
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
  group.add(glow)

  // Two thin orbit rings, red and white, like the swoosh and the orbit line of the logo.
  const ring = (radius: number, color: number, opacity: number, rx: number, rz: number) => {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.0035, 8, 200),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity }),
    )
    mesh.rotation.set(rx, 0, rz)
    group.add(mesh)
    return mesh
  }
  const redRing = ring(1.42, RED, 0.75, Math.PI / 2.25, 0.35)
  const whiteRing = ring(1.6, LIGHT, 0.35, Math.PI / 1.9, -0.5)

  // Jezero pin: a red dot with a ring that pulses.
  const pin = new THREE.Group()
  const normal = onGlobe(JEZERO.lat, JEZERO.lon).normalize()
  pin.position.copy(normal.clone().multiplyScalar(1.005))
  pin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
  const pinDot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 24), new THREE.MeshBasicMaterial({ color: RED, transparent: true }))
  const pinRing = new THREE.Mesh(new THREE.RingGeometry(0.024, 0.03, 48), new THREE.MeshBasicMaterial({ color: RED, transparent: true, side: THREE.DoubleSide }))
  pin.add(pinDot, pinRing)
  globe.add(pin)

  // Two route lines from Jezero. They are an illustration of the idea (shortest and gentler
  // route), drawn large enough to see on a globe. They are not real calculated routes.
  const target = { lat: JEZERO.lat + 5.5, lon: JEZERO.lon - 7 }
  const routeLine = (bend: number, color: number) => {
    const geometry = new THREE.TubeGeometry(surfacePath(JEZERO, target, bend), 80, 0.0045, 8, false)
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color }))
    globe.add(mesh)
    return { geometry, total: geometry.index ? geometry.index.count : 0 }
  }
  const routeLines = [routeLine(0, RED), routeLine(1.6, LIGHT)]

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
    const auto = time * 0.06
    globe.rotation.y = auto + angleDelta(auto, state.rotY) * (1 - state.spin)

    // The rings fade while the routes are shown, so they do not cross the text and the lines.
    const ringFade = 1 - state.routes * 0.9
    ;(redRing.material as THREE.MeshBasicMaterial).opacity = 0.75 * ringFade
    ;(whiteRing.material as THREE.MeshBasicMaterial).opacity = 0.35 * ringFade
    redRing.rotation.z = 0.35 + time * 0.05
    whiteRing.rotation.z = -0.5 - time * 0.03
    stars.rotation.y = time * 0.004

    pin.visible = state.marker > 0.01
    const pulse = 1 + 0.6 * ((time * 0.8) % 1)
    pinRing.scale.setScalar(pulse)
    ;(pinRing.material as THREE.MeshBasicMaterial).opacity = state.marker * (1 - ((time * 0.8) % 1))
    ;(pinDot.material as THREE.MeshBasicMaterial).opacity = state.marker

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
      running = false
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', onVisibility)
      observer.disconnect()
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose()
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(material)) material.forEach((m) => m.dispose())
        else material?.dispose()
      })
      globeMaterial.map?.dispose()
      renderer.dispose()
    },
  }
}

/**
 * The Mars colour mosaic as one texture: 8 x 4 NASA Trek tiles (level 2) drawn on a canvas.
 * Returns null when the tiles cannot be loaded, the globe then keeps a plain Mars colour.
 */
export async function loadMarsTexture(): Promise<THREE.Texture | null> {
  const LEVEL = 2
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
