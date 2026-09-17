"use client";

import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";

import DocumentCanvas, { DocumentRenderMode, SemanticContent } from "./DocumentCanvas";
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
type AssistantTab = "assistant" | "process";

type ChatTurn = {
  id: number;
  question: string;
  answer: string;
  sources: RagSource[];
  plan?: AgentPlan;
  pending: boolean;
  error?: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

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

function StructuredList({ contents, focusContentId }: { contents: ContentItem[]; focusContentId: number | null }) {
  const refs = useRef<Record<number, HTMLElement | null>>({});

  useEffect(() => {
    if (!focusContentId) return;
    refs.current[focusContentId]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusContentId, contents]);

  if (!contents.length) return <div className="empty-state">표시할 본문이 없습니다.</div>;

  return (
    <div className="semantic-document">
      {contents.map((item) => (
        <article
          key={item.id}
          ref={(element) => {
            refs.current[item.id] = element;
          }}
          className={`semantic-row ${focusContentId === item.id ? "focused" : ""}`}
        >
          <div className="content-meta">
            <span>#{item.id}</span>
            <span>{item.content_type ?? "unknown"}</span>
            {item.page ? <span>p.{item.page}</span> : null}
          </div>
          <SemanticContent item={item} />
        </article>
      ))}
    </div>
  );
}

function SourceDock({
  turn,
  onOpen,
}: {
  turn: ChatTurn | undefined;
  onOpen: (source: RagSource) => void;
}) {
  if (!turn) return null;
  return (
    <section className="source-dock" aria-label="참조 문서">
      <div className="source-dock-heading">
        <div>
          <strong>참조 문서</strong>
          <small>검색된 근거를 먼저 확인한 뒤 답변이 생성됩니다.</small>
        </div>
        <span>{turn.sources.length}</span>
      </div>
      {turn.sources.length ? (
        <div className="source-strip">
          {turn.sources.map((source) => (
            <button key={source.source_id} type="button" onClick={() => onOpen(source)}>
              <span className="source-id">{source.source_id}</span>
              <span className="source-copy">
                <strong>{source.document_name}</strong>
                <small>
                  {source.title_path.join(" > ") || `content #${source.content_id}`}
                  {source.page ? ` · p.${source.page}` : ""}
                </small>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="source-waiting">{turn.pending ? "관련 문서를 검색 중입니다..." : "참조 문서가 없습니다."}</div>
      )}
    </section>
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
  const [assistantTab, setAssistantTab] = useState<AssistantTab>("assistant");
  const [renderMode, setRenderMode] = useState<DocumentRenderMode>("structured");
  const [topK, setTopK] = useState(5);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [loadingViewer, setLoadingViewer] = useState(false);
  const [startupError, setStartupError] = useState("");
  const [tocCollapsed, setTocCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [tocWidth, setTocWidth] = useState(270);
  const [chatWidth, setChatWidth] = useState(390);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("book-viewer-layout-v1");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as {
        tocWidth?: number;
        chatWidth?: number;
        tocCollapsed?: boolean;
        chatCollapsed?: boolean;
      };
      if (parsed.tocWidth) setTocWidth(clamp(parsed.tocWidth, 210, 440));
      if (parsed.chatWidth) setChatWidth(clamp(parsed.chatWidth, 320, 620));
      if (typeof parsed.tocCollapsed === "boolean") setTocCollapsed(parsed.tocCollapsed);
      if (typeof parsed.chatCollapsed === "boolean") setChatCollapsed(parsed.chatCollapsed);
    } catch {
      window.localStorage.removeItem("book-viewer-layout-v1");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      "book-viewer-layout-v1",
      JSON.stringify({ tocWidth, chatWidth, tocCollapsed, chatCollapsed }),
    );
  }, [tocWidth, chatWidth, tocCollapsed, chatCollapsed]);

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
    Promise.all([api.getToc(activeDocumentId), api.listContents(activeDocumentId, activePage)])
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
  const latestTurn = turns.length ? turns[turns.length - 1] : undefined;

  function beginResize(side: "toc" | "chat", event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "toc" ? tocWidth : chatWidth;
    document.body.classList.add("is-resizing");

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      if (side === "toc") setTocWidth(clamp(startWidth + delta, 210, 440));
      else setChatWidth(clamp(startWidth - delta, 320, 620));
    };
    const onUp = () => {
      document.body.classList.remove("is-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

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
    setTurns((current) => [...current, { id, question: clean, answer: "", sources: [], pending: true }]);
    setQuestion("");
    setAssistantTab("assistant");

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
      if (mode === "agent") await streamAgent(clean, selectedIds, topK, handlers, controller.signal);
      else await streamRag(clean, selectedIds, topK, handlers, controller.signal);
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      const message = error instanceof Error ? error.message : String(error);
      setTurns((current) =>
        current.map((turn) => (turn.id === id ? { ...turn, pending: false, error: message } : turn)),
      );
    }
  }

  const gridStyle = {
    gridTemplateColumns: `${tocCollapsed ? 0 : tocWidth}px ${tocCollapsed ? 0 : 6}px minmax(420px, 1fr) ${chatCollapsed ? 0 : 6}px ${chatCollapsed ? 0 : chatWidth}px`,
  };

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <div className="brand-block">
          <strong>LAH 기술문서</strong>
          <span>Book Viewer · Agentic RAG</span>
        </div>
        <div className="topbar-actions">
          {tocCollapsed ? <button type="button" onClick={() => setTocCollapsed(false)}>목차 열기</button> : null}
          {chatCollapsed ? <button type="button" onClick={() => setChatCollapsed(false)}>AI 비서 열기</button> : null}
          <span className="status-pill">문서 {documents.length}개 · 선택 {selectedIds.length}개</span>
        </div>
      </header>

      {startupError ? <div className="global-error">{startupError}</div> : null}

      <section className="workspace-grid" style={gridStyle}>
        <aside className={`document-pane panel ${tocCollapsed ? "collapsed" : ""}`}>
          <div className="panel-heading compact-heading">
            <div>
              <h2>목차 · 검색 범위</h2>
              <p>검색 문서를 선택하고 목차로 이동합니다.</p>
            </div>
            <button type="button" className="icon-button" onClick={() => setTocCollapsed(true)} aria-label="목차 닫기">‹</button>
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
            <div className="section-label">Document outline</div>
            {toc.length ? <TocTree nodes={toc} onPick={openToc} /> : <div className="muted">목차 없음</div>}
          </div>
        </aside>

        <div className={`resize-handle ${tocCollapsed ? "hidden" : ""}`} onPointerDown={(event) => beginResize("toc", event)} />

        <section className="viewer-pane panel">
          <div className="panel-heading viewer-heading">
            <div>
              <h2>{activeDocument?.title ?? "문서 선택"}</h2>
              <p>
                {activePage ? `페이지 ${activePage}` : "전체 구조화 본문"}
                {focusContentId ? ` · content #${focusContentId}` : ""}
              </p>
            </div>
            <div className="viewer-tools">
              {activePage ? (
                <div className="segmented compact">
                  <button type="button" className={renderMode === "structured" ? "active" : ""} onClick={() => setRenderMode("structured")}>구조화</button>
                  <button type="button" className={renderMode === "original" ? "active" : ""} onClick={() => setRenderMode("original")}>원본</button>
                </div>
              ) : null}
              {activePage ? <button type="button" className="ghost-button" onClick={() => setActivePage(undefined)}>전체 보기</button> : null}
            </div>
          </div>
          <div className="viewer-scroll">
            {loadingViewer ? (
              <div className="empty-state">문서를 불러오는 중...</div>
            ) : activeDocumentId && activePage ? (
              <>
                <DocumentCanvas
                  documentId={activeDocumentId}
                  page={activePage}
                  contents={contents}
                  focusContentId={focusContentId}
                  mode={renderMode}
                />
                <details className="page-text-details">
                  <summary>페이지 구조화 텍스트 보기</summary>
                  <StructuredList contents={contents} focusContentId={focusContentId} />
                </details>
              </>
            ) : (
              <StructuredList contents={contents} focusContentId={focusContentId} />
            )}
          </div>
        </section>

        <div className={`resize-handle ${chatCollapsed ? "hidden" : ""}`} onPointerDown={(event) => beginResize("chat", event)} />

        <aside className={`chat-pane panel ${chatCollapsed ? "collapsed" : ""}`}>
          <div className="assistant-header">
            <div className="assistant-tabs">
              <button type="button" className={assistantTab === "assistant" ? "active" : ""} onClick={() => setAssistantTab("assistant")}>AI 비서</button>
              <button type="button" className={assistantTab === "process" ? "active" : ""} onClick={() => setAssistantTab("process")}>Agent Process</button>
            </div>
            <button type="button" className="icon-button" onClick={() => setChatCollapsed(true)} aria-label="AI 비서 닫기">›</button>
          </div>

          {assistantTab === "assistant" ? (
            <>
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

              <SourceDock turn={latestTurn} onOpen={openSource} />

              <div className="chat-log">
                {!turns.length ? (
                  <div className="empty-chat">
                    <strong>선택한 문서에 대해 질문하세요.</strong>
                    <p>검색된 참조 문서가 먼저 표시되고 그 아래에서 답변이 스트리밍됩니다.</p>
                  </div>
                ) : null}
                {turns.map((turn) => (
                  <article key={turn.id} className="chat-turn">
                    <div className="user-message">{turn.question}</div>
                    <div className="assistant-message">
                      <div className="answer-label">답변</div>
                      <div className="answer-text">
                        {turn.answer || (turn.pending ? "근거를 확인하고 답변을 생성하는 중..." : "")}
                        {turn.pending ? <span className="cursor" /> : null}
                      </div>
                      {turn.error ? <div className="turn-error">{turn.error}</div> : null}
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
            </>
          ) : (
            <div className="process-pane">
              <div className="process-intro">
                <strong>Agent 실행 과정</strong>
                <p>질문별 검색 도구, 재작성된 검색어, 선택 이유를 확인합니다.</p>
              </div>
              {turns.filter((turn) => turn.plan).length ? (
                [...turns].reverse().map((turn) =>
                  turn.plan ? (
                    <article key={turn.id} className="process-card">
                      <div className="process-status"><span className={turn.pending ? "running" : "done"} />{turn.pending ? "실행 중" : "완료"}</div>
                      <h3>{turn.question}</h3>
                      <dl>
                        <div><dt>Tool</dt><dd>{turn.plan.tool}</dd></div>
                        <div><dt>Query</dt><dd>{turn.plan.query}</dd></div>
                        <div><dt>Top K</dt><dd>{turn.plan.top_k}</dd></div>
                        <div><dt>Reason</dt><dd>{turn.plan.rationale || "-"}</dd></div>
                        <div><dt>Sources</dt><dd>{turn.sources.length}</dd></div>
                      </dl>
                    </article>
                  ) : null,
                )
              ) : (
                <div className="empty-state">Agent 질문을 실행하면 과정이 여기에 표시됩니다.</div>
              )}
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
