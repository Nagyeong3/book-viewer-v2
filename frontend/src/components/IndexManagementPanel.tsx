"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { api, DocumentIndexStatus, DocumentSummary } from "../lib/api";

type IndexRequiredDetail = { message?: string; documentIds?: number[] };

const RUNNING_STATES = new Set<DocumentIndexStatus["state"]>(["queued", "indexing"]);

function statusLabel(state: DocumentIndexStatus["state"]) {
  if (state === "ready") return "구축 완료";
  if (state === "queued") return "대기 중";
  if (state === "indexing") return "구축 중";
  if (state === "failed") return "오류";
  return "미구축";
}

function DatabaseIcon() {
  return (
    <svg className="button-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="5" rx="7" ry="3" />
      <path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
      <path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </svg>
  );
}

export default function IndexManagementPanel() {
  const [open, setOpen] = useState(false);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [statuses, setStatuses] = useState<Record<number, DocumentIndexStatus>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attentionIds, setAttentionIds] = useState<number[]>([]);
  const [topbarTarget, setTopbarTarget] = useState<HTMLElement | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [docs, indexStatuses] = await Promise.all([api.listDocuments(), api.listIndexStatuses()]);
      setDocuments(docs);
      setStatuses(Object.fromEntries(indexStatuses.map((item) => [item.document_id, item])));
      window.dispatchEvent(new CustomEvent("book-viewer:index-status-changed"));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const locate = () => setTopbarTarget(document.querySelector<HTMLElement>(".topbar-actions"));
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onIndexRequired = (event: Event) => {
      const detail = (event as CustomEvent<IndexRequiredDetail>).detail ?? {};
      setAttentionIds(detail.documentIds ?? []);
      setNotice(detail.message ?? "RAG/LLM 사용 전에 벡터 DB 구축이 필요합니다.");
      setOpen(true);
      void refresh();
    };
    window.addEventListener("book-viewer:index-required", onIndexRequired);
    return () => window.removeEventListener("book-viewer:index-required", onIndexRequired);
  }, [refresh]);

  const hasRunningJob = useMemo(
    () => Object.values(statuses).some((item) => RUNNING_STATES.has(item.state)),
    [statuses],
  );

  useEffect(() => {
    if (!hasRunningJob) return;
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => window.clearInterval(timer);
  }, [hasRunningJob, refresh]);

  async function build(documentId: number) {
    setAttentionIds((current) => current.includes(documentId) ? current : [...current, documentId]);
    try {
      const next = await api.buildDocumentIndex(documentId);
      setStatuses((current) => ({ ...current, [documentId]: next }));
      window.dispatchEvent(new CustomEvent("book-viewer:index-status-changed"));
      setNotice(`Document #${documentId} 벡터 DB 구축을 시작했습니다.`);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const readyCount = documents.filter((document) => statuses[document.id]?.state === "ready").length;
  const missingCount = documents.length - readyCount;

  return (
    <>
      {notice ? (
        <div className="index-floating-alert" role="status">
          <div><strong>RAG 준비 상태</strong><span>{notice}</span></div>
          <button type="button" onClick={() => setNotice("")} aria-label="알림 닫기">×</button>
        </div>
      ) : null}

      {topbarTarget ? createPortal(
        <button type="button" className="topbar-index-button" onClick={() => setOpen(true)} title="벡터 DB 구축 현황">
          <DatabaseIcon />
          <span>벡터 DB</span>
          <span className={`index-dot ${missingCount ? "warning" : "ready"}`} />
          <small>{readyCount}/{documents.length || "-"}</small>
        </button>,
        topbarTarget,
      ) : null}

      {open ? (
        <div className="index-manager-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
          <section className="index-manager-panel" role="dialog" aria-modal="true" aria-label="벡터 DB 관리">
            <header>
              <div>
                <span className="index-eyebrow">PostgreSQL → Elasticsearch</span>
                <h2>벡터 DB 관리</h2>
                <p>PostgreSQL에 추가된 문서를 RAG 검색용 Elasticsearch 벡터 인덱스로 구축합니다.</p>
              </div>
              <button type="button" className="index-close" onClick={() => setOpen(false)}>×</button>
            </header>

            <div className="index-summary">
              <div><span>전체 문서</span><strong>{documents.length}</strong></div>
              <div><span>구축 완료</span><strong>{readyCount}</strong></div>
              <div className={missingCount ? "warning" : ""}><span>미구축/확인 필요</span><strong>{missingCount}</strong></div>
              <button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "확인 중..." : "상태 새로고침"}</button>
            </div>

            {error ? <div className="index-error">{error}</div> : null}

            <div className="index-document-list">
              {documents.map((document) => {
                const status = statuses[document.id] ?? { document_id: document.id, state: "missing", indexed_chunks: 0, message: null };
                const running = RUNNING_STATES.has(status.state);
                const attention = attentionIds.includes(document.id) && status.state !== "ready";
                return (
                  <article key={document.id} className={`index-document-row state-${status.state} ${attention ? "attention" : ""}`}>
                    <div className="index-document-main">
                      <span className={`index-state-dot state-${status.state}`} />
                      <div>
                        <strong>{document.title}</strong>
                        <small>Document #{document.id}{status.indexed_chunks ? ` · ${status.indexed_chunks.toLocaleString()} chunks` : ""}</small>
                      </div>
                    </div>
                    <div className="index-document-actions">
                      <span className={`index-state-label state-${status.state}`}>{running ? <i className="index-spinner" /> : null}{statusLabel(status.state)}</span>
                      {status.state !== "ready" ? (
                        <button type="button" onClick={() => void build(document.id)} disabled={running}>
                          {running ? "구축 중" : status.state === "failed" ? "다시 구축" : "벡터 DB 구축"}
                        </button>
                      ) : null}
                    </div>
                    {status.message && status.state === "failed" ? <p className="index-row-message">{status.message}</p> : null}
                  </article>
                );
              })}
            </div>

            <footer>
              <span>미구축 문서는 Agent/Hybrid RAG 질문 시 서버에서도 차단됩니다.</span>
              <button type="button" onClick={() => setOpen(false)}>닫기</button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
