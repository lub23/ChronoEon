import { createContext, useContext } from "react";
import type { GeoPlace, GeoPoint } from "@chronoeon/domain";
import type { GeocodeConfig } from "../platform/geocode";

export interface PlaceServices {
  places: Map<string, GeoPlace>;
  addresses: string[];
  counts?: Map<string, number>;
  notice?: (message: string) => void;
  config?: GeocodeConfig;
  cache: (address: string, point: GeoPoint, level?: string, score?: number) => Promise<void>;
  rename: (address: string, name: string) => Promise<void>;
}
export const PlaceServicesContext = createContext<PlaceServices>({ places: new Map(), addresses: [], cache: async () => {}, rename: async () => {} });
export const usePlaceServices = () => useContext(PlaceServicesContext);
