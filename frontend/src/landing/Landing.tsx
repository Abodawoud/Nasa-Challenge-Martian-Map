// The landing page of team Red Compass.
//
// Idea of the page (same concept as the team's other product pages): a dark screen with soft
// colour glows, a floating menu, a 3D planet behind the text, and a pinned story where three
// numbered steps change the 3D scene while the user scrolls.
//
// Three.js draws Mars (MarsScene.ts). GSAP ScrollTrigger moves one small state object while
// the page scrolls. Honesty rule: what is not built yet is marked "Coming next".
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Badge, Box, Button, Container, Flex, Heading, HStack, Link, SimpleGrid, Text, VStack } from '@chakra-ui/react'
import { ArrowDown, ArrowRight, Camera, Globe, Layers, MapPin, Mountain, Route } from 'lucide-react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { JEZERO, createMarsScene, facingLongitude, loadMarsTexture } from './MarsScene'
import type { SceneState } from './MarsScene'
import { CompassStar, LOGO_NAVY, LOGO_RED } from '../ui/CompassStar'

gsap.registerPlugin(ScrollTrigger)

// Team colours, taken from the Red Compass logo: bright red, deep navy and white.
const RED = LOGO_RED
const NAVY = LOGO_NAVY
/** A soft white with a little blue: the light accent on navy (the logo's white). */
const LIGHT = '#dfe6ff'
/** The page background: the logo's navy, a step darker, so the planet and the red stand out. */
const INK = '#070d22'
const DISPLAY_FONT = "'Unbounded', 'Inter', system-ui, sans-serif"

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
    text: 'Pick a start and a science goal. Compare the shortest route with a gentler one: distance, climb, slope and time.',
    Icon: Route,
    ready: false,
  },
] as const

const DATA = [
  { value: '232 m', label: 'The whole planet', text: 'Viking colour mosaic. The globe you see on this page.', Icon: Globe },
  { value: '6 m', label: 'Jezero region', text: 'CTX camera mosaic, with all photo strips aligned.', Icon: Camera },
  { value: '25 cm', label: 'Near the landing site', text: 'HiRISE, the sharpest camera in orbit around Mars.', Icon: Layers },
  { value: '3D', label: 'Real terrain', text: 'NASA Mars Trek elevation: crater walls, the delta, the hills.', Icon: Mountain },
] as const

function openMap() {
  window.location.hash = '#/map'
}

export default function Landing() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (!canvasRef.current || !rootRef.current) return
    const mars = createMarsScene(canvasRef.current, loadMarsTexture())
    const s = mars.state
    const media = gsap.matchMedia(rootRef.current)

    media.add(
      { desktop: '(min-width: 900px)', reduce: '(prefers-reduced-motion: reduce)' },
      (context) => {
        const { desktop, reduce } = context.conditions as { desktop: boolean; reduce: boolean }
        // On a wide screen the planet sits beside the text. On a phone it sits behind it, lower.
        // Low enough that the top of the planet stays under the hero buttons.
        const hero: SceneState = { x: 0, y: desktop ? -2.6 : -2.2, scale: desktop ? 2.1 : 1.5, rotY: 0, rotX: 0.25, spin: 1, marker: 0, routes: 0 }
        const whole = { x: desktop ? 1.3 : 0, y: desktop ? 0 : -1.0, scale: desktop ? 1.02 : 0.85, rotX: 0.15 }
        const jezero = { rotY: facingLongitude(JEZERO.lon), rotX: (JEZERO.lat * Math.PI) / 180, spin: 0, marker: 1, scale: desktop ? 1.75 : 1.25 }
        const walk = { scale: desktop ? 2.6 : 1.8, routes: 1, y: desktop ? -0.25 : -1.2 }
        const aside = { x: desktop ? -1.75 : 0, y: desktop ? 0.1 : -1.3, scale: desktop ? 1.2 : 0.9, routes: 0, marker: 0, spin: 1, rotX: 0.2 }
        const finale = { x: 0, y: desktop ? -2.6 : -2.2, scale: desktop ? 2.1 : 1.5, rotX: 0.25 }

        gsap.set(s, hero)
        if (reduce) return // no scroll animation: the planet stays as in the hero

        // The hero text arrives line by line.
        gsap.from('[data-hero] > *', { y: 28, opacity: 0, duration: 0.9, stagger: 0.09, ease: 'power3.out', delay: 0.15 })

        // Hero -> the planet moves to the side.
        gsap.to(s, { ...whole, ease: 'none', immediateRender: false, scrollTrigger: { trigger: '#idea', start: 'top bottom', end: 'top top', scrub: true } })

        // The pinned story: the planet turns to Jezero, then moves closer and the routes are drawn.
        const story = gsap.timeline({
          scrollTrigger: {
            trigger: '#idea',
            start: 'top top',
            end: 'bottom bottom',
            scrub: true,
            onUpdate: (self) => setStep(self.progress < 0.3 ? 0 : self.progress < 0.66 ? 1 : 2),
          },
        })
        story
          .to(s, { duration: 0.2 }) // rest on the whole planet
          .to(s, { ...jezero, duration: 0.3, ease: 'power2.inOut' })
          .to(s, { duration: 0.1 })
          .to(s, { ...walk, duration: 0.3, ease: 'power2.inOut' })
          .to(s, { duration: 0.1 })

        gsap.to(s, { ...aside, ease: 'none', immediateRender: false, scrollTrigger: { trigger: '#data', start: 'top bottom', end: 'top 25%', scrub: true } })
        gsap.to(s, { ...finale, ease: 'none', immediateRender: false, scrollTrigger: { trigger: '#go', start: 'top bottom', end: 'bottom bottom', scrub: true } })

        // Blocks rise into place when they enter the screen.
        for (const element of gsap.utils.toArray<HTMLElement>('[data-reveal]')) {
          gsap.from(element, { y: 44, opacity: 0, duration: 0.8, ease: 'power3.out', scrollTrigger: { trigger: element, start: 'top 88%' } })
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
      bg={INK}
      overflowX="clip"
      // Soft blue and red glows over deep navy, with a faint grid: the team's look.
      backgroundImage={`radial-gradient(60% 50% at 8% 55%, rgba(38,62,140,0.55), transparent 70%), radial-gradient(45% 40% at 96% 12%, rgba(232,35,31,0.24), transparent 70%), linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)`}
      backgroundSize="auto, auto, 120px 120px, 120px 120px"
      backgroundAttachment="fixed"
    >
      {/* The 3D planet, fixed behind the whole page. */}
      <canvas ref={canvasRef} aria-hidden style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }} />

      {/* Floating menu */}
      <Flex as="header" position="fixed" top="4" insetX="0" zIndex="20" justify="center" px="4">
        <Flex w="full" maxW="1120px" align="center" justify="space-between" gap="4">
          <HStack gap="2.5">
            <CompassStar size={38} />
            <Text fontFamily={DISPLAY_FONT} fontWeight="600" fontSize="sm" letterSpacing="0.02em">
              RED COMPASS
            </Text>
          </HStack>

          <HStack
            as="nav"
            aria-label="Sections"
            gap="1"
            px="2"
            py="1"
            borderRadius="full"
            borderWidth="1px"
            borderColor="whiteAlpha.200"
            bg="whiteAlpha.100"
            backdropFilter="blur(14px)"
            hideBelow="md"
          >
            {[
              ['The idea', '#idea'],
              ['The data', '#data'],
              ['The team', '#go'],
            ].map(([label, href]) => (
              <Link key={href} href={href} px="3.5" py="1.5" fontSize="sm" color="whiteAlpha.800" borderRadius="full" _hover={{ color: 'white', bg: 'whiteAlpha.200', textDecoration: 'none' }}>
                {label}
              </Link>
            ))}
          </HStack>

          <PrimaryButton onClick={openMap} size="sm">
            Open the map
            <ArrowRight size={15} aria-hidden />
          </PrimaryButton>
        </Flex>
      </Flex>

      <Box position="relative" zIndex="1">
        {/* Hero */}
        <Flex as="section" minH="100vh" direction="column" align="center" pt={{ base: '28', md: '32' }} px="5" textAlign="center">
          <VStack data-hero gap="6" maxW="900px">
            <HStack gap="2" px="3.5" py="1.5" borderRadius="full" borderWidth="1px" borderColor="whiteAlpha.200" bg="whiteAlpha.100" fontSize="xs" color="whiteAlpha.800">
              <Box boxSize="1.5" borderRadius="full" bg={RED} />
              <Text>NASA Space Apps 2026 · Interplanetary Survival Guide: Martian Map</Text>
            </HStack>
            <Heading as="h1" fontFamily={DISPLAY_FONT} fontWeight="500" lineHeight="1.05" letterSpacing="-0.02em" fontSize={{ base: '2.6rem', md: '4.4rem', lg: '5.2rem' }}>
              Find your way
              <Box as="span" display="block" color={RED}>
                on Mars.
              </Box>
            </Heading>
            <Text maxW="560px" fontSize={{ base: 'md', md: 'lg' }} color="whiteAlpha.800" lineHeight="tall">
              A map for the first walk on Mars. Real NASA images and real terrain of Jezero Crater, from the whole planet down to
              the ground under your boots.
            </Text>
            <HStack gap="3" wrap="wrap" justify="center">
              <PrimaryButton onClick={openMap} size="lg">
                Open the map
                <ArrowRight size={18} aria-hidden />
              </PrimaryButton>
              <Button asChild size="lg" variant="outline" borderRadius="full" borderColor="whiteAlpha.300" color="white" bg="whiteAlpha.50" _hover={{ bg: 'whiteAlpha.200' }}>
                <a href="#idea">
                  See the idea
                  <ArrowDown size={18} aria-hidden />
                </a>
              </Button>
            </HStack>
          </VStack>
        </Flex>

        {/* The idea: a tall section. Its inside stays on screen while the steps change. */}
        <Box as="section" id="idea" h="320vh" position="relative">
          <Flex position="sticky" top="0" h="100vh" align="center">
            <Container maxW="1120px" px="5">
              <Box maxW={{ base: 'full', md: '470px' }}>
                <Eyebrow>The idea</Eyebrow>
                <Heading as="h2" mt="3" fontFamily={DISPLAY_FONT} fontWeight="500" lineHeight="1.08" letterSpacing="-0.02em" fontSize={{ base: '2rem', md: '3.1rem' }}>
                  Three steps.
                  <br />
                  One safe walk.
                </Heading>
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
                        bg={active ? `${NAVY}cc` : 'transparent'}
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
                              <Badge size="sm" borderRadius="full" px="2" bg="whiteAlpha.200" color={LIGHT} borderWidth="1px" borderColor="whiteAlpha.400">
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

        {/* The data */}
        <Box as="section" id="data" py={{ base: '24', md: '36' }}>
          <Container maxW="1120px" px="5">
            <Box ml={{ base: '0', md: 'auto' }} maxW={{ base: 'full', md: '560px' }}>
              <Box data-reveal>
                <Eyebrow>The data</Eyebrow>
                <Heading as="h2" mt="3" fontFamily={DISPLAY_FONT} fontWeight="500" lineHeight="1.08" letterSpacing="-0.02em" fontSize={{ base: '2rem', md: '3.1rem' }}>
                  Nothing invented.
                  <br />
                  <Box as="span" color={RED}>
                    All from NASA.
                  </Box>
                </Heading>
                <Text mt="5" color="whiteAlpha.800" lineHeight="tall">
                  Every image and every hill on the map comes from a NASA mission, loaded live from NASA services. The closer you
                  get, the sharper the source.
                </Text>
              </Box>
              <SimpleGrid mt="8" columns={{ base: 1, sm: 2 }} gap="3">
                {DATA.map(({ value, label, text, Icon }) => (
                  <Box key={label} data-reveal p="5" borderRadius="2xl" borderWidth="1px" borderColor="whiteAlpha.200" bg={`${NAVY}b3`} backdropFilter="blur(12px)">
                    <HStack justify="space-between" align="start">
                      <Text fontFamily={DISPLAY_FONT} fontSize="2xl" fontWeight="500">
                        {value}
                      </Text>
                      <Icon size={18} aria-hidden color={LIGHT} />
                    </HStack>
                    <Text mt="2" fontWeight="600" fontSize="sm">
                      {label}
                    </Text>
                    <Text mt="1" fontSize="sm" color="whiteAlpha.700" lineHeight="tall">
                      {text}
                    </Text>
                  </Box>
                ))}
              </SimpleGrid>
            </Box>
          </Container>
        </Box>

        {/* Closing call + team */}
        <Flex as="section" id="go" minH="100vh" direction="column" align="center" pt={{ base: '24', md: '32' }} px="5" textAlign="center">
          <VStack data-reveal gap="6" maxW="760px">
            <Eyebrow>Team Red Compass</Eyebrow>
            <Heading as="h2" fontFamily={DISPLAY_FONT} fontWeight="500" lineHeight="1.06" letterSpacing="-0.02em" fontSize={{ base: '2.2rem', md: '3.8rem' }}>
              The planet is ready.
              <Box as="span" display="block" color={RED}>
                Take a look.
              </Box>
            </Heading>
            <Text maxW="520px" color="whiteAlpha.800" lineHeight="tall">
              The map is open now: fly to Jezero, switch between 2D and 3D, and go down to the surface. Route planning is the
              next step we are building.
            </Text>
            <PrimaryButton onClick={openMap} size="lg">
              Open the map
              <ArrowRight size={18} aria-hidden />
            </PrimaryButton>
          </VStack>
          <Text mt="auto" pb="6" pt="16" fontSize="xs" color="whiteAlpha.500">
            Images and terrain: NASA/JPL-Caltech Mars Trek · USGS Astrogeology · Built for NASA Space Apps Challenge 2026
          </Text>
        </Flex>
      </Box>
    </Box>
  )
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <Text fontSize="xs" fontWeight="600" letterSpacing="0.16em" textTransform="uppercase" color="whiteAlpha.700">
      {children}
    </Text>
  )
}

/** The red call-to-action button of the page. */
function PrimaryButton({ children, onClick, size }: { children: ReactNode; onClick: () => void; size: 'sm' | 'lg' }) {
  return (
    <Button
      onClick={onClick}
      size={size}
      borderRadius="full"
      color="white"
      bg={RED}
      boxShadow={`0 8px 28px ${RED}55`}
      _hover={{ bg: '#c91b17', transform: 'translateY(-1px)' }}
      _active={{ transform: 'translateY(0)' }}
      transition="all 0.2s ease"
    >
      {children}
    </Button>
  )
}
