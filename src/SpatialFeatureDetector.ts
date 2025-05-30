import RBush from 'rbush';
import { Feature } from 'ol';
import { Geometry, Point, LineString, Polygon } from 'ol/geom';

interface IndexItem {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    feature: Feature<Geometry>;
    segmentIndex?: number; // For line segments
    segmentStart?: number[]; // Store segment endpoints for accurate distance calc
    segmentEnd?: number[];
}

/**
 * Production-ready spatial index for efficient feature detection in OpenLayers
 * Avoids memory leaks from canvas-based hit detection
 * Now powered by RBush for better performance
 */
export class SpatialFeatureDetector {
    private tree: RBush<IndexItem>;
    private features: Feature<Geometry>[] = [];
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

    /**
     * Initialize the detector with features
     * @param features Array of OpenLayers features to index
     */
    constructor(features: Feature<Geometry>[] = []) {
        this.tree = new RBush<IndexItem>();
        if (features.length > 0) {
            this.updateFeatures(features);
        }
    }

    /**
     * Update the spatial index with new features
     * @param features Array of OpenLayers features to index
     */
    updateFeatures(features: Feature<Geometry>[]): void {
        this.features = features;
        this.tree.clear();

        const items: IndexItem[] = [];

        for (const feature of features) {
            const geometry = feature.getGeometry();
            if (!geometry) {
                throw new Error('Feature has no geometry');
            }

            // For LineStrings, create multiple index entries for better hit detection at high zoom
            if (geometry instanceof LineString) {
                items.push(...this.indexLineString(feature, geometry));
            } else if (geometry instanceof Polygon) {
                items.push(...this.indexPolygon(feature, geometry));
            } else {
                // For other geometries, use the full extent
                const extent = geometry.getExtent();
                items.push({
                    feature,
                    minX: extent[0],
                    minY: extent[1],
                    maxX: extent[2],
                    maxY: extent[3]
                });
            }
        }

        // Bulk insert for better performance
        this.tree.load(items);
    }

    /**
     * Index a LineString by breaking it into segments for better detection at high zoom
     */
    private indexLineString(feature: Feature<Geometry>, lineString: LineString): IndexItem[] {
        const coords = lineString.getCoordinates();
        const items: IndexItem[] = [];

        // If the line is very short, just use its extent
        if (coords.length <= 2) {
            const extent = lineString.getExtent();
            items.push({
                feature,
                minX: extent[0],
                minY: extent[1],
                maxX: extent[2],
                maxY: extent[3]
            });
            return items;
        }

        // Index each segment individually for precise hit detection
        for (let i = 0; i < coords.length - 1; i++) {
            const [x1, y1] = coords[i];
            const [x2, y2] = coords[i + 1];

            const minX = Math.min(x1, x2);
            const maxX = Math.max(x1, x2);
            const minY = Math.min(y1, y2);
            const maxY = Math.max(y1, y2);

            // Add small padding to ensure we don't miss thin lines
            const padding = Math.max((maxX - minX) * 0.1, (maxY - minY) * 0.1, 0.0001);

            items.push({
                minX: minX - padding,
                minY: minY - padding,
                maxX: maxX + padding,
                maxY: maxY + padding,
                feature,
                segmentIndex: i,
                segmentStart: coords[i],
                segmentEnd: coords[i + 1]
            });
        }

        // Also add the full extent for fast rejection at low zoom levels
        const extent = lineString.getExtent();
        items.push({
            feature,
            minX: extent[0],
            minY: extent[1],
            maxX: extent[2],
            maxY: extent[3]
        });

        return items;
    }

    /**
     * Index a Polygon by indexing its rings
     */
    private indexPolygon(feature: Feature<Geometry>, polygon: Polygon): IndexItem[] {
        const items: IndexItem[] = [];

        // Index the exterior ring
        const exteriorRing = polygon.getLinearRing(0);
        if (exteriorRing) {
            const ringItems = this.indexLineString(feature, exteriorRing);
            items.push(...ringItems);
        }

        // Also add the full polygon extent for point-in-polygon tests
        const extent = polygon.getExtent();
        items.push({
            feature,
            minX: extent[0],
            minY: extent[1],
            maxX: extent[2],
            maxY: extent[3]
        });

        return items;
    }

    /**
     * Detect features at a given pixel on the map
     * @param map OpenLayers Map instance
     * @param pixel Pixel coordinates [x, y]
     * @param options Detection options
     * @returns Array of detected features, sorted by distance
     */
    detectFeaturesAtPixel(
        map: Map,
        pixel: number[],
        options: {
            hitTolerance?: number;
            layerFilter?: (layer: any) => boolean;
        } = {}
    ): Feature<Geometry>[] {
        const coordinate = map.getCoordinateFromPixel(pixel);
        const resolution = map.getView().getResolution();
        const tolerance = (options.hitTolerance || 0) * resolution;

        return this.detectFeaturesAtCoordinate(coordinate, tolerance);
    }

    /**
     * Detect features at pixel with debouncing
     * @param map OpenLayers Map instance
     * @param pixel Pixel coordinates [x, y]
     * @param callback Callback function to execute with detected features
     * @param options Detection options including debounce delay
     */
    detectFeaturesAtPixelDebounced(
        map: Map,
        pixel: number[],
        callback: (features: Feature<Geometry>[]) => void,
        options: {
            hitTolerance?: number;
            debounceDelay?: number;
            debounceKey?: string;
        } = {}
    ): void {
        const key = options.debounceKey || 'default';
        const delay = options.debounceDelay ?? 50;

        // Clear existing timer
        const existingTimer = this.debounceTimers.get(key);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Set new timer
        const timer = setTimeout(() => {
            const features = this.detectFeaturesAtPixel(map, pixel, options);
            callback(features);
            this.debounceTimers.delete(key);
        }, delay);

        this.debounceTimers.set(key, timer);
    }

    /**
     * Detect features at a given coordinate
     * @param coordinate Map coordinates [x, y]
     * @param tolerance Detection tolerance in map units
     * @returns Array of detected features, sorted by distance
     */
    detectFeaturesAtCoordinate(
        coordinate: number[],
        tolerance: number
    ): Feature<Geometry>[] {
        const [x, y] = coordinate;

        // Search the R-tree for candidates
        const candidates = this.tree.search({
            minX: x - tolerance,
            minY: y - tolerance,
            maxX: x + tolerance,
            maxY: y + tolerance
        });

        // Remove duplicates and calculate exact distances
        const seen = new Set<Feature<Geometry>>();
        const hits: Array<{ feature: Feature<Geometry>; distance: number }> = [];

        for (const candidate of candidates) {
            // Skip if we've already processed this feature
            if (seen.has(candidate.feature)) continue;

            // Calculate distance based on the indexed item type
            let distance: number;

            if (candidate.segmentStart && candidate.segmentEnd) {
                // This is a line segment - calculate precise distance
                distance = this.getDistanceToSegment(
                    coordinate,
                    candidate.segmentStart,
                    candidate.segmentEnd
                );
            } else {
                // Full feature - calculate distance to the entire geometry
                distance = this.getDistanceToFeature(coordinate, candidate.feature);
            }

            if (distance <= tolerance) {
                // Only add the feature once (first hit is usually the closest)
                if (!seen.has(candidate.feature)) {
                    seen.add(candidate.feature);
                    hits.push({ feature: candidate.feature, distance });
                }
            }
        }

        // Sort by distance and return features only
        return hits
            .sort((a, b) => a.distance - b.distance)
            .map(hit => hit.feature);
    }

    /**
     * Get the first feature at pixel (most commonly used)
     * @param map OpenLayers Map instance
     * @param pixel Pixel coordinates [x, y]
     * @param options Detection options
     * @returns First detected feature or undefined
     */
    getFeatureAtPixel(
        map: Map,
        pixel: number[],
        options?: { hitTolerance?: number }
    ): Feature<Geometry> | undefined {
        const features = this.detectFeaturesAtPixel(map, pixel, options);
        return features[0];
    }

    /**
     * Get the first feature at pixel with debouncing
     * @param map OpenLayers Map instance
     * @param pixel Pixel coordinates [x, y]
     * @param callback Callback function to execute with detected feature
     * @param options Detection options including debounce delay
     */
    getFeatureAtPixelDebounced(
        map: Map,
        pixel: number[],
        callback: (feature: Feature<Geometry> | undefined) => void,
        options: {
            hitTolerance?: number;
            debounceDelay?: number;
            debounceKey?: string;
        } = {}
    ): void {
        this.detectFeaturesAtPixelDebounced(
            map,
            pixel,
            (features) => callback(features[0]),
            options
        );
    }

    /**
     * Clear all pending debounced operations
     * Call this on cleanup/unmount
     */
    clearDebounceTimers(): void {
        this.debounceTimers.forEach(timer => clearTimeout(timer));
        this.debounceTimers.clear();
    }

    /**
     * Calculate distance from coordinate to feature
     */
    private getDistanceToFeature(
        coordinate: number[],
        feature: Feature<Geometry>
    ): number {
        const geometry = feature.getGeometry();
        if (!geometry) return Infinity;

        if (geometry instanceof Point) {
            return this.getDistanceToPoint(coordinate, geometry);
        } else if (geometry instanceof LineString) {
            return this.getDistanceToLineString(coordinate, geometry);
        } else if (geometry instanceof Polygon) {
            return this.getDistanceToPolygon(coordinate, geometry);
        }

        // For other geometry types, use a simple extent-based check
        const extent = geometry.getExtent();
        const [x, y] = coordinate;

        if (x >= extent[0] && x <= extent[2] && y >= extent[1] && y <= extent[3]) {
            return 0; // Inside extent
        }

        // Distance to nearest extent edge
        const dx = Math.max(extent[0] - x, 0, x - extent[2]);
        const dy = Math.max(extent[1] - y, 0, y - extent[3]);
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Calculate distance from coordinate to point
     */
    private getDistanceToPoint(coordinate: number[], point: Point): number {
        const pointCoord = point.getCoordinates();
        const dx = coordinate[0] - pointCoord[0];
        const dy = coordinate[1] - pointCoord[1];
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Calculate distance from coordinate to line string
     */
    private getDistanceToLineString(
        coordinate: number[],
        lineString: LineString
    ): number {
        const coords = lineString.getCoordinates();
        let minDistance = Infinity;

        // Check all segments
        for (let i = 0; i < coords.length - 1; i++) {
            const distance = this.getDistanceToSegment(
                coordinate,
                coords[i],
                coords[i + 1]
            );
            minDistance = Math.min(minDistance, distance);

            // Early exit if we found a hit
            if (minDistance === 0) return 0;
        }

        // Also check distance to vertices for better detection at line joints
        for (const vertex of coords) {
            const dx = coordinate[0] - vertex[0];
            const dy = coordinate[1] - vertex[1];
            const distance = Math.sqrt(dx * dx + dy * dy);
            minDistance = Math.min(minDistance, distance);
        }

        return minDistance;
    }

    /**
     * Calculate distance from coordinate to polygon
     */
    private getDistanceToPolygon(coordinate: number[], polygon: Polygon): number {
        // Check if point is inside polygon first
        if (polygon.intersectsCoordinate(coordinate)) {
            return 0;
        }

        // Otherwise, get distance to exterior ring
        const exteriorRing = polygon.getLinearRing(0);
        if (exteriorRing) {
            return this.getDistanceToLineString(coordinate, exteriorRing);
        }

        return Infinity;
    }

    /**
     * Calculate distance from point to line segment
     */
    private getDistanceToSegment(
        point: number[],
        segStart: number[],
        segEnd: number[]
    ): number {
        const dx = segEnd[0] - segStart[0];
        const dy = segEnd[1] - segStart[1];

        if (dx === 0 && dy === 0) {
            // Segment is a point
            const pdx = point[0] - segStart[0];
            const pdy = point[1] - segStart[1];
            return Math.sqrt(pdx * pdx + pdy * pdy);
        }

        // Project point onto line segment
        const t = Math.max(0, Math.min(1,
            ((point[0] - segStart[0]) * dx + (point[1] - segStart[1]) * dy) /
            (dx * dx + dy * dy)
        ));

        const projX = segStart[0] + t * dx;
        const projY = segStart[1] + t * dy;

        const pdx = point[0] - projX;
        const pdy = point[1] - projY;

        return Math.sqrt(pdx * pdx + pdy * pdy);
    }

    /**
     * Get statistics about the spatial index
     */
    getStats(): {
        features: number;
        indexedItems: number;
        treeHeight: number;
    } {
        return {
            features: this.features.length,
            indexedItems: this.tree.all().length,
            treeHeight: (this.tree as any).data?.height || 0
        };
    }

    /**
     * Clear the index and all timers
     */
    clear(): void {
        this.tree.clear();
        this.features = [];
        this.clearDebounceTimers();
    }
}
