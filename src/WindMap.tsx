import React, { useEffect, useRef, useState } from 'react'
import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import LineString from 'ol/geom/LineString'
import Geometry from 'ol/geom/Geometry'
import VectorLayer from 'ol/layer/Vector'
import Map from 'ol/Map'
import { fromLonLat } from 'ol/proj'
import VectorSource from 'ol/source/Vector'
import { Style, Circle, Fill, Stroke } from 'ol/style'
import View from 'ol/View'
import styled from 'styled-components'

// Import the SpatialFeatureDetector (in real app, this would be from a separate file)
import { SpatialFeatureDetector } from './SpatialFeatureDetector'

// Mount counter for debugging
let mountCounter = 0

// Performance tracking
interface BenchmarkResults {
  avgDetectionTime: number
  maxDetectionTime: number
  minDetectionTime: number
  totalHits: number
  samples: number
}

// Style for normal points
const normalPointStyle = new Style({
  image: new Circle({
    radius: 4,
    fill: new Fill({ color: '#999999' }),
  }),
})

// Style for highlighted points
const highlightPointStyle = new Style({
  image: new Circle({
    radius: 6,
    fill: new Fill({ color: '#ff6b6b' }),
  }),
})

// Style for normal lines
const normalLineStyle = new Style({
  stroke: new Stroke({
    color: '#666666',
    width: 2,
  }),
})

// Style for highlighted lines
const highlightLineStyle = new Style({
  stroke: new Stroke({
    color: '#ff6b6b',
    width: 4,
  }),
})

type GeometryType = 'points' | 'lines' | 'mixed'
type DetectionMethod = 'canvas' | 'spatial' | 'spatialDebounced'

// Generate test point features
const generatePointFeatures = (count: number = 5000) => {
  const features: Feature<Point>[] = []
  for (let i = 0; i < count; i++) {
    const lon = 5.98 + Math.random() * 9.03
    const lat = 47.30 + Math.random() * 7.68
    const feature = new Feature({
      geometry: new Point(fromLonLat([lon, lat])),
    })
    feature.setId(`point-${i}`)
    feature.setStyle(normalPointStyle)
    feature.set('featureType', 'point')
    features.push(feature)
  }
  return features
}

// Generate test line features
const generateLineFeatures = (count: number = 1000) => {
  const features: Feature<LineString>[] = []
  for (let i = 0; i < count; i++) {
    const startLon = 5.98 + Math.random() * 9.03
    const startLat = 47.30 + Math.random() * 7.68
    const endLon = startLon + (Math.random() - 0.5) * 0.5
    const endLat = startLat + (Math.random() - 0.5) * 0.5

    // Create a line with 2-50 points (some longer lines to test segmentation)
    const pointCount = 2 + Math.floor(Math.random() * 49)
    const coordinates: number[][] = []

    for (let j = 0; j < pointCount; j++) {
      const t = j / (pointCount - 1)
      const lon = startLon + t * (endLon - startLon) + (Math.random() - 0.5) * 0.1
      const lat = startLat + t * (endLat - startLat) + (Math.random() - 0.5) * 0.1
      coordinates.push(fromLonLat([lon, lat]))
    }

    const feature = new Feature({
      geometry: new LineString(coordinates),
    })
    feature.setId(`line-${i}`)
    feature.setStyle(normalLineStyle)
    feature.set('featureType', 'line')
    features.push(feature)
  }
  return features
}

const SpatialDetectorTester: React.FC = () => {
  const mapRef = useRef<HTMLDivElement>(null)
  const [showMap, setShowMap] = useState(true)
  const [hitCount, setHitCount] = useState(0)
  const [enableHitDetection, setEnableHitDetection] = useState(true)
  const [enableHighlight, setEnableHighlight] = useState(true)
  const [enableBenchmarking, setEnableBenchmarking] = useState(false)
  const [detectionMethod, setDetectionMethod] = useState<DetectionMethod>('spatial')
  const [geometryType, setGeometryType] = useState<GeometryType>('mixed')
  const [lastDetectionTime, setLastDetectionTime] = useState<number>(0)
  const [lastDetectedType, setLastDetectedType] = useState<string>('')
  const [debounceDelay, setDebounceDelay] = useState<number>(50)
  const [benchmarkResults, setBenchmarkResults] = useState<Record<DetectionMethod, BenchmarkResults>>({
    canvas: { avgDetectionTime: 0, maxDetectionTime: 0, minDetectionTime: 0, totalHits: 0, samples: 0 },
    spatial: { avgDetectionTime: 0, maxDetectionTime: 0, minDetectionTime: 0, totalHits: 0, samples: 0 },
    spatialDebounced: { avgDetectionTime: 0, maxDetectionTime: 0, minDetectionTime: 0, totalHits: 0, samples: 0 },
  })

  const lastHighlightedFeatureRef = useRef<Feature<Geometry> | null>(null)
  const detectorRef = useRef<SpatialFeatureDetector | null>(null)
  const performanceMetricsRef = useRef<number[]>([])

  // Calculate benchmark results
  const updateBenchmarkResults = (method: DetectionMethod) => {
    const times = performanceMetricsRef.current
    if (times.length === 0) return

    const results: BenchmarkResults = {
      avgDetectionTime: times.reduce((a, b) => a + b, 0) / times.length,
      maxDetectionTime: Math.max(...times),
      minDetectionTime: Math.min(...times),
      totalHits: times.length,
      samples: times.length
    }

    setBenchmarkResults(prev => ({
      ...prev,
      [method]: results
    }))
  }

  useEffect(() => {
    if (!showMap || !mapRef.current) return

    mountCounter++
    const currentMount = mountCounter
    console.log(`🟢 Mount #${currentMount} with ${detectionMethod} detection, geometry: ${geometryType}`)

    // Reset performance metrics for new mount
    performanceMetricsRef.current = []

    // Create features based on geometry type
    let features: Feature<Geometry>[] = []
    if (geometryType === 'points') {
      features = generatePointFeatures(10000)
    } else if (geometryType === 'lines') {
      features = generateLineFeatures(2000)
    } else {
      features = [
        ...generatePointFeatures(5000),
        ...generateLineFeatures(1000)
      ]
    }

    const vectorSource = new VectorSource({ features })

    // Create layer
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

    // Initialize spatial detector for non-canvas methods
    if (detectionMethod !== 'canvas') {
      console.time('Building Spatial Index')
      detectorRef.current = new SpatialFeatureDetector(features)
      console.timeEnd('Building Spatial Index')
    }

    // Helper function to handle feature highlighting
    const handleFeatureDetection = (detectedFeature: Feature<Geometry> | undefined, detectionTime: number) => {
      setLastDetectionTime(detectionTime)

      if (enableBenchmarking && detectionTime > 0) {
        performanceMetricsRef.current.push(detectionTime)
        if (performanceMetricsRef.current.length % 100 === 0) {
          updateBenchmarkResults(detectionMethod)
        }
      }

      if (detectedFeature) {
        setHitCount(prev => prev + 1)
        const featureType = detectedFeature.get('featureType') || 'unknown'
        setLastDetectedType(featureType)

        if (enableHighlight) {
          // Reset previous highlighted feature
          if (lastHighlightedFeatureRef.current && lastHighlightedFeatureRef.current !== detectedFeature) {
            const prevType = lastHighlightedFeatureRef.current.get('featureType')
            if (prevType === 'point') {
              lastHighlightedFeatureRef.current.setStyle(normalPointStyle)
            } else if (prevType === 'line') {
              lastHighlightedFeatureRef.current.setStyle(normalLineStyle)
            }
          }

          // Highlight current feature
          if (featureType === 'point') {
            detectedFeature.setStyle(highlightPointStyle)
          } else if (featureType === 'line') {
            detectedFeature.setStyle(highlightLineStyle)
          }
          lastHighlightedFeatureRef.current = detectedFeature
        }
      } else {
        // No feature under cursor - reset highlight
        if (enableHighlight && lastHighlightedFeatureRef.current) {
          const prevType = lastHighlightedFeatureRef.current.get('featureType')
          if (prevType === 'point') {
            lastHighlightedFeatureRef.current.setStyle(normalPointStyle)
          } else if (prevType === 'line') {
            lastHighlightedFeatureRef.current.setStyle(normalLineStyle)
          }
          lastHighlightedFeatureRef.current = null
        }
        setLastDetectedType('')
      }
    }

    // Feature detection handler
    const handlePointerMove = (e: any) => {
      if (!enableHitDetection) return

      const startTime = performance.now()

      switch (detectionMethod) {
        case 'canvas':
          // Original problematic method
          const canvasFeature = map.forEachFeatureAtPixel(
            e.pixel,
            (f) => f,
            {
              hitTolerance: 5,
              checkWrapped: false,
            }
          ) as Feature<Geometry> | undefined

          const canvasTime = performance.now() - startTime
          handleFeatureDetection(canvasFeature, canvasTime)
          break

        case 'spatial':
          // Spatial index method - immediate
          if (detectorRef.current) {
            const spatialFeature = detectorRef.current.getFeatureAtPixel(map, e.pixel, {
              hitTolerance: 5
            })

            const spatialTime = performance.now() - startTime
            handleFeatureDetection(spatialFeature, spatialTime)
          }
          break

        case 'spatialDebounced':
          // Spatial index method - debounced
          if (detectorRef.current) {
            // For benchmarking debounced method, we still track the detection time
            const debounceStartTime = performance.now()

            detectorRef.current.getFeatureAtPixelDebounced(
              map,
              e.pixel,
              (feature) => {
                const debounceTime = performance.now() - debounceStartTime
                handleFeatureDetection(feature, debounceTime)
              },
              {
                hitTolerance: 5,
                debounceDelay: debounceDelay,
                debounceKey: 'hover'
              }
            )
          }
          break
      }
    }

    map.on('pointermove', handlePointerMove)

    // Update source when features change
    vectorSource.on('change', () => {
      if (detectorRef.current && detectionMethod !== 'canvas') {
        detectorRef.current.updateFeatures(vectorSource.getFeatures())
      }
    })

    // Cleanup
    return () => {
      console.log(`🔴 Unmount #${currentMount}`)

      // Final benchmark update
      if (enableBenchmarking && performanceMetricsRef.current.length > 0) {
        updateBenchmarkResults(detectionMethod)
      }

      // Clear debounce timers
      if (detectorRef.current) {
        detectorRef.current.clearDebounceTimers()
      }

      // Reset any highlighted feature
      if (lastHighlightedFeatureRef.current) {
        const prevType = lastHighlightedFeatureRef.current.get('featureType')
        if (prevType === 'point') {
          lastHighlightedFeatureRef.current.setStyle(normalPointStyle)
        } else if (prevType === 'line') {
          lastHighlightedFeatureRef.current.setStyle(normalLineStyle)
        }
        lastHighlightedFeatureRef.current = null
      }

      // Remove event listener
      map.un('pointermove', handlePointerMove)

      // Dispose of map
      map.setTarget(undefined)
      map.dispose()
      detectorRef.current = null
    }
  }, [showMap, enableHitDetection, enableHighlight, detectionMethod, enableBenchmarking, geometryType, debounceDelay])

  const resetBenchmarks = () => {
    performanceMetricsRef.current = []
    setBenchmarkResults({
      canvas: { avgDetectionTime: 0, maxDetectionTime: 0, minDetectionTime: 0, totalHits: 0, samples: 0 },
      spatial: { avgDetectionTime: 0, maxDetectionTime: 0, minDetectionTime: 0, totalHits: 0, samples: 0 },
      spatialDebounced: { avgDetectionTime: 0, maxDetectionTime: 0, minDetectionTime: 0, totalHits: 0, samples: 0 },
    })
  }

  return (
    <Container>
      <Controls>
        <Section>
          <SectionTitle>Geometry Type</SectionTitle>
          <RadioGroup>
            <RadioWrapper>
              <input
                type="radio"
                id="points"
                name="geometry"
                value="points"
                checked={geometryType === 'points'}
                onChange={(e) => setGeometryType(e.target.value as GeometryType)}
              />
              <label htmlFor="points">
                Points Only
                <MethodDescription>10,000 point features</MethodDescription>
              </label>
            </RadioWrapper>
            <RadioWrapper>
              <input
                type="radio"
                id="lines"
                name="geometry"
                value="lines"
                checked={geometryType === 'lines'}
                onChange={(e) => setGeometryType(e.target.value as GeometryType)}
              />
              <label htmlFor="lines">
                Lines Only
                <MethodDescription>2,000 line features (with long lines)</MethodDescription>
              </label>
            </RadioWrapper>
            <RadioWrapper>
              <input
                type="radio"
                id="mixed"
                name="geometry"
                value="mixed"
                checked={geometryType === 'mixed'}
                onChange={(e) => setGeometryType(e.target.value as GeometryType)}
              />
              <label htmlFor="mixed">
                Mixed Geometries
                <MethodDescription>5,000 points + 1,000 lines</MethodDescription>
              </label>
            </RadioWrapper>
          </RadioGroup>
        </Section>

        <Section>
          <SectionTitle>Detection Method</SectionTitle>
          <RadioGroup>
            <RadioWrapper $isProblematic={true}>
              <input
                type="radio"
                id="canvas"
                name="detection"
                value="canvas"
                checked={detectionMethod === 'canvas'}
                onChange={(e) => setDetectionMethod(e.target.value as DetectionMethod)}
              />
              <label htmlFor="canvas">
                Canvas (forEachFeatureAtPixel)
                <MethodDescription>⚠️ Original method - causes memory leak</MethodDescription>
              </label>
            </RadioWrapper>
            <RadioWrapper $isRecommended={true}>
              <input
                type="radio"
                id="spatial"
                name="detection"
                value="spatial"
                checked={detectionMethod === 'spatial'}
                onChange={(e) => setDetectionMethod(e.target.value as DetectionMethod)}
              />
              <label htmlFor="spatial">
                Spatial Index
                <MethodDescription>✅ Optimized, O(log n), no memory leaks</MethodDescription>
              </label>
            </RadioWrapper>
            <RadioWrapper $isRecommended={true}>
              <input
                type="radio"
                id="spatialDebounced"
                name="detection"
                value="spatialDebounced"
                checked={detectionMethod === 'spatialDebounced'}
                onChange={(e) => setDetectionMethod(e.target.value as DetectionMethod)}
              />
              <label htmlFor="spatialDebounced">
                Spatial Index + Debounce
                <MethodDescription>✅ Best for production (reduces calls)</MethodDescription>
              </label>
            </RadioWrapper>
          </RadioGroup>
        </Section>

        {detectionMethod === 'spatialDebounced' && (
          <Section>
            <SectionTitle>Debounce Settings</SectionTitle>
            <DebounceControl>
              <label htmlFor="debounce-delay">Debounce delay: {debounceDelay}ms</label>
              <input
                type="range"
                id="debounce-delay"
                min="0"
                max="200"
                step="10"
                value={debounceDelay}
                onChange={(e) => setDebounceDelay(Number(e.target.value))}
              />
            </DebounceControl>
          </Section>
        )}

        <Section>
          <SectionTitle>Options</SectionTitle>
          <CheckboxWrapper>
            <input
              type="checkbox"
              id="hit-detection"
              checked={enableHitDetection}
              onChange={(e) => setEnableHitDetection(e.target.checked)}
            />
            <label htmlFor="hit-detection">Enable Hit Detection</label>
          </CheckboxWrapper>

          <CheckboxWrapper $disabled={!enableHitDetection}>
            <input
              type="checkbox"
              id="highlight"
              checked={enableHighlight}
              onChange={(e) => setEnableHighlight(e.target.checked)}
              disabled={!enableHitDetection}
            />
            <label htmlFor="highlight">Enable Feature Highlight</label>
          </CheckboxWrapper>

          <CheckboxWrapper>
            <input
              type="checkbox"
              id="benchmarking"
              checked={enableBenchmarking}
              onChange={(e) => setEnableBenchmarking(e.target.checked)}
            />
            <label htmlFor="benchmarking">Enable Benchmarking</label>
          </CheckboxWrapper>
        </Section>

        <Button onClick={() => setShowMap(!showMap)}>
          {showMap ? '🛑 Unmount' : '▶️ Mount'} Map
        </Button>

        <Info>
          <div>Mount #{mountCounter}</div>
          <div>Hits: {hitCount}</div>
          <div>Last detection: {lastDetectionTime.toFixed(2)}ms</div>
          {lastDetectedType && <div>Last type: {lastDetectedType}</div>}
          <StatusIndicator $enabled={enableHitDetection}>
            Hit Detection: {enableHitDetection ? '✅ ON' : '❌ OFF'}
          </StatusIndicator>
          <CurrentMethod $isProblematic={detectionMethod === 'canvas'}>
            Current: <strong>{detectionMethod}</strong>
          </CurrentMethod>
        </Info>

        {enableBenchmarking && (
          <BenchmarkSection>
            <SectionTitle>
              Benchmark Results
              <ResetButton onClick={resetBenchmarks}>Reset</ResetButton>
            </SectionTitle>
            <BenchmarkTable>
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Avg (ms)</th>
                  <th>Max (ms)</th>
                  <th>Min (ms)</th>
                  <th>Samples</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(benchmarkResults) as DetectionMethod[]).map(method => {
                  const result = benchmarkResults[method]
                  return (
                    <tr key={method} className={method === detectionMethod ? 'active' : ''}>
                      <td>{method}</td>
                      <td>{result.avgDetectionTime.toFixed(3)}</td>
                      <td>{result.maxDetectionTime.toFixed(3)}</td>
                      <td>{result.minDetectionTime.toFixed(3)}</td>
                      <td>{result.samples}</td>
                    </tr>
                  )
                })}
              </tbody>
            </BenchmarkTable>
            <BenchmarkNote>
              Move mouse continuously over features to collect performance data.
              Debounced method will show slightly higher times due to the delay.
            </BenchmarkNote>
          </BenchmarkSection>
        )}

        <Instructions>
          <strong>Production-Ready Spatial Feature Detector:</strong><br />
          <br />
          • <strong>Canvas:</strong> Fast but causes memory leaks on remount<br />
          • <strong>Spatial Index:</strong> Fast O(log n) detection, no memory leaks<br />
          • <strong>Debounced:</strong> Best for production - reduces CPU usage<br />
          <br />
          <strong>Key Features:</strong><br />
          • Automatic line segmentation for high zoom detection<br />
          • Works with all geometry types<br />
          • Simple drop-in replacement for forEachFeatureAtPixel<br />
          • Memory safe with proper cleanup<br />
        </Instructions>
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
  max-width: 420px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
`

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SectionTitle = styled.h3`
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #333;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  justify-content: space-between;
  align-items: center;
`

const RadioGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const RadioWrapper = styled.div<{ $isProblematic?: boolean; $isRecommended?: boolean }>`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  background: ${props =>
    props.$isProblematic ? '#fee' :
      props.$isRecommended ? '#e6f7e6' :
        '#f8f9fa'
  };
  border-radius: 4px;
  transition: background 0.2s;
  border: 1px solid ${props =>
    props.$isProblematic ? '#fcc' :
      props.$isRecommended ? '#b8e6b8' :
        'transparent'
  };
  
  &:hover {
    background: ${props =>
    props.$isProblematic ? '#fdd' :
      props.$isRecommended ? '#d4f0d4' :
        '#e9ecef'
  };
  }
  
  input[type="radio"] {
    margin-top: 2px;
    cursor: pointer;
  }
  
  label {
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
`

const MethodDescription = styled.span`
  font-size: 12px;
  font-weight: normal;
  color: #666;
`

const DebounceControl = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 4px;
  
  label {
    font-size: 14px;
    font-weight: 500;
  }
  
  input[type="range"] {
    width: 100%;
  }
`

const CheckboxWrapper = styled.div<{ $disabled?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 4px;
  opacity: ${props => props.$disabled ? 0.6 : 1};
  
  input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: ${props => props.$disabled ? 'not-allowed' : 'pointer'};
    margin: 0;
  }
  
  label {
    cursor: ${props => props.$disabled ? 'not-allowed' : 'pointer'};
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
  font-size: 13px;
`

const CurrentMethod = styled.div<{ $isProblematic?: boolean }>`
  padding: 8px;
  background: ${props => props.$isProblematic ? '#fff3cd' : '#e7f3ff'};
  color: ${props => props.$isProblematic ? '#856404' : '#004085'};
  border-radius: 4px;
  text-align: center;
  font-size: 13px;
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

const ResetButton = styled.button`
  padding: 4px 8px;
  font-size: 12px;
  font-weight: normal;
  background: #6c757d;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  
  &:hover {
    background: #5a6268;
  }
`

const Info = styled.div`
  font-family: monospace;
  font-size: 14px;
  
  > div {
    margin: 4px 0;
  }
`

const BenchmarkSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 4px;
`

const BenchmarkTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  
  th, td {
    padding: 6px 8px;
    text-align: left;
    border-bottom: 1px solid #dee2e6;
  }
  
  th {
    font-weight: 600;
    background: #e9ecef;
  }
  
  tr.active {
    background: #e7f3ff;
    font-weight: 500;
  }
  
  tbody tr:hover {
    background: #f8f9fa;
  }
`

const BenchmarkNote = styled.div`
  font-size: 11px;
  color: #666;
  font-style: italic;
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

export default SpatialDetectorTester