/**
 * Provider LOCAL de AML (P1 #1) — implementa `AmlProvider` leyendo el dataset
 * descargado en `aml_entities` (PG). Es el único punto que toca la DB para el
 * screening; el matching fino vive en `aml.ts` (puro). On-prem DURO: el nombre del
 * titular sólo viaja a la propia base de datos del 34, nunca a un tercero.
 *
 * Se inyecta el "store" (candidates + datasetVersion) para no acoplar el módulo al
 * singleton de repos y mantenerlo testeable.
 */
import type { AmlEntity, AmlInput } from "../types";
import type { AmlProvider } from "./aml";

export interface AmlStore {
  candidates(input: AmlInput, limit?: number): Promise<AmlEntity[]>;
  datasetVersion(): Promise<string | null>;
}

/** Crea el provider local respaldado por `aml_entities`. */
export function createLocalAmlProvider(store: AmlStore, limit = 500): AmlProvider {
  return {
    name: "local-opensanctions",
    candidates: (input) => store.candidates(input, limit),
    datasetVersion: () => store.datasetVersion(),
  };
}
