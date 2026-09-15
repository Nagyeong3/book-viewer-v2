"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  AgentPlan,
  api,
  ContentItem,
  DocumentSummary,
  RagSource,
  streamAgent,
  streamRag,
  TocNode,
} from "../lib/api";

type Mode = "agent" | "rag";

type ChatTurn = {
  id: number;
  question: string;
  answer: string;
  sources: RagSource[];
  plan?: AgentPlan;
  pending: boolean;
  error?: string;
};

function TocTree({ nodes, onPick }: { nodes: TocNode[]; onPick: (node: TocNode) => void }) {
  return (
    <ul className="toc-tree">
      {nodes.map((node) => (
        <li key={node.id}>
          <button type="button" onClick={() => onPick(node)}>
            <span className="toc-num">{node.title_num}</span>
            <span>{node.text}</span>
            {node.page ? <small>p.{node.page}</small> : null}
          </button>
          {node.children?.length ? <TocTree nodes={node.children} onPick={onPick} /> : null}
        </li>
      ))}
    </ul>
  );
}

function ViewerContent({
  contents,
  focusContentId,
}: {
  contents: ContentItem[];
  focusContentId: number | null;
}) {
  const refs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!focusContentId) return;
    refs.current[focusContentId]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusContentId, contents]);

  if (!contents.length) {
    return <div className="empty-state">표시할 본문이 없습니다.</div>;
  }

  return (
    <div className="content-list">
      {contents.map((item) => (
        <div
          key={item.id}
          ref={(element) => {
            refs.current[item.id] = element;
          }}
          className={`content-row ${focusContentId === item.id ? "focused" : ""}`}
        >
          <div className="content-meta">
            <span>#{item.id}</span>
            <span>{item.content_type ?? "unknown"}</span>
            {item.page ? <span>p.{item.page}</span> : null}
          </div>
          <div className={`content-text level-${item.doc_level ?? 0}`}>
            {item.text?.trim() || <span className="muted">텍스트 없음</span>}
          </div>
          {item.bbox ? (
            <div className="bbox-note">
              bbox {item.bbox.xmin}, {item.bbox.ymin} → {item.bbox.xmax}, {item.bbox.ymax}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default function Workspace() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<number | null>(null);
  const [toc, setToc] = useState<TocNode[]>([]);
  const [contents, setContents] = useState<ContentItem[]>([]);
  const [activePage, setActivePage] = useState<number | undefined>(undefined);
  const [focusContentId, setFocusContentId] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<Mode>("agent");
  const [topK, setTopK] = useState(5);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [loadingViewer, setLoadingViewer] = useState(false);
  const [startupError, setStartupError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    api
      .listDocuments()
      .then((items) => {
        setDocuments(items);
        if (items.length) {
          setSelectedIds([items[0].id]);
          setActiveDocumentId(items[0].id);
        }
      })
      .catch((error: Error) => setStartupError(error.message));
  }, []);

  useEffect(() => {
    if (!activeDocumentId) return;
    let cancelled = false;
    setLoadingViewer(true);
    Promise.all([
      api.getToc(activeDocumentId),
      api.listContents(activeDocumentId, activePage),
    ])
      .then(([tocItems, contentItems]) => {
        if (cancelled) return;
        setToc(tocItems);
        setContents(contentItems);
      })
      .catch((error: Error) => {
        if (!cancelled) setStartupError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingViewer(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeDocumentId, activePage]);

  const activeDocument = useMemo(
    () => documents.find((document) => document.id === activeDocumentId) ?? null,
    [documents, activeDocumentId],
  );

  function toggleDocument(documentId: number) {
    setSelectedIds((current) => {
      if (current.includes(documentId)) {
        if (current.length === 1) return current;
        return current.filter((id) => id !== documentId);
      }
      return [...current, documentId];
    });
    setActiveDocumentId(documentId);
    setActivePage(undefined);
    setFocusContentId(null);
  }

  function openSource(source: RagSource) {
    setActiveDocumentId(source.document_id);
    setActivePage(source.page ?? undefined);
    setFocusContentId(source.content_id);
  }

  function openToc(node: TocNode) {
    setActivePage(node.page ?? undefined);
    setFocusContentId(node.id);
  }

  async function submitQuestion(event: FormEvent) {
    event.preventDefault();
    const clean = question.trim();
    if (!clean || !selectedIds.length) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const id = Date.now();
    setTurns((current) => [
      ...current,
      { id, question: clean, answer: "", sources: [], pending: true },
    ]);
    setQuestion("");

    const handlers = {
      onPlan: (plan: AgentPlan) =>
        setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, plan } : turn))),
      onSources: (sources: RagSource[]) =>
        setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, sources } : turn))),
      onToken: (token: string) =>
        setTurns((current) =>
          current.map((turn) => (turn.id === id ? { ...turn, answer: turn.answer + token } : turn)),
        ),
      onDone: () =>
        setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, pending: false } : turn))),
    };

    try {
      if (mode === "agent") {
        await streamAgent(clean, selectedIds, topK, handlers, controller.signal);
      } else {
        await streamRag(clean, selectedIds, topK, handlers, controller.signal);
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      const message = error instanceof Error ? error.message : String(error);
      setTurns((current) =>
        current.map((turn) => (turn.id === id ? { ...turn, pending: false, error: message } : turn)),
      );
    }
  }

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <div>
          <strong>Book Viewer V2</strong>
          <span>통합 문서 검색 · Agentic RAG</span>
        </div>
        <div className="status-pill">문서 {documents.length}개</div>
      </header>

      {startupError ? <div className="global-error">{startupError}</div> : null}

      <section className="workspace-grid">
        <aside className="document-pane panel">
          <div className="panel-heading">
            <div>
              <h2>검색 범위</h2>
              <p>여러 문서를 동시에 선택할 수 있습니다.</p>
            </div>
            <span>{selectedIds.length} selected</span>
          </div>
          <div className="document-list">
            {documents.map((document) => {
              const selected = selectedIds.includes(document.id);
              return (
                <button
                  key={document.id}
                  type="button"
                  className={`document-item ${selected ? "selected" : ""} ${activeDocumentId === document.id ? "active" : ""}`}
                  onClick={() => toggleDocument(document.id)}
                >
                  <span className="checkbox-mark">{selected ? "✓" : ""}</span>
                  <span>
                    <strong>{document.title}</strong>
                    <small>Document #{document.id}</small>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="toc-section">
            <div className="section-label">목차</div>
            {toc.length ? <TocTree nodes={toc} onPick={openToc} /> : <div className="muted">목차 없음</div>}
          </div>
        </aside>

        <section className="viewer-pane panel">
          <div className="panel-heading viewer-heading">
            <div>
              <h2>{activeDocument?.title ?? "문서 선택"}</h2>
              <p>
                {activePage ? `페이지 ${activePage}` : "전체 콘텐츠"}
                {focusContentId ? ` · content #${focusContentId}` : ""}
              </p>
            </div>
            {activePage ? (
              <button type="button" className="ghost-button" onClick={() => setActivePage(undefined)}>
                전체 보기
              </button>
            ) : null}
          </div>
          {loadingViewer ? <div className="empty-state">문서를 불러오는 중...</div> : <ViewerContent contents={contents} focusContentId={focusContentId} />}
        </section>

        <aside className="chat-pane panel">
          <div className="panel-heading">
            <div>
              <h2>AI 질의응답</h2>
              <p>선택 문서 범위를 벗어나지 않습니다.</p>
            </div>
          </div>

          <div className="chat-controls">
            <div className="segmented">
              <button type="button" className={mode === "agent" ? "active" : ""} onClick={() => setMode("agent")}>Agent</button>
              <button type="button" className={mode === "rag" ? "active" : ""} onClick={() => setMode("rag")}>Hybrid RAG</button>
            </div>
            <label>
              Top K
              <select value={topK} onChange={(event) => setTopK(Number(event.target.value))}>
                {[3, 5, 8, 10].map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
          </div>

          <div className="chat-log">
            {!turns.length ? (
              <div className="empty-chat">
                <strong>문서를 선택하고 질문하세요.</strong>
                <p>출처를 클릭하면 해당 문서·페이지·콘텐츠로 이동합니다.</p>
              </div>
            ) : null}
            {turns.map((turn) => (
              <article key={turn.id} className="chat-turn">
                <div className="user-message">{turn.question}</div>
                <div className="assistant-message">
                  {turn.plan ? (
                    <div className="plan-card">
                      <span>{turn.plan.tool}</span>
                      <strong>{turn.plan.query}</strong>
                      {turn.plan.rationale ? <small>{turn.plan.rationale}</small> : null}
                    </div>
                  ) : null}
                  <div className="answer-text">
                    {turn.answer || (turn.pending ? "답변 생성 중..." : "")}
                    {turn.pending ? <span className="cursor" /> : null}
                  </div>
                  {turn.error ? <div className="turn-error">{turn.error}</div> : null}
                  {turn.sources.length ? (
                    <div className="source-list">
                      {turn.sources.map((source) => (
                        <button key={source.source_id} type="button" onClick={() => openSource(source)}>
                          <span>{source.source_id}</span>
                          <strong>{source.document_name}</strong>
                          <small>{source.title_path.join(" > ") || `content #${source.content_id}`} {source.page ? `· p.${source.page}` : ""}</small>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>

          <form className="question-form" onSubmit={submitQuestion}>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="선택한 문서에 대해 질문하세요"
              rows={3}
            />
            <div>
              <span>{selectedIds.length}개 문서 범위</span>
              <button type="submit" disabled={!question.trim() || !selectedIds.length}>질문 전송</button>
            </div>
          </form>
        </aside>
      </section>
    </main>
  );
}
