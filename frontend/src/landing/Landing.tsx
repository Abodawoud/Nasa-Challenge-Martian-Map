// The landing page of team Red Compass.
//
// The look: black space full of stars, Mars rising from the bottom with a blue glow, glowing
// red rocks drifting around, and a dark veil that keeps the text easy to read. Below the
// first screen, a pinned story shows the idea in three steps while the 3D scene changes.
//
// Three.js draws the space scene (MarsScene.ts). GSAP ScrollTrigger moves one small state
// object while the page scrolls. Honesty rule: what is not built yet is marked "Coming next".
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Badge, Box, Button, Container, Flex, Heading, HStack, IconButton, Link, SimpleGrid, Text, VStack } from '@chakra-ui/react'
import { ArrowDown, ArrowRight, Camera, Globe, Layers, Layers2, MapPin, Menu, Mountain, MoveDown, Route, Satellite, X } from 'lucide-react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { JEZERO, ROUTE_GOAL, createMarsScene, facingLongitude, loadMarsTexture } from './MarsScene'
import type { SceneState } from './MarsScene'
import { CompassStar, LOGO_NAVY, LOGO_RED } from '../ui/CompassStar'

gsap.registerPlugin(ScrollTrigger)

// Colours: the red and navy of the Red Compass logo, white on black space, a blue glow
// around the planet. EMBER is the orange-red of the floating rocks, used for small accents.
const RED = LOGO_RED
const EMBER = '#ff4a1c'
const NAVY = LOGO_NAVY
const DISPLAY_FONT = "'Unbounded', 'Inter', system-ui, sans-serif"

const NAV = [
  ['Mission', '#mission'],
  ['About Red Compass', '#about'],
  ['Data System', '#data'],
  ['Interface', '#interface'],
] as const

const STEPS = [
  {
    number: '01',
    title: 'See the whole planet',
    text: 'Start in space. Mars as a globe or as a flat map, built from NASA colour images.',
    Icon: Globe,
    ready: true,
  },
  {
    number: '02',
    title: 'Land in Jezero Crater',
    text: 'Fly down to where the Perseverance rover landed. Real 3D ground, photos sharp enough to see sand ripples.',
    Icon: MapPin,
    ready: true,
  },
  {
    number: '03',
    title: 'Plan the Marswalk',
    text: 'Pick a start and a science goal. The map compares two ways to walk there: distance, climb, slope and time.',
    Icon: Route,
    ready: false,
  },
] as const

const DATA = [
  { value: '232 m', label: 'The whole planet', text: 'Viking colour mosaic. The planet you see on this page.', Icon: Globe },
  { value: '6 m', label: 'Jezero region', text: 'CTX camera mosaic, with all photo strips aligned.', Icon: Camera },
  { value: '25 cm', label: 'Near the landing site', text: 'HiRISE, the sharpest camera in orbit around Mars.', Icon: Layers },
  { value: '3D', label: 'Real terrain', text: 'NASA Mars Trek elevation: crater walls, the delta, the hills.', Icon: Mountain },
] as const

const INTERFACE = [
  { title: '2D and 3D', text: 'Switch between a flat map and the real planet. You stay at the same place.', Icon: Layers2 },
  { title: 'Down to the ground', text: 'Fly to Jezero and go down to 25 m above the surface, under a Mars sky.', Icon: MoveDown },
  { title: 'Live NASA data', text: 'Nothing is stored. Every image comes from NASA at the moment you look at it.', Icon: Satellite },
] as const

function openMap() {
  window.location.hash = '#/map'
}

export default function Landing() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (!canvasRef.current || !rootRef.current) return
    // The small mosaic shows at once, the sharp one replaces it when it has loaded.
    const mars = createMarsScene(canvasRef.current, [loadMarsTexture(2), loadMarsTexture(3)])
    const s = mars.state
    const media = gsap.matchMedia(rootRef.current)

    media.add(
      { desktop: '(min-width: 900px)', reduce: '(prefers-reduced-motion: reduce)' },
      (context) => {
        const { desktop, reduce } = context.conditions as { desktop: boolean; reduce: boolean }
        // First screen: the planet rises from the bottom, low enough to stay under the buttons.
        const horizon: SceneState = { x: 0, y: desktop ? -2.6 : -2.2, scale: desktop ? 2.1 : 1.5, rotY: 0, rotX: 0.25, spin: 1, marker: 0, routes: 0, rings: 1 }
        // The story: the whole planet beside the text (on a phone: behind it, lower).
        const whole = { x: desktop ? 1.3 : 0, y: desktop ? 0 : -1.0, scale: desktop ? 1.02 : 0.85, rotX: 0.15, rings: 1 }
        const jezero = { rotY: facingLongitude(JEZERO.lon), rotX: (JEZERO.lat * Math.PI) / 180, spin: 0, marker: 1, scale: desktop ? 1.75 : 1.25 }
        // Step 3 looks at the middle between START and GOAL, close enough to read both.
        const middle = { lat: (JEZERO.lat + ROUTE_GOAL.lat) / 2, lon: (JEZERO.lon + ROUTE_GOAL.lon) / 2 }
        const walk = { rotY: facingLongitude(middle.lon), rotX: (middle.lat * Math.PI) / 180, scale: desktop ? 2.15 : 1.7, x: desktop ? 1.05 : 0, y: desktop ? 0 : -1.2, routes: 1 }
        const aside = { x: desktop ? -1.75 : 0, y: desktop ? 0.1 : -1.3, scale: desktop ? 1.2 : 0.9, routes: 0, marker: 0, spin: 1, rotX: 0.2, rings: 1 }
        const finale = { x: horizon.x, y: horizon.y, scale: horizon.scale, rotX: horizon.rotX, rings: 1 }

        gsap.set(s, horizon)
        if (reduce) return // no scroll animation: the planet stays as on the first screen

        // Smooth scrolling: the page glides to where the wheel sent it, and the planet follows
        // a little behind (the scrub values below). Menu links glide to their section too.
        const lenis = new Lenis({ lerp: 0.09, anchors: true })
        lenis.on('scroll', ScrollTrigger.update)
        const tick = (time: number) => lenis.raf(time * 1000)
        gsap.ticker.add(tick)
        gsap.ticker.lagSmoothing(0)

        // The title arrives line by line.
        // fromTo with the end written out: the launch button has its own CSS transition, and
        // with a plain from() GSAP read "invisible" as its end value and left it hidden.
        gsap.fromTo('[data-hero] > *', { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 1, stagger: 0.1, ease: 'power3.out', delay: 0.15 })

        // First screen -> the planet becomes a whole globe beside the text.
        gsap.to(s, { ...whole, ease: 'none', immediateRender: false, scrollTrigger: { trigger: '#mission', start: 'top bottom', end: 'top top', scrub: 0.8 } })

        // The pinned story: the planet turns to Jezero, then two points and two routes appear.
        const story = gsap.timeline({
          scrollTrigger: {
            trigger: '#mission',
            start: 'top top',
            end: 'bottom bottom',
            scrub: 0.8,
            onUpdate: (self) => setStep(self.progress < 0.28 ? 0 : self.progress < 0.62 ? 1 : 2),
          },
        })
        story
          .to(s, { duration: 0.18 }) // rest on the whole planet
          .to(s, { ...jezero, duration: 0.28, ease: 'power2.inOut' })
          .to(s, { duration: 0.1 })
          .to(s, { ...walk, duration: 0.3, ease: 'power2.inOut' })
          .to(s, { duration: 0.14 })

        gsap.to(s, { ...aside, ease: 'none', immediateRender: false, scrollTrigger: { trigger: '#data', start: 'top bottom', end: 'top 25%', scrub: 0.8 } })
        gsap.to(s, { ...finale, ease: 'none', immediateRender: false, scrollTrigger: { trigger: '#about', start: 'top bottom', end: 'bottom bottom', scrub: 0.8 } })

        // Blocks rise into place when they enter the screen.
        for (const element of gsap.utils.toArray<HTMLElement>('[data-reveal]')) {
          gsap.from(element, { y: 44, opacity: 0, duration: 0.8, ease: 'power3.out', scrollTrigger: { trigger: element, start: 'top 88%' } })
        }

        return () => {
          gsap.ticker.remove(tick)
          lenis.destroy()
        }
      },
    )

    return () => {
      media.revert()
      mars.dispose()
    }
  }, [])

  return (
    <Box
      ref={rootRef}
      position="relative"
      minH="100vh"
      color="white"
      bg="#000"
      overflowX="clip"
      // Black space with faint clouds of dust: grey-blue on the right, red on the left.
      backgroundImage="radial-gradient(38% 30% at 82% 30%, rgba(140,160,205,0.13), transparent 70%), radial-gradient(30% 26% at 18% 38%, rgba(190,70,40,0.12), transparent 70%), radial-gradient(50% 40% at 50% 0%, rgba(40,50,90,0.25), transparent 75%)"
      backgroundAttachment="fixed"
    >
      {/* The 3D space scene, fixed behind the whole page. */}
      <canvas ref={canvasRef} aria-hidden style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }} />

      {/* A dark veil over the 3D scene: darker at the top and bottom, so text is easy to read. */}
      <Box
        aria-hidden
        position="fixed"
        inset="0"
        zIndex="0"
        pointerEvents="none"
        backgroundImage="linear-gradient(180deg, rgba(0,0,0,0.48) 0%, rgba(0,0,0,0.16) 34%, rgba(0,0,0,0.28) 62%, rgba(0,0,0,0.62) 100%), radial-gradient(120% 90% at 50% 45%, transparent 60%, rgba(0,0,0,0.45) 100%)"
      />

      {/* Shooting stars (CSS, see index.css). */}
      <Box aria-hidden position="fixed" inset="0" zIndex="0" pointerEvents="none" overflow="hidden">
        <span className="shooting-star" style={{ top: '18%', left: '24%', animationDelay: '1s' }} />
        <span className="shooting-star" style={{ top: '26%', left: '72%', animationDelay: '5.5s' }} />
        <span className="shooting-star" style={{ top: '12%', left: '58%', animationDelay: '9s' }} />
      </Box>

      {/* Floating top bar: the team lockup, a glass pill menu, and the way into the map. */}
      <Flex as="header" position="fixed" top="4" insetX="0" zIndex="20" justify="center" px={{ base: '4', md: '8' }}>
        <Flex w="full" maxW="1280px" align="center" justify="space-between" gap="4">
          <HStack gap="3.5" pl="4" pr="5" py="2" borderRadius="full" borderWidth="1px" borderColor="whiteAlpha.200" bg="whiteAlpha.100" backdropFilter="blur(14px)">
            {/* The event name as text. The NASA logo itself needs permission from NASA, so it is not used. */}
            <Box lineHeight="1.1" hideBelow="sm">
              <Text fontFamily={DISPLAY_FONT} fontWeight="700" fontSize="xs" letterSpacing="0.04em">
                NASA SPACE APPS
              </Text>
              <Text fontSize="2xs" letterSpacing="0.2em" color="whiteAlpha.700">
                CHALLENGE 2026
              </Text>
            </Box>
            <Box w="1px" h="7" bg="whiteAlpha.400" hideBelow="sm" />
            <HStack gap="2.5">
              <CompassStar size={32} />
              <Text fontFamily={DISPLAY_FONT} fontWeight="600" fontSize="xs" lineHeight="1.15" letterSpacing="0.04em">
                RED
                <br />
                COMPASS
              </Text>
            </HStack>
          </HStack>

          <HStack as="nav" aria-label="Sections" gap="1" px="2" py="1" borderRadius="full" borderWidth="1px" borderColor="whiteAlpha.200" bg="whiteAlpha.100" backdropFilter="blur(14px)" hideBelow="lg">
            {NAV.map(([label, href]) => (
              <Link key={href} href={href} px="3.5" py="1.5" fontSize="sm" color="whiteAlpha.800" borderRadius="full" _hover={{ color: 'white', bg: 'whiteAlpha.200', textDecoration: 'none' }}>
                {label}
              </Link>
            ))}
          </HStack>

          <HStack gap="2">
            <Button onClick={openMap} size="sm" borderRadius="full" bg={RED} color="white" boxShadow={`0 8px 28px ${RED}55`} _hover={{ bg: '#c91b17', transform: 'translateY(-1px)' }} transition="all 0.2s ease">
              Open the map
              <ArrowRight size={15} aria-hidden />
            </Button>
            {/* On small screens the section links move into this menu. */}
            <Box position="relative" hideFrom="lg">
              <IconButton
                aria-label={menuOpen ? 'Close the menu' : 'Open the menu'}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
                variant="outline"
                size="sm"
                color="white"
                borderColor="whiteAlpha.300"
                bg="whiteAlpha.100"
                backdropFilter="blur(14px)"
                borderRadius="full"
                _hover={{ bg: 'whiteAlpha.300' }}
              >
                {menuOpen ? <X size={16} aria-hidden /> : <Menu size={16} aria-hidden />}
              </IconButton>
              {menuOpen && (
                <VStack position="absolute" top="11" right="0" minW="220px" align="stretch" gap="1" p="2" borderRadius="xl" borderWidth="1px" borderColor="whiteAlpha.300" bg={`${NAVY}f2`} backdropFilter="blur(14px)" shadow="lg">
                  {NAV.map(([label, href]) => (
                    <Link key={href} href={href} onClick={() => setMenuOpen(false)} px="3" py="2" fontSize="sm" borderRadius="md" color="white" _hover={{ bg: 'whiteAlpha.200', textDecoration: 'none' }}>
                      {label}
                    </Link>
                  ))}
                </VStack>
              )}
            </Box>
          </HStack>
        </Flex>
      </Flex>

      <Box position="relative" zIndex="1">
        {/* First screen */}
        <Flex as="section" position="relative" minH="100vh" direction="column" align="center" pt={{ base: '32', md: '36' }} px="5" textAlign="center">
          <VStack data-hero gap="6" maxW="900px">
            <Heading as="h1" fontFamily={DISPLAY_FONT} fontWeight="500" lineHeight="1.05" letterSpacing="-0.02em" fontSize={{ base: '2.6rem', md: '4.4rem', lg: '5.2rem' }}>
              Find your way
              <Box as="span" display="block" color={RED}>
                on Mars.
              </Box>
            </Heading>
            <Text maxW="560px" fontSize={{ base: 'md', md: 'lg' }} color="whiteAlpha.900" lineHeight="tall">
              A map for the first walk on Mars. Real NASA images and real terrain of Jezero Crater, from the whole planet down to
              the ground under your boots.
            </Text>
            <HStack gap="3" wrap="wrap" justify="center">
              <Button onClick={openMap} size="lg" borderRadius="full" bg={RED} color="white" boxShadow={`0 8px 28px ${RED}55`} _hover={{ bg: '#c91b17', transform: 'translateY(-1px)' }} transition="all 0.2s ease">
                Open the map
                <ArrowRight size={18} aria-hidden />
              </Button>
              <Button asChild size="lg" variant="outline" borderRadius="full" borderColor="whiteAlpha.400" color="white" bg="blackAlpha.400" _hover={{ bg: 'whiteAlpha.200' }}>
                <a href="#mission">
                  See the idea
                  <ArrowDown size={18} aria-hidden />
                </a>
              </Button>
            </HStack>
          </VStack>
        </Flex>

        {/* Mission: a tall section. Its inside stays on screen while the steps change. */}
        <Box as="section" id="mission" h="340vh" position="relative">
          <Flex position="sticky" top="0" h="100vh" align="center">
            <Container maxW="1180px" px="5">
              <Box maxW={{ base: 'full', md: '480px' }}>
                <Eyebrow>Mission</Eyebrow>
                <SectionTitle>
                  Three steps.
                  <br />
                  One safe walk.
                </SectionTitle>
                <VStack mt="8" gap="2" align="stretch">
                  {STEPS.map(({ number, title, text, Icon, ready }, index) => {
                    const active = step === index
                    return (
                      <Box
                        key={number}
                        px="4"
                        py={active ? '4' : '2.5'}
                        borderRadius="xl"
                        borderWidth="1px"
                        borderColor={active ? 'whiteAlpha.300' : 'transparent'}
                        bg={active ? `${NAVY}d9` : 'transparent'}
                        backdropFilter={active ? 'blur(12px)' : undefined}
                        transition="all 0.35s ease"
                      >
                        <HStack justify="space-between" gap="3">
                          <HStack gap="3">
                            <Box w="3px" h="5" borderRadius="full" bg={active ? RED : 'whiteAlpha.300'} transition="background 0.35s" />
                            <Icon size={17} aria-hidden color={active ? '#fff' : 'rgba(255,255,255,0.55)'} />
                            <Text fontWeight="600" color={active ? 'white' : 'whiteAlpha.600'}>
                              {title}
                            </Text>
                            {!ready && (
                              <Badge size="sm" borderRadius="full" px="2" bg="whiteAlpha.200" color="white" borderWidth="1px" borderColor="whiteAlpha.400">
                                Coming next
                              </Badge>
                            )}
                          </HStack>
                          <Text fontSize="xs" color="whiteAlpha.500" fontVariantNumeric="tabular-nums">
                            {number}
                          </Text>
                        </HStack>
                        <Box display="grid" gridTemplateRows={active ? '1fr' : '0fr'} transition="grid-template-rows 0.35s ease">
                          <Box overflow="hidden">
                            <Text pt="2.5" fontSize="sm" color="whiteAlpha.800" lineHeight="tall">
                              {text}
                            </Text>
                            {index === 2 && (
                              // The key to the picture: which point and which line is which.
                              <SimpleGrid columns={2} gap="2" pt="3" fontSize="xs">
                                <Legend color={RED} shape="dot" label="Start" />
                                <Legend color="#fff" shape="dot" label="Science goal" />
                                <Legend color={RED} shape="line" label="Shortest route" />
                                <Legend color="#fff" shape="line" label="Gentler slopes" />
                              </SimpleGrid>
                            )}
                          </Box>
                        </Box>
                      </Box>
                    )
                  })}
                </VStack>
              </Box>
            </Container>
          </Flex>
        </Box>

        {/* Data system */}
        <Box as="section" id="data" py={{ base: '24', md: '36' }}>
          <Container maxW="1180px" px="5">
            <Box ml={{ base: '0', md: 'auto' }} maxW={{ base: 'full', md: '580px' }}>
              <Box data-reveal>
                <Eyebrow>Data system</Eyebrow>
                <SectionTitle>
                  Nothing invented.
                  <br />
                  <Box as="span" color={EMBER}>
                    All from NASA.
                  </Box>
                </SectionTitle>
                <Text mt="5" color="whiteAlpha.800" lineHeight="tall">
                  Every image and every hill on the map comes from a NASA mission, loaded live from NASA services. The closer you
                  get, the sharper the source.
                </Text>
              </Box>
              <SimpleGrid mt="8" columns={{ base: 1, sm: 2 }} gap="3">
                {DATA.map(({ value, label, text, Icon }) => (
                  <Card key={label}>
                    <HStack justify="space-between" align="start">
                      <Text fontSize="2xl" fontWeight="700">
                        {value}
                      </Text>
                      <Icon size={18} aria-hidden color={EMBER} />
                    </HStack>
                    <Text mt="2" fontWeight="600" fontSize="sm">
                      {label}
                    </Text>
                    <Text mt="1" fontSize="sm" color="whiteAlpha.700" lineHeight="tall">
                      {text}
                    </Text>
                  </Card>
                ))}
              </SimpleGrid>
            </Box>
          </Container>
        </Box>

        {/* Interface */}
        <Box as="section" id="interface" py={{ base: '20', md: '28' }}>
          <Container maxW="1180px" px="5">
            <Box ml={{ base: '0', md: 'auto' }} maxW={{ base: 'full', md: '580px' }}>
              <Box data-reveal>
                <Eyebrow>Interface</Eyebrow>
                <SectionTitle>
                  One screen.
                  <br />
                  Two views.
                </SectionTitle>
              </Box>
              <VStack mt="8" gap="3" align="stretch">
                {INTERFACE.map(({ title, text, Icon }) => (
                  <Card key={title}>
                    <HStack gap="4" align="start">
                      <Flex boxSize="10" flexShrink={0} align="center" justify="center" borderRadius="lg" bg="whiteAlpha.100" borderWidth="1px" borderColor="whiteAlpha.200">
                        <Icon size={18} aria-hidden color={EMBER} />
                      </Flex>
                      <Box>
                        <Text fontWeight="600">{title}</Text>
                        <Text mt="1" fontSize="sm" color="whiteAlpha.700" lineHeight="tall">
                          {text}
                        </Text>
                      </Box>
                    </HStack>
                  </Card>
                ))}
              </VStack>
            </Box>
          </Container>
        </Box>

        {/* About + closing call */}
        <Flex as="section" id="about" position="relative" minH="100vh" direction="column" align="center" pt={{ base: '24', md: '32' }} px="5" textAlign="center">
          <VStack data-reveal gap="6" maxW="780px">
            <Eyebrow>About Red Compass</Eyebrow>
            <SectionTitle size="lg">
              The planet is ready.
              <Box as="span" display="block" color={EMBER}>
                Take a look.
              </Box>
            </SectionTitle>
            <Text maxW="540px" color="whiteAlpha.800" lineHeight="tall">
              Red Compass is a team in the NASA Space Apps Challenge 2026. We build a map that helps the first people on Mars
              find their way. The map is open now: fly to Jezero, switch between 2D and 3D, go down to the surface. Route
              planning is the next step we are building.
            </Text>
            <Button onClick={openMap} size="lg" h="14" px="8" borderRadius="full" bg={RED} color="white" fontWeight="600" letterSpacing="0.05em" boxShadow={`0 8px 30px ${RED}66`} _hover={{ bg: '#c91b17', transform: 'translateY(-1px)' }} transition="all 0.2s ease">
              LAUNCH APPLICATION
              <ArrowRight size={18} aria-hidden />
            </Button>
          </VStack>
          <Text mt="auto" pb="6" pt="16" fontSize="xs" color="whiteAlpha.700">
            Images and terrain: NASA/JPL-Caltech Mars Trek · USGS Astrogeology · Red Compass © All Rights Reserved
          </Text>
        </Flex>
      </Box>
    </Box>
  )
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <Text fontSize="xs" fontWeight="600" letterSpacing="0.2em" textTransform="uppercase" color={EMBER}>
      {children}
    </Text>
  )
}

function SectionTitle({ children, size = 'md' }: { children: ReactNode; size?: 'md' | 'lg' }) {
  return (
    <Heading as="h2" mt="3" fontFamily={DISPLAY_FONT} fontWeight="700" lineHeight="1.08" letterSpacing="-0.01em" fontSize={size === 'lg' ? { base: '2.2rem', md: '3.8rem' } : { base: '2rem', md: '3.1rem' }}>
      {children}
    </Heading>
  )
}

/** A translucent navy card that is readable on top of space and the planet. */
function Card({ children }: { children: ReactNode }) {
  return (
    <Box data-reveal p="5" borderRadius="2xl" borderWidth="1px" borderColor="whiteAlpha.200" bg={`${NAVY}cc`} backdropFilter="blur(12px)">
      {children}
    </Box>
  )
}

/** One entry of the picture key in step 3: a dot (a point) or a line (a route). */
function Legend({ color, shape, label }: { color: string; shape: 'dot' | 'line'; label: string }) {
  return (
    <HStack gap="2" color="whiteAlpha.900">
      <Box w={shape === 'dot' ? '10px' : '22px'} h={shape === 'dot' ? '10px' : '4px'} borderRadius="full" bg={color} flexShrink={0} boxShadow={`0 0 8px ${color}99`} />
      <Text>{label}</Text>
    </HStack>
  )
}
