import type { Reference, ReferenceCatalog } from './types';

const CATALOG_URL = `${import.meta.env.BASE_URL}data/references.json`;

function isReference(x: unknown): x is Reference {
  const r = x as Partial<Reference> | null;
  return (
    !!r &&
    typeof r.id === 'string' &&
    typeof r.nombre === 'string' &&
    typeof r.barrio === 'string' &&
    typeof r.latitude === 'number' &&
    typeof r.longitude === 'number' &&
    Array.isArray(r.aliases)
  );
}

/** Loads the catalogue once per page load. Invalid entries are dropped, never repaired. */
export async function loadCatalog(url = CATALOG_URL, signal?: AbortSignal): Promise<Reference[]> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`No se pudo cargar el catálogo (HTTP ${res.status})`);
  const data = (await res.json()) as Partial<ReferenceCatalog>;
  if (!Array.isArray(data.references)) throw new Error('El catálogo no tiene el formato esperado');
  return data.references.filter(isReference);
}
