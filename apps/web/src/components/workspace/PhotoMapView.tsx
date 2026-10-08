import { Crosshair, LoaderCircle, Map as MapIcon, MapPinned, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getPhotoMapSettings,
  queryPhotoMap,
  type PhotoMapQueryResult,
  type PhotoMapSettings,
  type PhotoQueryRequest
} from "../../api.js";
import type { PhotoLocationBounds } from "@sigmaos/shared";
import "maplibre-gl/dist/maplibre-gl.css";

const WORLD_BOUNDS: PhotoLocationBounds = { kind: "bounds", west: -180, south: -85, east: 180, north: 85 };

export function PhotoMapView({
  filters,
  refreshKey,
  onConfigure,
  onOpenAsset,
  onSearchBounds,
  onError
}: {
  filters: PhotoQueryRequest["filters"];
  refreshKey: number;
  onConfigure: () => void;
  onOpenAsset: (assetId: string) => void | Promise<void>;
  onSearchBounds: (bounds: PhotoLocationBounds) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const openAssetRef = useRef(onOpenAsset);
  const errorRef = useRef(onError);
  const filtersRef = useRef(filters);
  const searchBoundsRef = useRef(onSearchBounds);
  const clustersRef = useRef<PhotoMapQueryResult["clusters"]>([]);
  const loadRequestRef = useRef(0);
  const boundsRef = useRef<PhotoLocationBounds>(WORLD_BOUNDS);
  const [settings, setSettings] = useState<PhotoMapSettings | null>(null);
  const [settingsUnavailable, setSettingsUnavailable] = useState(false);
  const [result, setResult] = useState<PhotoMapQueryResult | null>(null);
  const [bounds, setBounds] = useState<PhotoLocationBounds>(WORLD_BOUNDS);
  const [pendingBounds, setPendingBounds] = useState<PhotoLocationBounds | null>(null);
  const [loading, setLoading] = useState(true);

  filtersRef.current = filters;
  searchBoundsRef.current = onSearchBounds;

  const loadPoints = useCallback(async (nextBounds: PhotoLocationBounds, commitBounds = false) => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    try {
      const next = await queryPhotoMap({
        ...(filtersRef.current ? { filters: filtersRef.current } : {}),
        bounds: nextBounds,
        columns: 64,
        rows: 64
      });
      if (requestId !== loadRequestRef.current) return;
      setResult(next);
      setBounds(nextBounds);
      boundsRef.current = nextBounds;
      setPendingBounds(null);
      if (commitBounds) searchBoundsRef.current(nextBounds);
    } catch (error) {
      if (requestId === loadRequestRef.current) {
        errorRef.current(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    openAssetRef.current = onOpenAsset;
    errorRef.current = onError;
  }, [onError, onOpenAsset]);

  useEffect(() => {
    let active = true;
    void getPhotoMapSettings().then((response) => {
      if (!active) return;
      setSettings(response.settings);
      setSettingsUnavailable(Boolean(response.unavailable));
      const initial = response.settings?.bounds
        ? tupleToBounds(response.settings.bounds)
        : WORLD_BOUNDS;
      void loadPoints(initial);
    }).catch((error) => {
      if (active) errorRef.current(error instanceof Error ? error.message : String(error));
    });
    return () => {
      active = false;
      loadRequestRef.current += 1;
    };
  }, [loadPoints, refreshKey]);

  useEffect(() => {
    if (result) void loadPoints(boundsRef.current);
  }, [filters, loadPoints]);

  useEffect(() => {
    if (!settings || settingsUnavailable || !hostRef.current) return undefined;
    let disposed = false;
    let removeProtocol: (() => void) | null = null;
    void Promise.all([import("maplibre-gl"), import("pmtiles")]).then(([mapModule, pmtilesModule]) => {
      if (disposed || !hostRef.current) return;
      const maplibre = mapModule;
      const protocol = new pmtilesModule.Protocol();
      maplibre.addProtocol("pmtiles", protocol.tile);
      removeProtocol = () => maplibre.removeProtocol("pmtiles");
      const archiveUrl = `${window.location.origin}/api/photos/map/archive`;
      const initialBounds = settings.bounds ?? [-180, -85, 180, 85];
      const map = new maplibre.Map({
        container: hostRef.current,
        attributionControl: false,
        center: midpoint(initialBounds),
        zoom: Math.max(settings.minZoom, 1),
        minZoom: settings.minZoom,
        maxZoom: settings.maxZoom,
        style: {
          version: 8,
          sources: {
            offline: {
              type: "raster",
              url: `pmtiles://${archiveUrl}`,
              tileSize: 256,
              attribution: settings.attribution ?? ""
            },
            photos: { type: "geojson", data: emptyFeatureCollection() }
          },
          layers: [
            { id: "offline", type: "raster", source: "offline" },
            {
              id: "photo-points",
              type: "circle",
              source: "photos",
              paint: {
                "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 7, 100, 18],
                "circle-color": "#f4c95d",
                "circle-stroke-color": "#16191f",
                "circle-stroke-width": 2
              }
            },
            {
              id: "photo-counts",
              type: "symbol",
              source: "photos",
              filter: [">", ["get", "count"], 1],
              layout: { "text-field": ["to-string", ["get", "count"]], "text-size": 11 },
              paint: { "text-color": "#16191f" }
            }
          ]
        }
      });
      mapRef.current = map;
      map.on("load", () => {
        const source = map.getSource("photos") as import("maplibre-gl").GeoJSONSource | undefined;
        source?.setData(pointsToGeoJson(clustersRef.current));
      });
      map.on("moveend", () => {
        const viewport = map.getBounds();
        setPendingBounds(photoViewportBounds(
          viewport.getWest(), viewport.getSouth(), viewport.getEast(), viewport.getNorth()
        ));
      });
      map.on("click", "photo-points", (event: import("maplibre-gl").MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const count = Number(feature.properties?.count ?? 0);
        const assetId = String(feature.properties?.assetId ?? "");
        const coordinates = feature.geometry.coordinates as [number, number];
        if (count === 1 && assetId) void openAssetRef.current(assetId);
        else map.easeTo({ center: coordinates, zoom: Math.min(map.getZoom() + 2, settings.maxZoom) });
      });
    }).catch((error) => errorRef.current(error instanceof Error ? error.message : String(error)));
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      removeProtocol?.();
    };
  }, [settings, settingsUnavailable]);

  useEffect(() => {
    clustersRef.current = result?.clusters ?? [];
    const source = mapRef.current?.getSource("photos") as import("maplibre-gl").GeoJSONSource | undefined;
    source?.setData(pointsToGeoJson(clustersRef.current));
  }, [result]);

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      onError(t("workspace.photos.locationUnavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition((position) => {
      const center: [number, number] = [position.coords.longitude, position.coords.latitude];
      if (mapRef.current) mapRef.current.easeTo({ center, zoom: Math.max(mapRef.current.getZoom(), 10) });
      else {
        const next = around(center[0], center[1], 1);
        void loadPoints(next);
      }
    }, (error) => onError(error.message));
  }

  const localCanvas = !settings || settingsUnavailable;
  return (
    <section className="photo-map-view" aria-label={t("workspace.photos.mapView")}>
      <div className="photo-map-toolbar">
        <span>{localCanvas ? t("workspace.photos.localCoordinateMap") : settings.path}</span>
        <div>
          <button type="button" onClick={useCurrentLocation} title={t("workspace.photos.myLocation")} aria-label={t("workspace.photos.myLocation")}>
            <Crosshair aria-hidden="true" size={15} />
          </button>
          <button type="button" onClick={onConfigure} title={t("workspace.photos.configureMap")} aria-label={t("workspace.photos.configureMap")}>
            <MapPinned aria-hidden="true" size={15} />
          </button>
          <button type="button" onClick={() => void loadPoints(pendingBounds ?? bounds, true)} disabled={!pendingBounds || loading}>
            <Search aria-hidden="true" size={14} />{t("workspace.photos.searchArea")}
          </button>
        </div>
      </div>
      <div className="photo-map-canvas">
        {localCanvas ? (
          <div className="photo-coordinate-canvas" role="img" aria-label={t("workspace.photos.localCoordinateMap")}>
            <div className="photo-coordinate-grid" aria-hidden="true" />
            {(result?.clusters ?? []).map((cluster, index) => (
              <button
                key={`${cluster.longitude}:${cluster.latitude}:${index}`}
                type="button"
                className="photo-map-point"
                style={pointStyle(cluster.longitude, cluster.latitude, bounds)}
                onClick={() => cluster.assetId
                  ? void onOpenAsset(cluster.assetId)
                  : void loadPoints(around(cluster.longitude, cluster.latitude, boundsSpan(bounds) / 4))}
                aria-label={t("workspace.photos.mapPhotoCount", { count: cluster.count })}
              >
                {cluster.count > 1 ? cluster.count : ""}
              </button>
            ))}
            <div className="photo-map-empty-label">
              <MapIcon aria-hidden="true" size={20} />
              <span>{settingsUnavailable ? t("workspace.photos.mapOffline") : t("workspace.photos.noBaseMap")}</span>
            </div>
          </div>
        ) : <div ref={hostRef} className="photo-maplibre" />}
        {loading ? <div className="photo-map-loading"><LoaderCircle className="is-spinning" aria-hidden="true" size={20} /></div> : null}
      </div>
      {result?.metadataIndex.pending ? (
        <p className="photo-index-progress">{t("workspace.photos.metadataProgress", {
          indexed: result.metadataIndex.indexed,
          total: result.metadataIndex.total
        })}</p>
      ) : null}
    </section>
  );
}

function tupleToBounds(bounds: [number, number, number, number]): PhotoLocationBounds {
  return { kind: "bounds", west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3] };
}

function midpoint(bounds: [number, number, number, number]): [number, number] {
  const longitude = bounds[0] <= bounds[2]
    ? (bounds[0] + bounds[2]) / 2
    : normalizeLongitude((bounds[0] + bounds[2] + 360) / 2);
  return [longitude, (bounds[1] + bounds[3]) / 2];
}

function pointsToGeoJson(clusters: PhotoMapQueryResult["clusters"]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: clusters.map((cluster) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [cluster.longitude, cluster.latitude] },
      properties: { count: cluster.count, assetId: cluster.assetId ?? "" }
    }))
  };
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function pointStyle(longitude: number, latitude: number, bounds: PhotoLocationBounds) {
  const span = bounds.west <= bounds.east ? bounds.east - bounds.west : 360 - bounds.west + bounds.east;
  const adjusted = longitude < bounds.west ? longitude + 360 : longitude;
  const left = Math.max(0, Math.min(100, ((adjusted - bounds.west) / Math.max(span, 0.000001)) * 100));
  const top = Math.max(0, Math.min(100, ((bounds.north - latitude) / Math.max(bounds.north - bounds.south, 0.000001)) * 100));
  return { left: `${left}%`, top: `${top}%` };
}

function around(longitude: number, latitude: number, span: number): PhotoLocationBounds {
  const half = Math.max(0.05, Math.min(90, span / 2));
  return {
    kind: "bounds",
    west: normalizeLongitude(longitude - half),
    south: Math.max(-90, latitude - half),
    east: normalizeLongitude(longitude + half),
    north: Math.min(90, latitude + half)
  };
}

function boundsSpan(bounds: PhotoLocationBounds): number {
  return bounds.west <= bounds.east ? bounds.east - bounds.west : 360 - bounds.west + bounds.east;
}

export function photoViewportBounds(
  west: number,
  south: number,
  east: number,
  north: number
): PhotoLocationBounds {
  if (east - west >= 360) {
    return { kind: "bounds", west: -180, south: Math.max(-90, south), east: 180, north: Math.min(90, north) };
  }
  const normalizedEast = normalizeLongitude(east);
  return {
    kind: "bounds",
    west: normalizeLongitude(west),
    south: Math.max(-90, south),
    east: normalizedEast === -180 && east > 0 ? 180 : normalizedEast,
    north: Math.min(90, north)
  };
}

function normalizeLongitude(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}
