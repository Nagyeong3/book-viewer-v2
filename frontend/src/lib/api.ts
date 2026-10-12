export type DocumentSummary = { id: number; title: string };

export type TocNode = {
  id: number;
  text: string;
  doc_level: number;
  title_num: string;
  page: number | null;
  order_index: number;
  children: TocNode[];
};

export type ContentItem = {
  id: number;
  document_id: number;
  text: string | null;
  content_type: string | null;
  doc_level: number | null;
  parent_id: number | null;
  order_index: number;
  page: number | null;
  doc_image_path: string | null;
  cropped_image_path: string | null;
  bbox: { xmin: number; ymin: number; xmax: number; ymax: number } | null;
  title_num: string | null;
  translations: Record<string, string> | null;
};

export type TranslationResponse = { translated_text: string; target_language: string };

export type DocumentIndexStatus = {
  document_id: number;
  state: "ready" | "missing" | "queued" | "indexing" | "failed";
  indexed_chunks: number;
  message: string | null;
};

export type RagSource = {
  source_id: string;
  chunk_id: string;
  document_id: number;
  document_name: string;
  content_id: number;
  page: number | null;
  title_path: string[];
  text: string;
  score: number;
};

export type AgentPlan = {
  tool: string;
  query: string;
  top_k: number;
  rationale: string;
};

export type AgentStep = {
  id: string;
  title: string;
  status: "running" | "done";
  detail: string;
  tool?: string;
  query?: string;
  decision?: string;
};

export type StreamHandlers = {
  onPlan?: (plan: AgentPlan) => void;
  onStep?: (step: AgentStep) => void;
  onSources?: (sources: RagSource[]) => void;
  onToken?: (token: string) => void;
  onDone?: (data: unknown) => void;
};

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:9056").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 800)}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  listDocuments: () => request<DocumentSummary[]>("/api/documents"),
  getToc: (documentId: number) => request<TocNode[]>(`/api/documents/${documentId}/toc`),
  listTranslationLanguages: (documentId: number) =>
    request<string[]>(`/api/documents/${documentId}/translation-languages`),
  listContents: (documentId: number, page?: number) =>
    request<ContentItem[]>(`/api/documents/${documentId}/contents${page ? `?page=${page}` : ""}`),
  pageImageUrl: (documentId: number, page: number) => `${API_BASE}/api/documents/${documentId}/pages/${page}/image`,
  listIndexStatuses: (documentIds?: number[]) => {
    const params = documentIds?.length ? `?${documentIds.map((id) => `document_ids=${id}`).join("&")}` : "";
    return request<DocumentIndexStatus[]>(`/api/indexing/documents${params}`);
  },
  getIndexStatus: (documentId: number) => request<DocumentIndexStatus>(`/api/indexing/documents/${documentId}`),
  buildDocumentIndex: (documentId: number) => request<DocumentIndexStatus>(`/api/indexing/documents/${documentId}`, { method: "POST" }),
  translate: (text: string, targetLanguage: string) =>
    request<TranslationResponse>("/api/translation", {
      method: "POST",
      body: JSON.stringify({ text, target_language: targetLanguage }),
    }),
};

function parseSseBlock(block: string): { event: string; data: unknown } | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  const raw = data.join("\n");
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    return { event, data: raw };
  }
}

function surfaceIndexReadinessError(body: string) {
  try {
    const parsed = JSON.parse(body) as { detail?: { code?: string; message?: string; document_ids?: number[] } };
    if (parsed.detail?.code !== "DOCUMENTS_NOT_INDEXED") return;
    window.dispatchEvent(new CustomEvent("book-viewer:index-required", {
      detail: {
        message: parsed.detail.message ?? "벡터 DB 구축이 필요한 문서가 있습니다.",
        documentIds: parsed.detail.document_ids ?? [],
      },
    }));
  } catch {
    // Non-JSON error bodies are handled by the regular stream error path.
  }
}

async function consumeSse(response: Response, handlers: StreamHandlers): Promise<void> {
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 409) surfaceIndexReadinessError(body);
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 800)}`);
  }
  if (!response.body) throw new Error("Streaming response body is unavailable");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const parsed = parseSseBlock(block);
      if (!parsed) continue;
      if (parsed.event === "plan") handlers.onPlan?.(parsed.data as AgentPlan);
      else if (parsed.event === "step") handlers.onStep?.(parsed.data as AgentStep);
      else if (parsed.event === "sources") handlers.onSources?.(parsed.data as RagSource[]);
      else if (parsed.event === "token") handlers.onToken?.(String(parsed.data));
      else if (parsed.event === "done") handlers.onDone?.(parsed.data);
    }
    if (done) break;
  }
}

export async function streamAgent(
  question: string,
  documentIds: number[],
  topK: number,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/agent/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, document_ids: documentIds, top_k: topK }),
    signal,
  });
  return consumeSse(response, handlers);
}

export async function streamRag(
  question: string,
  documentIds: number[],
  topK: number,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/rag/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, document_ids: documentIds, mode: "hybrid", top_k: topK }),
    signal,
  });
  return consumeSse(response, handlers);
}
