// What Orbit Setup knows about the apps on a TV (catalog.json, written with the TV side; phone/SPEC.md, "What the page
// keeps"). The page reads it as it is: only the packages it lists are ever offered, and the rest of a TV is left alone.
import raw from "./catalog.json";

export type Answer = "keep" | "off";

export interface CatalogGroup {
  label: string;
  about: string;
  default: Answer;
  /** On the list whenever Orbit Home is installed, and not for a person to keep (the stock home screen). */
  requiredWithHome?: boolean;
}

export interface CatalogQuestion {
  id: string;
  group: string;
  title: string;
  help: string;
  keep: string;
  off: string;
  recommend?: Answer;
}

export interface CatalogPackage {
  label: string;
  group: string;
}

export interface CatalogModel {
  name: string;
  device?: string;
  /** Packages that go off together or stay on together (the TV crash-loops otherwise). */
  together?: string[][];
  notes?: string;
}

export interface Catalog {
  version: number;
  about?: string;
  coreRe: string;
  coreOk?: string;
  groups: Record<string, CatalogGroup>;
  questions: CatalogQuestion[];
  packages: Record<string, CatalogPackage>;
  neverOff: string[];
  models: Record<string, CatalogModel>;
}

export const catalog = raw as unknown as Catalog;
