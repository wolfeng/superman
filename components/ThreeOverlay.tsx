import React, { useRef, useMemo, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { EyePosition } from '../types';

// Fix for missing JSX Intrinsic Elements in some TS configurations
// We need to augment 'react' module for React 18+ types
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      group: any;
      mesh: any;
      meshBasicMaterial: any;
    }
  }
}

// Fallback for global JSX namespace
declare global {
  namespace JSX {
    interface IntrinsicElements {
      group: any;
      mesh: any;
      meshBasicMaterial: any;
    }
  }
}

// --- AUDIO SYSTEM ---
const useLaserSound = (active: boolean) => {
    const audioContextRef = useRef<AudioContext | null>(null);
    const masterGainRef = useRef<GainNode | null>(null);
    const oscillatorsRef = useRef<OscillatorNode[]>([]);
    const noiseNodeRef = useRef<AudioBufferSourceNode | null>(null);
    const noiseGainRef = useRef<GainNode | null>(null);

    useEffect(() => {
        // Initialize Audio Context on first mount
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
            audioContextRef.current = new AudioContextClass();
            const ctx = audioContextRef.current;
            masterGainRef.current = ctx.createGain();
            masterGainRef.current.gain.value = 0;
            masterGainRef.current.connect(ctx.destination);
        }

        return () => {
            audioContextRef.current?.close();
        };
    }, []);

    useEffect(() => {
        const ctx = audioContextRef.current;
        const master = masterGainRef.current;
        if (!ctx || !master) return;

        if (active) {
            // Resume context if suspended (browser autoplay policy)
            if (ctx.state === 'suspended') {
                ctx.resume();
            }

            const now = ctx.currentTime;

            // 1. BEAM HUM (Sawtooth Drones)
            // Clear previous oscs
            oscillatorsRef.current.forEach(osc => osc.stop());
            oscillatorsRef.current = [];

            const createOsc = (freq: number, type: OscillatorType, detune: number) => {
                const osc = ctx.createOscillator();
                osc.type = type;
                osc.frequency.value = freq;
                osc.detune.value = detune;
                osc.connect(master);
                osc.start();
                return osc;
            };

            // Dual Sawtooths for "High Voltage" sound
            oscillatorsRef.current.push(createOsc(80, 'sawtooth', -10)); // Low Hz
            oscillatorsRef.current.push(createOsc(82, 'sawtooth', 10));  // Detuned for phasing
            oscillatorsRef.current.push(createOsc(160, 'square', 0));    // Upper harmonic

            // 2. SPARK CRACKLE (Noise)
            const bufferSize = ctx.sampleRate * 2; // 2 seconds buffer
            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1; // White noise
            }

            const noiseSource = ctx.createBufferSource();
            noiseSource.buffer = buffer;
            noiseSource.loop = true;

            // Filter noise to sound like sparks (High Pass)
            const noiseFilter = ctx.createBiquadFilter();
            noiseFilter.type = 'highpass';
            noiseFilter.frequency.value = 1000;

            // Crackle modulation (randomly gate the noise volume)
            const crackleGain = ctx.createGain();
            crackleGain.gain.value = 0; // Start silent, modulated below

            noiseSource.connect(noiseFilter);
            noiseFilter.connect(crackleGain);
            crackleGain.connect(master);
            noiseSource.start();

            noiseNodeRef.current = noiseSource;
            noiseGainRef.current = crackleGain;

            // Ramp Up Volume (Attack)
            master.gain.cancelScheduledValues(now);
            master.gain.setValueAtTime(0, now);
            master.gain.linearRampToValueAtTime(0.4, now + 0.1); // Main Volume

        } else {
            // Ramp Down Volume (Release)
            const now = ctx.currentTime;
            master.gain.cancelScheduledValues(now);
            master.gain.setValueAtTime(master.gain.value, now);
            master.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

            // Stop nodes after release
            setTimeout(() => {
                oscillatorsRef.current.forEach(osc => {
                    try { osc.stop(); } catch(e) {}
                });
                oscillatorsRef.current = [];
                
                if (noiseNodeRef.current) {
                    try { noiseNodeRef.current.stop(); } catch(e) {}
                    noiseNodeRef.current = null;
                }
            }, 350);
        }
    }, [active]);

    // Frame loop for Crackle Randomization
    useFrame(() => {
        if (active && noiseGainRef.current && audioContextRef.current) {
            // Randomly spike the volume of the noise channel to simulate sparks
            // "Welding" sound is erratic
            const shouldCrackle = Math.random() > 0.7; 
            const currentVol = shouldCrackle ? Math.random() * 0.8 : 0;
            // Instant change for sharp pops
            noiseGainRef.current.gain.setValueAtTime(currentVol, audioContextRef.current.currentTime);
        }
    });
};


interface LaserPointProps {
  startPoint: THREE.Vector3;
  active: boolean;
}

const LaserPoint: React.FC<LaserPointProps> = ({ startPoint, active }) => {
  const { viewport } = useThree();
  const glowRef = useRef<THREE.Mesh>(null);
  const midRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  
  // Geometry: Circle for the point source
  const sourceGeo = useMemo(() => new THREE.CircleGeometry(1, 32), []); 
  
  useFrame((state) => {
    if (!active) return;

    // Dynamic scaling factor based on viewport width
    // Reduced base size slightly further to 0.0035
    const scaleBase = viewport.width * 0.0035; 

    // 1. Outer Glow (Halo) - Flattened Oval & Smaller
    // Flattened: Wider (X) than Tall (Y) to match eye shape (almond/oval)
    // Reduced size: X=3.0 (was 3.5), Y=1.4 (flattened)
    if (glowRef.current) {
        glowRef.current.position.copy(startPoint);
        glowRef.current.scale.set(scaleBase * 3.0, scaleBase * 1.4, 1);
    }

    // 2. Mid Layer (Heat) - Transition
    // Slightly flattened to bridge the gap between circular core and oval glow
    if (midRef.current) {
        midRef.current.position.copy(startPoint);
        midRef.current.position.z = startPoint.z + 0.05;
        midRef.current.scale.set(scaleBase * 1.8, scaleBase * 1.5, 1);
    }

    // 3. Inner Core (Source) - Hot Center
    // Keep mostly circular for the "pupil/iris" feel
    if (coreRef.current) {
        coreRef.current.position.copy(startPoint);
        coreRef.current.position.z = startPoint.z + 0.1;
        coreRef.current.scale.set(scaleBase * 1.1, scaleBase * 1.1, 1);
    }
  });

  if (!active) return null;

  return (
    <group>
        {/* Outer Red Circle - Flattened, very transparent for blur effect */}
        <mesh ref={glowRef} geometry={sourceGeo}>
            <meshBasicMaterial 
                color="#ff0000" 
                transparent 
                opacity={0.15} 
                toneMapped={false} 
                blending={THREE.AdditiveBlending} 
            />
        </mesh>
        
        {/* Mid Body - Intense Orange/Red - Added additive blending for smoother look */}
        <mesh ref={midRef} geometry={sourceGeo}>
            <meshBasicMaterial 
                color="#ff4400" 
                transparent 
                opacity={0.6} 
                toneMapped={false} 
                blending={THREE.AdditiveBlending}
            />
        </mesh>
        
        {/* Inner Flame Core - Yellowish */}
        <mesh ref={coreRef} geometry={sourceGeo}>
            <meshBasicMaterial 
                color="#ffffaa" 
                transparent 
                opacity={1.0} 
                toneMapped={false} 
            />
        </mesh>
    </group>
  );
};

const MAX_PARTICLES = 80; // More particles for sparks

interface ParticleData {
    active: boolean;
    life: number;
    maxLife: number;
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    color: THREE.Color;
}

const SparkSystem = ({ beamLengthRef }: { beamLengthRef: React.MutableRefObject<number> }) => {
    const { viewport } = useThree();
    const meshesRef = useRef<(THREE.Mesh | null)[]>([]);
    
    // Spark Data Pool
    const particles = useMemo(() => {
        return new Array(MAX_PARTICLES).fill(0).map((): ParticleData => ({
            active: false,
            life: 0,
            maxLife: 0,
            position: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            color: new THREE.Color()
        }));
    }, []);

    // Geometry: Small cubes/debris for sparks
    const sparkGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);

    useFrame((state, delta) => {
        const baseScale = viewport.width * 0.0015; // Small sparks
        const gravity = 90; // Heavy gravity for welding effect

        // 1. Spawn Logic
        // Only spawn when beam effectively hits screen (clamped Z ~ 95)
        // We can check if the beam is "fully extended" enough to hit screen
        const impactZ = 95;
        const isHittingScreen = beamLengthRef.current >= impactZ;

        if (isHittingScreen) {
             // High spawn rate for continuous shower
            const spawnCount = 2; 
            for(let s=0; s<spawnCount; s++) {
                const p = particles.find(p => !p.active);
                if (p) {
                    p.active = true;
                    p.maxLife = 0.5 + Math.random() * 0.5; // Short life (0.5-1.0s)
                    p.life = p.maxLife;
                    
                    // Spawn at Impact Point
                    p.position.set(
                        (Math.random() - 0.5) * 2, // Slight X spread
                        impactZ,                   // Exactly at screen plane
                        (Math.random() - 0.5) * 2  // Slight Z spread
                    );

                    // Explosion Velocity: Fast outward burst
                    const angle = Math.random() * Math.PI * 2;
                    const speed = 20 + Math.random() * 30; // Fast!
                    
                    p.velocity.set(
                        Math.cos(angle) * speed,    // Radial X
                        (Math.random() * 10) + 10,   // Initial UP burst (deflection)
                        Math.sin(angle) * speed     // Radial Z
                    );
                    
                    // Initial Color: White Hot -> Yellow -> Orange -> Red
                    p.color.setHSL(0.15, 1.0, 0.9); // Pale Yellow/White
                }
            }
        }

        // 2. Update Logic
        particles.forEach((p, i) => {
            const mesh = meshesRef.current[i];
            if (!mesh) return;

            if (p.active) {
                p.life -= delta;
                
                if (p.life <= 0) {
                    p.active = false;
                    mesh.visible = false;
                } else {
                    mesh.visible = true;

                    // Physics
                    p.velocity.y -= gravity * delta; // Apply Gravity
                    p.position.addScaledVector(p.velocity, delta);

                    // Visuals
                    const progress = 1 - (p.life / p.maxLife);
                    
                    // Color Transition: White Hot -> Red Cool
                    // Start: H=60(Yellow), L=90(White) -> End: H=0(Red), L=30(Dark)
                    const hue = THREE.MathUtils.lerp(0.15, 0.0, progress * 1.5); // Yellow to Red
                    const light = THREE.MathUtils.lerp(0.9, 0.3, progress);
                    
                    const mat = mesh.material as THREE.MeshBasicMaterial;
                    mat.color.setHSL(hue, 1.0, light);
                    mat.opacity = 1.0 - Math.pow(progress, 3); // Fade out sharply at end

                    mesh.position.copy(p.position);
                    // Align spark with velocity for "streak" look
                    mesh.lookAt(p.position.clone().add(p.velocity));
                    mesh.scale.set(baseScale, baseScale, baseScale * 4); // Stretch along Z (velocity)
                }
            } else {
                mesh.visible = false;
            }
        });
    });

    return (
        <group>
            {particles.map((_, i) => (
                <mesh 
                    key={i} 
                    ref={(el: THREE.Mesh | null) => { meshesRef.current[i] = el; }}
                    geometry={sparkGeo}
                >
                    <meshBasicMaterial 
                        transparent 
                        blending={THREE.AdditiveBlending} 
                        depthWrite={false} 
                    />
                </mesh>
            ))}
        </group>
    );
};

interface LaserBeamProps {
    startPoint: THREE.Vector3;
}

const LaserBeam: React.FC<LaserBeamProps> = ({ startPoint }) => {
    const { viewport } = useThree();
    const groupRef = useRef<THREE.Group>(null);
    const coreRef = useRef<THREE.Mesh>(null);
    const glowRef = useRef<THREE.Mesh>(null);
    
    // Store current beam length in a ref to share with SmokeSystem
    const currentLength = useRef(0);
    
    // Create beam geometries that are anchored at the bottom (y=0) so they grow outwards
    const beamGeo = useMemo(() => {
        const geo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
        // Translate geometry so origin is at the bottom, allowing us to scale 'height' upwards easily
        geo.translate(0, 0.5, 0); 
        return geo;
    }, []);

    useFrame((state, delta) => {
        if (groupRef.current) {
            const scaleBase = viewport.width * 0.0035;
            
            // 1. Position Beam at Eye
            groupRef.current.position.copy(startPoint);
            
            // 2. Rotate 90deg on X so 'Up' (Y) becomes 'Forward' (Z) towards camera
            // In Perspective Camera (looking down -Z), positive Z is towards the camera.
            groupRef.current.rotation.x = Math.PI / 2;
            
            // 3. Animate "Shooting" Effect
            // Lerp length from 0 to 200 (past camera)
            // Stop growing at 200 so it doesn't go infinite, but smoke clamps at 95
            currentLength.current = THREE.MathUtils.lerp(currentLength.current, 200, delta * 15);
            
            // 4. Scale Thickness
            // Match the core of the LaserPoint (1.1 * scaleBase)
            // Inner beam slightly smaller, Outer glow larger
            const innerThickness = scaleBase * 1.1;
            const outerThickness = scaleBase * 4.0; // Wider flare for the beam glow

            // Apply scales via refs
            if (coreRef.current) {
                coreRef.current.scale.set(innerThickness, currentLength.current, innerThickness);
            }

            if (glowRef.current) {
                glowRef.current.scale.set(outerThickness, currentLength.current, outerThickness);
                // 5. Add Energy Flicker to Glow
                const glowMaterial = glowRef.current.material as THREE.MeshBasicMaterial;
                glowMaterial.opacity = 0.2 + Math.sin(state.clock.elapsedTime * 40) * 0.1;
            }
        }
    });

    return (
        <group ref={groupRef}>
            {/* Core Beam - Yellowish White */}
            <mesh ref={coreRef} geometry={beamGeo}>
                <meshBasicMaterial 
                    color="#ffffaa" 
                    transparent 
                    opacity={0.9} 
                    blending={THREE.AdditiveBlending} 
                    depthWrite={false}
                />
            </mesh>
            {/* Outer Glow Beam - Red & Fading */}
            <mesh ref={glowRef} geometry={beamGeo}>
                <meshBasicMaterial 
                    color="#ff0000" 
                    transparent 
                    opacity={0.2} 
                    blending={THREE.AdditiveBlending} 
                    depthWrite={false}
                    side={THREE.DoubleSide}
                />
            </mesh>
            
            {/* Particle System for Welding Sparks */}
            <SparkSystem beamLengthRef={currentLength} />
        </group>
    );
}

interface SceneProps {
    eyes: EyePosition | null;
    isFiring: boolean;
}

const Scene: React.FC<SceneProps> = ({ eyes, isFiring }) => {
    const { viewport } = useThree();
    const [showBeams, setShowBeams] = useState(false);

    // Logic to delay beam firing by 0.5 second (was 1000ms)
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        
        if (isFiring) {
            // Start timer to fire beams
            timer = setTimeout(() => {
                setShowBeams(true);
            }, 500); // Reduced delay to 500ms
        } else {
            // Immediately stop beams if trigger is lost
            setShowBeams(false);
        }

        return () => {
            if (timer) clearTimeout(timer);
        };
    }, [isFiring]);

    // --- HOOK SOUND EFFECT ---
    // Plays when beams are actually visible/firing
    useLaserSound(showBeams);

    // Convert normalized MediaPipe coordinates (0-1) to Three.js Viewport Coordinates
    // R3F Viewport at Z=0 matches the screen plane in both Ortho and Perspective (if configured right)
    const getVector = (pt: { x: number, y: number }) => {
        // Center is (0,0). 
        // MediaPipe (0,0) is Top-Left. 
        // Flip X for mirrored camera.
        const x = (pt.x - 0.5) * viewport.width * -1;
        const y = -(pt.y - 0.5) * viewport.height;
        return new THREE.Vector3(x, y, 0);
    };

    const leftEyePos = eyes ? getVector(eyes.left) : new THREE.Vector3(0,0,0);
    const rightEyePos = eyes ? getVector(eyes.right) : new THREE.Vector3(0,0,0);

    return (
        <>
             <LaserPoint 
                startPoint={leftEyePos} 
                active={isFiring && !!eyes} 
            />
            <LaserPoint 
                startPoint={rightEyePos} 
                active={isFiring && !!eyes} 
            />
            
            {/* Render beams only after delay */}
            {showBeams && eyes && isFiring && (
                <>
                    <LaserBeam startPoint={leftEyePos} />
                    <LaserBeam startPoint={rightEyePos} />
                </>
            )}
        </>
    );
}

interface ThreeOverlayProps {
  eyes: EyePosition | null;
  isFiring: boolean;
}

export const ThreeOverlay: React.FC<ThreeOverlayProps> = ({ eyes, isFiring }) => {
  return (
    <Canvas
      className="absolute inset-0 pointer-events-none z-20"
      // Perspective camera creates the "shooting out at you" effect
      // FOV 75 is standard. Position Z=100 allows standard viewport mapping.
      camera={{ fov: 75, position: [0, 0, 100] }}
      gl={{ alpha: true, antialias: true }}
    >
      <Scene eyes={eyes} isFiring={isFiring} />
      <EffectComposer>
        <Bloom 
            luminanceThreshold={0.2} 
            luminanceSmoothing={0.9} 
            height={300} 
            intensity={1.0} 
        />
      </EffectComposer>
    </Canvas>
  );
};