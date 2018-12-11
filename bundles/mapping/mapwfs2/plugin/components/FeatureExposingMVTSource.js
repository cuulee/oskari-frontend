import olSourceVectorTile from 'ol/source/VectorTile';
import {oskariIdKey} from './FeatureUtil';
import {intersects} from 'ol/extent';
import convertRenderFeatures from './convertRenderFeatures';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader';
import OL3Parser from 'jsts/org/locationtech/jts/io/OL3Parser';
import LinearRing from 'ol/geom/LinearRing';
import GeometryCollection from 'ol/geom/GeometryCollection';
import * as olGeom from 'ol/geom';
import RelateOp from 'jsts/org/locationtech/jts/operation/relate/RelateOp';
import {fromKey} from 'ol/tilecoord';

const reader = new GeoJSONReader();
const olParser = new OL3Parser();
olParser.inject(olGeom.Point, olGeom.LineString, LinearRing, olGeom.Polygon, olGeom.MultiPoint, olGeom.MultiLineString, olGeom.MultiPolygon, GeometryCollection);

export default class FeatureExposingMVTSource extends olSourceVectorTile {
    getFeaturePropsInExtent (extent) {
        const propertiesById = new Map();

        this._applyInExtent(extent, feature => {
            const id = feature.get(oskariIdKey);
            if (propertiesById.has(id)) {
                return;
            }
            propertiesById.set(id, feature.getProperties());
        });

        return Array.from(propertiesById.values());
    }

    getPropsIntersectingGeom (geom) {
        const geomFilter = reader.read(geom);
        const envelope = geomFilter.getEnvelopeInternal();
        const propertiesById = new Map();

        let currentTile;
        let currentFeatures = [];
        const checkTileChanged = (tile) => {
            if (!currentTile) {
                currentTile = tile;
                return;
            }
            if (currentTile === tile) {
                return;
            }
            convertRenderFeatures(currentFeatures, currentTile, this).forEach(converted => {
                const convertedGeom = olParser.read(converted.getGeometry());
                if (RelateOp.relate(geomFilter, convertedGeom).isIntersects()) {
                    propertiesById.set(converted.get(oskariIdKey), converted.getProperties());
                }
            });
            currentTile = tile;
            currentFeatures = [];
        };

        this._applyInExtent([envelope.getMinX(), envelope.getMinY(), envelope.getMaxX(), envelope.getMaxY()], (feature, tile) => {
            const id = feature.get(oskariIdKey);
            if (propertiesById.has(id)) {
                return;
            }
            checkTileChanged(tile);

            currentFeatures.push(feature);
        });
        checkTileChanged();
        return Array.from(propertiesById.values());
    }

    _applyInExtent (extent, continuation) {
        const key = this.tileCache.peekFirstKey();
        const z = fromKey(key)[0]; // most recent zoom level in cache

        Object.values(this.sourceTiles_)
            .filter(tile => {
                const tileCoord = tile.getTileCoord();
                if (z !== tileCoord[0]) {
                    return; // wrong zoom level
                }
                const tileExtent = this._getTileExtent(tileCoord);
                if (!intersects(tileExtent, extent)) {
                    return; // tile not in extent
                }
                const features = tile.getFeatures();
                if (!features) {
                    return;
                }
                features
                    .forEach(feature => {
                        if (!intersects(feature.getExtent(), extent)) {
                            return; // feature not in extent
                        }
                        continuation(feature, tile);
                    });
            });
    }

    _getTileExtent (tileCoord) {
        return this.getTileGrid().getTileCoordExtent(tileCoord);
    }
}
