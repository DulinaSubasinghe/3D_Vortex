import { useRef, useMemo, useEffect, useCallback } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  Points,
  BufferGeometry,
  BufferAttribute,
  Color,
  Vector2,
  Vector3,
  Raycaster,
  Plane,
  AdditiveBlending,
  PointsMaterial,
} from 'three'
import type { InteractionMode, ParticleControls } from '../../types'

export type { ParticleControls }

interface ParticleSystemProps {
  mode: InteractionMode
  controls: ParticleControls
  isPointerDown: boolean
  onFpsUpdate: (fps: number) => void
}

const BOUNDS = 11
/** Soft margin where edge repulsion begins */
const EDGE_MARGIN = 1.8
const EDGE_FORCE = 0.045
/** Brownian / idle drift strength */
const DRIFT_STRENGTH = 0.0012
/** Chance per frame (~60fps) that a particle picks a new drift direction */
const DRIFT_REDIRECT_CHANCE = 0.008
/** Soft particle–particle repulsion (sampled neighbors) */
const REPEL_RADIUS2 = 2.25 // 1.5²
const REPEL_STRENGTH = 0.004
const REPEL_SAMPLES = 2
/** Gentle damping — keep drifting, don't freeze */
const IDLE_DAMPING = 0.997
const ACTIVE_DAMPING = 0.988
/** Cap speeds so idle motion stays peaceful */
const IDLE_MAX_SPEED = 0.028
const ACTIVE_MAX_SPEED = 0.35
const COLOR_LERP = 0.08
const MAX_PARTICLES = 50_000

/** Mode-specific base colors (RGB 0–1) */
const MODE_COLORS: Record<InteractionMode, [number, number, number]> = {
  explode: [1.0, 0.45, 0.15],
  swirl: [0.35, 0.65, 1.0],
  blackhole: [0.7, 0.25, 1.0],
  gravity: [0.25, 0.95, 0.55],
  fire: [1.0, 0.35, 0.05],
}

function clampSpeed(vx: number, vy: number, vz: number, max: number): [number, number, number] {
  const spd = Math.sqrt(vx * vx + vy * vy + vz * vz)
  if (spd <= max || spd < 1e-8) return [vx, vy, vz]
  const s = max / spd
  return [vx * s, vy * s, vz * s]
}

export default function ParticleSystem({
  mode,
  controls,
  isPointerDown,
  onFpsUpdate,
}: ParticleSystemProps) {
  const pointsRef = useRef<Points>(null)
  const cursor3D = useRef(new Vector3(0, 0, 0))
  const targetColor = useRef(new Color(...MODE_COLORS.explode))
  const currentColor = useRef(new Color(...MODE_COLORS.explode))
  const frameCount = useRef(0)
  const lastFpsTime = useRef(performance.now())
  const modeRef = useRef(mode)
  const controlsRef = useRef(controls)
  const pointerDownRef = useRef(isPointerDown)

  modeRef.current = mode
  controlsRef.current = controls
  pointerDownRef.current = isPointerDown

  const { camera, gl, size } = useThree()
  const raycaster = useMemo(() => new Raycaster(), [])
  const plane = useMemo(() => new Plane(new Vector3(0, 0, 1), 0), [])
  const hit = useMemo(() => new Vector3(), [])
  const pointerNdc = useMemo(() => new Vector2(), [])

  // Shared typed arrays — mutated every frame, uploaded via needsUpdate
  const data = useMemo(
    () => ({
      positions: new Float32Array(MAX_PARTICLES * 3),
      velocities: new Float32Array(MAX_PARTICLES * 3),
      colors: new Float32Array(MAX_PARTICLES * 3),
      life: new Float32Array(MAX_PARTICLES),
    }),
    []
  )

  const geometry = useMemo(() => {
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(data.positions, 3))
    geo.setAttribute('color', new BufferAttribute(data.colors, 3))
    geo.setDrawRange(0, controls.count)
    return geo
    // eslint-disable-next-line react-hooks/exhaustive-deps -- geometry is created once; drawRange updated below
  }, [data])

  const material = useMemo(
    () =>
      new PointsMaterial({
        size: 0.08,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        sizeAttenuation: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    []
  )

  const seedParticles = useCallback(
    (count: number, colorMode: InteractionMode) => {
      const { positions, velocities, colors, life } = data
      const [cr, cg, cb] = MODE_COLORS[colorMode]
      const spread = BOUNDS * 0.85

      for (let i = 0; i < count; i++) {
        const i3 = i * 3
        // Even volume fill — cube distribution so idle space looks like a starfield
        positions[i3] = (Math.random() * 2 - 1) * spread
        positions[i3 + 1] = (Math.random() * 2 - 1) * spread
        positions[i3 + 2] = (Math.random() * 2 - 1) * spread

        // Slow random drift velocities
        velocities[i3] = (Math.random() - 0.5) * IDLE_MAX_SPEED
        velocities[i3 + 1] = (Math.random() - 0.5) * IDLE_MAX_SPEED
        velocities[i3 + 2] = (Math.random() - 0.5) * IDLE_MAX_SPEED

        const variance = 0.55 + Math.random() * 0.45
        colors[i3] = Math.min(1, cr * variance)
        colors[i3 + 1] = Math.min(1, cg * variance)
        colors[i3 + 2] = Math.min(1, cb * variance)

        life[i] = Math.random()
      }

      geometry.setDrawRange(0, count)
      const pos = geometry.getAttribute('position') as BufferAttribute
      const col = geometry.getAttribute('color') as BufferAttribute
      pos.needsUpdate = true
      col.needsUpdate = true
    },
    [data, geometry]
  )

  // Re-seed when particle count changes
  useEffect(() => {
    seedParticles(controls.count, modeRef.current)
  }, [controls.count, seedParticles])

  useEffect(() => {
    const [r, g, b] = MODE_COLORS[mode]
    targetColor.current.setRGB(r, g, b)
  }, [mode])

  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  // Pointer → 3D world on the z=0 interaction plane
  useEffect(() => {
    const el = gl.domElement

    const updateCursor = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect()
      pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1
      pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointerNdc, camera)
      if (raycaster.ray.intersectPlane(plane, hit)) {
        cursor3D.current.copy(hit)
      }
    }

    const onMove = (e: PointerEvent) => updateCursor(e.clientX, e.clientY)
    el.addEventListener('pointermove', onMove)
    return () => el.removeEventListener('pointermove', onMove)
  }, [gl, camera, size, raycaster, plane, hit, pointerNdc])

  useFrame((_, delta) => {
    const pts = pointsRef.current
    if (!pts) return

    const { positions, velocities, colors, life } = data
    const count = controlsRef.current.count
    const speedMul = controlsRef.current.speed
    const sizeMul = controlsRef.current.size
    const currentMode = modeRef.current
    const active = pointerDownRef.current
    const dt = Math.min(delta, 0.05) * 60
    const cx = cursor3D.current.x
    const cy = cursor3D.current.y
    const cz = cursor3D.current.z
    const edgeStart = BOUNDS - EDGE_MARGIN
    const damping = active ? ACTIVE_DAMPING : IDLE_DAMPING
    const maxSpeed = active ? ACTIVE_MAX_SPEED : IDLE_MAX_SPEED

    currentColor.current.lerp(targetColor.current, COLOR_LERP)
    const br = currentColor.current.r
    const bg = currentColor.current.g
    const bb = currentColor.current.b

    material.size = 0.08 * sizeMul

    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      let px = positions[i3]
      let py = positions[i3 + 1]
      let pz = positions[i3 + 2]
      let vx = velocities[i3]
      let vy = velocities[i3 + 1]
      let vz = velocities[i3 + 2]

      if (active) {
        const dx = cx - px
        const dy = cy - py
        const dz = cz - pz
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.0001
        const nx = dx / dist
        const ny = dy / dist
        const nz = dz / dist

        // Mode-specific forces while pointer is held / clicked
        switch (currentMode) {
          case 'explode': {
            if (dist < 6) {
              const force = (1.2 / (dist + 0.3)) * speedMul * 0.08
              vx -= nx * force * dt
              vy -= ny * force * dt
              vz -= nz * force * dt
            }
            break
          }
          case 'swirl': {
            if (dist < 10) {
              const tx = -ny
              const ty = nx
              const force = (0.35 / (dist * 0.4 + 0.5)) * speedMul
              vx += (tx * force - nx * 0.015 * speedMul) * dt
              vy += (ty * force - ny * 0.015 * speedMul) * dt
              vz += -nz * 0.02 * speedMul * dt
            }
            break
          }
          case 'blackhole': {
            if (dist < 14) {
              const force = (0.55 / (dist * dist + 0.2)) * speedMul
              vx += nx * force * dt
              vy += ny * force * dt
              vz += nz * force * dt
              if (dist < 0.35) {
                const theta = Math.random() * Math.PI * 2
                const phi = Math.acos(2 * Math.random() - 1)
                const r = 4 + Math.random() * 5
                px = cx + r * Math.sin(phi) * Math.cos(theta)
                py = cy + r * Math.sin(phi) * Math.sin(theta)
                pz = cz + r * Math.cos(phi)
                vx = (Math.random() - 0.5) * 0.05
                vy = (Math.random() - 0.5) * 0.05
                vz = (Math.random() - 0.5) * 0.05
              }
            }
            break
          }
          case 'gravity': {
            if (dist < 12) {
              const tx = -ny
              const ty = nx
              const pull = (0.12 / (dist + 0.4)) * speedMul
              const orbit = (0.22 / (dist * 0.5 + 0.3)) * speedMul
              vx += (nx * pull + tx * orbit) * dt
              vy += (ny * pull + ty * orbit) * dt
              vz += nz * pull * 0.4 * dt
            }
            break
          }
          case 'fire': {
            if (dist < 5) {
              const rise = (1.1 - dist / 5) * 0.09 * speedMul
              vx += (Math.random() - 0.5) * 0.04 * speedMul * dt
              vy += rise * dt
              vz += (Math.random() - 0.5) * 0.04 * speedMul * dt
              vx += nx * 0.01 * speedMul * dt
              vz += nz * 0.01 * speedMul * dt
            }
            break
          }
        }
      } else {
        // —— Idle universe: Brownian drift + soft repulsion ——
        // Occasional direction change (organic, star-like wandering)
        if (Math.random() < DRIFT_REDIRECT_CHANCE) {
          vx += (Math.random() - 0.5) * DRIFT_STRENGTH * 8
          vy += (Math.random() - 0.5) * DRIFT_STRENGTH * 8
          vz += (Math.random() - 0.5) * DRIFT_STRENGTH * 8
        }
        // Continuous tiny random acceleration
        vx += (Math.random() - 0.5) * DRIFT_STRENGTH * dt
        vy += (Math.random() - 0.5) * DRIFT_STRENGTH * dt
        vz += (Math.random() - 0.5) * DRIFT_STRENGTH * dt

        // Sample a few random neighbors — O(n) approx of particle repulsion (avoids clumping)
        for (let s = 0; s < REPEL_SAMPLES; s++) {
          const j = (Math.random() * count) | 0
          if (j === i) continue
          const j3 = j * 3
          const rx = px - positions[j3]
          const ry = py - positions[j3 + 1]
          const rz = pz - positions[j3 + 2]
          const r2 = rx * rx + ry * ry + rz * rz
          if (r2 < REPEL_RADIUS2 && r2 > 1e-6) {
            const inv = (REPEL_STRENGTH / r2) * dt
            vx += rx * inv
            vy += ry * inv
            vz += rz * inv
          }
        }
      }

      // Soft edge repulsion — nudge inward near bounds (no wrapping)
      if (px > edgeStart) vx -= (px - edgeStart) * EDGE_FORCE * dt
      else if (px < -edgeStart) vx -= (px + edgeStart) * EDGE_FORCE * dt
      if (py > edgeStart) vy -= (py - edgeStart) * EDGE_FORCE * dt
      else if (py < -edgeStart) vy -= (py + edgeStart) * EDGE_FORCE * dt
      if (pz > edgeStart) vz -= (pz - edgeStart) * EDGE_FORCE * dt
      else if (pz < -edgeStart) vz -= (pz + edgeStart) * EDGE_FORCE * dt

      // Light damping (idle keeps drifting; active settles a bit after forces)
      vx *= damping
      vy *= damping
      vz *= damping

      ;[vx, vy, vz] = clampSpeed(vx, vy, vz, maxSpeed * Math.max(0.15, speedMul))

      // Integrate — no gravity
      px += vx * speedMul * dt
      py += vy * speedMul * dt
      pz += vz * speedMul * dt

      // Soft clamp as safety net (particles stay in the universe volume)
      if (px > BOUNDS) {
        px = BOUNDS
        vx *= -0.3
      } else if (px < -BOUNDS) {
        px = -BOUNDS
        vx *= -0.3
      }
      if (py > BOUNDS) {
        py = BOUNDS
        vy *= -0.3
      } else if (py < -BOUNDS) {
        py = -BOUNDS
        vy *= -0.3
      }
      if (pz > BOUNDS) {
        pz = BOUNDS
        vz *= -0.3
      } else if (pz < -BOUNDS) {
        pz = -BOUNDS
        vz *= -0.3
      }

      positions[i3] = px
      positions[i3 + 1] = py
      positions[i3 + 2] = pz
      velocities[i3] = vx
      velocities[i3 + 1] = vy
      velocities[i3 + 2] = vz

      // Color from velocity heat + mode palette
      const spd = Math.sqrt(vx * vx + vy * vy + vz * vz)
      const heat = Math.min(1, spd * (active ? 25 : 40))
      const lifePulse = 0.7 + 0.3 * Math.sin(life[i] * Math.PI * 2)
      life[i] = (life[i] + 0.002 * dt) % 1

      const tint = 0.55 + heat * 0.45
      colors[i3] =
        colors[i3] * (1 - COLOR_LERP) +
        br * tint * lifePulse * COLOR_LERP +
        heat * 0.15 * COLOR_LERP
      colors[i3 + 1] =
        colors[i3 + 1] * (1 - COLOR_LERP) +
        bg * tint * lifePulse * COLOR_LERP +
        heat * 0.05 * COLOR_LERP
      colors[i3 + 2] =
        colors[i3 + 2] * (1 - COLOR_LERP) + bb * tint * lifePulse * COLOR_LERP

      if (currentMode === 'fire' && active) {
        const heightFactor = Math.max(0, Math.min(1, (py - cy) / 4))
        colors[i3] = Math.min(1, colors[i3] + (1 - heightFactor) * 0.02)
        colors[i3 + 1] = Math.min(1, colors[i3 + 1] * (1 - heightFactor * 0.3))
        colors[i3 + 2] = Math.min(1, colors[i3 + 2] + heightFactor * 0.15)
      }
    }

    const posAttr = geometry.getAttribute('position') as BufferAttribute
    const colAttr = geometry.getAttribute('color') as BufferAttribute
    posAttr.needsUpdate = true
    colAttr.needsUpdate = true

    frameCount.current += 1
    const now = performance.now()
    if (now - lastFpsTime.current >= 250) {
      const fps = Math.round((frameCount.current * 1000) / (now - lastFpsTime.current))
      onFpsUpdate(fps)
      frameCount.current = 0
      lastFpsTime.current = now
    }
  })

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
}
