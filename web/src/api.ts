import type { Diagnostic, ItemsDb, ItemsDoc } from "../../src/shared/types";

export interface AtlasInfo {
  image: string;
  size: number;
  width: number;
  height: number;
  frames: Record<string, { x: number; y: number; w: number; h: number }>;
}

export interface WorkspaceInfo {
  root: string;
  docs: string[];
  categories: string[];
  effectKinds: string[];
  rarities: string[];
  iconNames: Array<{ name: string; th: string; en: string }>;
  atlas: AtlasInfo;
}

export interface DbResponse {
  db: ItemsDb;
  errors: Diagnostic[];
  warnings: Diagnostic[];
  docs: string[];
}

export interface CheckResponse {
  errors: Diagnostic[];
  warnings: Diagnostic[];
  quests: { files: string[]; matched: string[]; missing: string[] };
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const fetchWorkspace = () => fetch("/api/workspace").then((r) => json<WorkspaceInfo>(r));
export const fetchDb = () => fetch("/api/db").then((r) => json<DbResponse>(r));
export const fetchCheck = () => fetch("/api/check").then((r) => json<CheckResponse>(r));
export const fetchDoc = (id: string) => fetch(`/api/docs/${id}`).then((r) => json<{ id: string; doc: ItemsDoc }>(r));
export const saveDoc = (id: string, doc: ItemsDoc) => post(`/api/docs/${id}`, { doc }).then((r) => json<{ ok: boolean; file: string; errors: Diagnostic[]; warnings: Diagnostic[] }>(r));
export const exportItems = (preset: string) => post("/api/export", { preset }).then((r) => json<{ dirs: string[]; files: number; items: number }>(r));
