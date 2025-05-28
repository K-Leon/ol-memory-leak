import React, { useEffect, useRef, useState } from 'react'
import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import VectorLayer from 'ol/layer/Vector'
import Map from 'ol/Map'
import { fromLonLat } from 'ol/proj'
import VectorSource from 'ol/source/Vector'
import { Style, Circle, Fill } from 'ol/style'
import View from 'ol/View'
import styled from 'styled-components'

// Mount counter for debugging
let mountCounter = 0

// Single style for all features
const featureStyle = new Style({
  image: new Circle({
    radius: 4,
    fill: new Fill({ color: '#999999' }),
  }),
})

// Generate test features
const generateFeatures = (count: number = 10000) => {
  const features: Feature<Point>[] = []
  for (let i = 0; i < count; i++) {
    const lon = 5.98 + Math.random() * 9.03
    const lat = 47.30 + Math.random() * 7.68
    const feature = new Feature({
      geometry: new Point(fromLonLat([lon, lat])),
    })
    feature.setId(i)
    feature.setStyle(featureStyle)
    features.push(feature)
  }
  return features
}

const MinimalBugRepro: React.FC = () => {
  const mapRef = useRef<HTMLDivElement>(null)
  const [showMap, setShowMap] = useState(true)
  const [hitCount, setHitCount] = useState(0)
  const [enableHitDetection, setEnableHitDetection] = useState(true)

  useEffect(() => {
    if (!showMap || !mapRef.current) return

    mountCounter++
    const currentMount = mountCounter
    console.log(`🟢 Mount #${currentMount}`)

    // Create features, source, and layer
    const features = generateFeatures()
    const vectorSource = new VectorSource({ features })
    const vectorLayer = new VectorLayer({ source: vectorSource })

    // Create map
    const map = new Map({
      target: mapRef.current,
      layers: [vectorLayer],
      view: new View({
        center: fromLonLat([10.5, 51.1]),
        zoom: 6,
      }),
    })

    // The problematic handler - THIS CAUSES THE MEMORY LEAK
    const handlePointerMove = (e: any) => {
      if (!enableHitDetection) return // Skip if disabled

      const feature = map.forEachFeatureAtPixel(
        e.pixel,
        (f) => f,
        {
          hitTolerance: 0,
          checkWrapped: false,
        }
      )

      if (feature) {
        setHitCount(prev => prev + 1)
        console.log(`Hit feature on mount #${currentMount}`)
      }
    }

    map.on('pointermove', handlePointerMove)

    // Cleanup
    return () => {
      console.log(`🔴 Unmount #${currentMount}`)

      // Remove event listener
      map.un('pointermove', handlePointerMove)

    }
  }, [showMap, enableHitDetection])

  return (
    <Container>
      <Controls>
        <CheckboxWrapper>
          <input
            type="checkbox"
            id="hit-detection"
            checked={enableHitDetection}
            onChange={(e) => setEnableHitDetection(e.target.checked)}
          />
          <label htmlFor="hit-detection">Enable forEachFeatureAtPixel</label>
        </CheckboxWrapper>

        <Button onClick={() => setShowMap(!showMap)}>
          {showMap ? '🛑 Unmount' : '▶️ Mount'} Map
        </Button>
        <Info>
          <div>Mount #{mountCounter}</div>
          <div>Hits: {hitCount}</div>
          <StatusIndicator $enabled={enableHitDetection}>
            Hit Detection: {enableHitDetection ? '✅ ON' : '❌ OFF'}
          </StatusIndicator>
          <Instructions>
            <strong>Steps to reproduce Chrome freeze:</strong><br />
            1. Ensure checkbox is ON<br />
            2. Move mouse over features (gray dots)<br />
            3. Click Unmount<br />
            4. Click Mount<br />
            5. Repeat steps 2-4 about 3-4 times<br />
            6. Chrome will freeze/lag severely<br />
            <br />
            With checkbox OFF, no freeze occurs!<br />
            This proves forEachFeatureAtPixel causes the leak.
          </Instructions>
        </Info>
      </Controls>
      {showMap && <MapDiv ref={mapRef} />}
    </Container>
  )
}

const Container = styled.div`
  position: absolute;
  inset: 0;
  background: #f5f5f5;
`

const MapDiv = styled.div`
  width: 100%;
  height: 100%;
`

const Controls = styled.div`
  position: absolute;
  top: 20px;
  right: 20px;
  z-index: 1000;
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 300px;
`

const CheckboxWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 4px;
  
  input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
    margin: 0;
  }
  
  label {
    cursor: pointer;
    font-weight: 500;
    user-select: none;
  }
`

const StatusIndicator = styled.div<{ $enabled: boolean }>`
  padding: 8px;
  background: ${props => props.$enabled ? '#d4edda' : '#f8d7da'};
  color: ${props => props.$enabled ? '#155724' : '#721c24'};
  border-radius: 4px;
  font-weight: bold;
  text-align: center;
`

const Button = styled.button`
  padding: 12px 24px;
  font-size: 16px;
  font-weight: bold;
  background: #dc3545;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
  
  &:hover {
    background: #c82333;
  }
`

const Info = styled.div`
  font-family: monospace;
  font-size: 14px;
  
  > div {
    margin: 4px 0;
  }
`

const Instructions = styled.div`
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #ddd;
  font-family: sans-serif;
  font-size: 13px;
  line-height: 1.6;
  color: #666;
  
  strong {
    color: #333;
  }
`

export default MinimalBugRepro