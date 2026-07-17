import { useState, useCallback, useMemo, useRef, useEffect, Suspense, type CSSProperties } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import { MOUSE } from 'three'
import ParticleSystem from './components/Scene/ParticleSystem'
import type { InteractionMode, ParticleControls } from './types'

export type { InteractionMode }

interface ModeDef {
  id: InteractionMode
  label: string
  icon: string
  hint: string
}

const MODES: ModeDef[] = [
  { id: 'explode', label: 'EXPLODE', icon: '💥', hint: 'Click / hold — particles burst outward from cursor' },
  { id: 'swirl', label: 'SWIRL', icon: '🌀', hint: 'Drag — particles follow cursor in a galaxy swirl' },
  { id: 'blackhole', label: 'BLACK HOLE', icon: '⚫', hint: 'Hold — particles get sucked into the cursor' },
  { id: 'gravity', label: 'GRAVITY', icon: '🌍', hint: 'Hold — particles orbit around the cursor' },
  { id: 'fire', label: 'FIRE', icon: '🔥', hint: 'Hold — particles rise like flames from cursor' },
]

const COUNT_STEP = 1000
const COUNT_MIN = 1000
const COUNT_MAX = 50000

const ctrlBtn: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.06)',
  color: '#fff',
  fontSize: 16,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.15s ease',
}

function fpsColor(fps: number): string {
  if (fps > 50) return '#3ddc84'
  if (fps > 30) return '#f5c542'
  return '#ff5c5c'
}

function SceneContent({
  mode,
  controls,
  isPointerDown,
  onFpsUpdate,
  autoRotate,
}: {
  mode: InteractionMode
  controls: ParticleControls
  isPointerDown: boolean
  onFpsUpdate: (fps: number) => void
  autoRotate: boolean
}) {
  return (
    <>
      <color attach="background" args={['#0a0a0f']} />
      <ambientLight intensity={0.2} />
      <Stars radius={80} depth={40} count={2000} factor={3} saturation={0} fade speed={0.4} />
      <ParticleSystem
        mode={mode}
        controls={controls}
        isPointerDown={isPointerDown}
        onFpsUpdate={onFpsUpdate}
      />
      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.5}
        minDistance={4}
        maxDistance={40}
        autoRotate={autoRotate}
        autoRotateSpeed={0.4}
        mouseButtons={{
          LEFT: -1 as MOUSE,
          MIDDLE: MOUSE.DOLLY,
          RIGHT: MOUSE.ROTATE,
        }}
      />
      <EffectComposer multisampling={0}>
        <Bloom luminanceThreshold={0.2} luminanceSmoothing={0.85} intensity={1.35} mipmapBlur />
      </EffectComposer>
    </>
  )
}

export default function App() {
  const [mode, setMode] = useState<InteractionMode>('swirl')
  const [fps, setFps] = useState(60)
  const [isPointerDown, setIsPointerDown] = useState(false)
  const [autoRotate, setAutoRotate] = useState(true)
  const [count, setCount] = useState(10000)
  const [speed, setSpeed] = useState(1)
  const [particleSize, setParticleSize] = useState(1)
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const controls = useMemo<ParticleControls>(
    () => ({ count, speed, size: particleSize }),
    [count, speed, particleSize]
  )

  const activeMode = useMemo(() => MODES.find((m) => m.id === mode)!, [mode])

  const onFpsUpdate = useCallback((value: number) => {
    setFps(value)
  }, [])

  const bumpIdle = useCallback(() => {
    setAutoRotate(false)
    if (idleRef.current) clearTimeout(idleRef.current)
    idleRef.current = setTimeout(() => setAutoRotate(true), 4000)
  }, [])

  useEffect(() => {
    return () => {
      if (idleRef.current) clearTimeout(idleRef.current)
    }
  }, [])

  const changeCount = useCallback((delta: number) => {
    setCount((c) => Math.min(COUNT_MAX, Math.max(COUNT_MIN, c + delta)))
  }, [])

  const glass: CSSProperties = {
    background: 'rgba(12, 14, 22, 0.55)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 14,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
  }

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
        background: '#0a0a0f',
        fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
        color: '#e8eaf0',
        userSelect: 'none',
      }}
      onPointerDown={() => {
        setIsPointerDown(true)
        bumpIdle()
      }}
      onPointerUp={() => setIsPointerDown(false)}
      onPointerLeave={() => setIsPointerDown(false)}
      onPointerMove={bumpIdle}
    >
      <Canvas
        camera={{ position: [0, 2, 16], fov: 55, near: 0.1, far: 200 }}
        dpr={[1, 1.5]}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <Suspense fallback={null}>
          <SceneContent
            mode={mode}
            controls={controls}
            isPointerDown={isPointerDown}
            onFpsUpdate={onFpsUpdate}
            autoRotate={autoRotate && !isPointerDown}
          />
        </Suspense>
      </Canvas>

      {/* Top left — title */}
      <div
        style={{
          position: 'absolute',
          top: 20,
          left: 24,
          zIndex: 10,
          pointerEvents: 'none',
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: '0.08em',
            background: 'linear-gradient(135deg, #fff 0%, #8ab4ff 50%, #c084fc 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          🌪️ VORTEX
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 11, opacity: 0.45, letterSpacing: '0.12em' }}>
          PARTICLE PHYSICS SIMULATOR
        </p>
      </div>

      {/* Top right — FPS */}
      <div
        style={{
          ...glass,
          position: 'absolute',
          top: 20,
          right: 24,
          zIndex: 10,
          padding: '8px 14px',
          fontSize: 13,
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 600,
          color: fpsColor(fps),
          pointerEvents: 'none',
        }}
      >
        {fps} FPS
      </div>

      {/* Top center — mode selector */}
      <div
        style={{
          position: 'absolute',
          top: 18,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          display: 'flex',
          gap: 8,
          padding: 8,
          ...glass,
          flexWrap: 'wrap',
          justifyContent: 'center',
          maxWidth: 'min(920px, calc(100vw - 280px))',
        }}
      >
        {MODES.map((m) => {
          const active = mode === m.id
          return (
            <button
              key={m.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setMode(m.id)
              }}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 12px',
                border: active ? '1px solid rgba(255,255,255,0.35)' : '1px solid transparent',
                borderRadius: 10,
                background: active
                  ? 'linear-gradient(135deg, rgba(99,102,241,0.45), rgba(168,85,247,0.35))'
                  : 'rgba(255,255,255,0.04)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.04em',
                transition: 'transform 0.15s ease, background 0.2s ease, border-color 0.2s ease',
                transform: active ? 'scale(1.04)' : 'scale(1)',
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
              }}
            >
              <span style={{ fontSize: 15 }}>{m.icon}</span>
              <span>{m.label}</span>
            </button>
          )
        })}
      </div>

      {/* Bottom center — controls */}
      <div
        style={{
          ...glass,
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          padding: '14px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 22,
          flexWrap: 'wrap',
          justifyContent: 'center',
          maxWidth: 'min(640px, calc(100vw - 40px))',
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, opacity: 0.55, letterSpacing: '0.06em' }}>PARTICLES</span>
          <button
            type="button"
            aria-label="Decrease particle count"
            onClick={() => changeCount(-COUNT_STEP)}
            style={ctrlBtn}
          >
            −
          </button>
          <span
            style={{
              minWidth: 56,
              textAlign: 'center',
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              fontSize: 14,
            }}
          >
            {count.toLocaleString()}
          </span>
          <button
            type="button"
            aria-label="Increase particle count"
            onClick={() => changeCount(COUNT_STEP)}
            style={ctrlBtn}
          >
            +
          </button>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11 }}>
          <span style={{ opacity: 0.55, letterSpacing: '0.06em' }}>SPEED</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            style={{ width: 100, accentColor: '#818cf8' }}
          />
          <span style={{ minWidth: 36, fontWeight: 600, fontSize: 13 }}>{speed.toFixed(2)}×</span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11 }}>
          <span style={{ opacity: 0.55, letterSpacing: '0.06em' }}>SIZE</span>
          <input
            type="range"
            min={0.3}
            max={3}
            step={0.05}
            value={particleSize}
            onChange={(e) => setParticleSize(parseFloat(e.target.value))}
            style={{ width: 100, accentColor: '#818cf8' }}
          />
          <span style={{ minWidth: 36, fontWeight: 600, fontSize: 13 }}>
            {particleSize.toFixed(2)}
          </span>
        </label>
      </div>

      {/* Bottom right — instructions */}
      <div
        style={{
          ...glass,
          position: 'absolute',
          bottom: 24,
          right: 24,
          zIndex: 10,
          padding: '12px 16px',
          maxWidth: 260,
          pointerEvents: 'none',
        }}
      >
        <div style={{ fontSize: 11, opacity: 0.5, letterSpacing: '0.08em', marginBottom: 6 }}>
          {activeMode.icon} {activeMode.label}
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.45, opacity: 0.85 }}>{activeMode.hint}</div>
        <div style={{ fontSize: 11, marginTop: 8, opacity: 0.4, lineHeight: 1.4 }}>
          Right-drag rotate · Scroll zoom · Idle auto-rotate
        </div>
      </div>
    </div>
  )
}
