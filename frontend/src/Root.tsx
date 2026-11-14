// Two screens, chosen by the address:
//   /        the landing page (team Red Compass, the idea)
//   /#/map   the map
// Each screen is loaded only when it is opened: the landing page does not download the map
// engine (Cesium, about 4 MB), and the map does not download the landing page's 3D code.
import { Suspense, lazy, useEffect, useState } from 'react'
import { Center, Spinner } from '@chakra-ui/react'

const Landing = lazy(() => import('./landing/Landing'))
const MapApp = lazy(() => import('./App'))

const isMap = () => window.location.hash.startsWith('#/map')

export default function Root() {
  const [map, setMap] = useState(isMap)

  useEffect(() => {
    const onHashChange = () => {
      setMap(isMap())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return (
    <Suspense
      fallback={
        <Center h="100vh" bg="#05070f">
          <Spinner color="white" size="lg" />
        </Center>
      }
    >
      {map ? <MapApp /> : <Landing />}
    </Suspense>
  )
}
