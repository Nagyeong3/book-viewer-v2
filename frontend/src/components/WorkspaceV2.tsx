"use client";

import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";

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

type LayoutState = {
  tocWidth: number;
  chatWidth: number;
  tocCollapsed: boolean;
  chatCollapsed: boolean;
};

const LAYOUT_KEY = "book-viewer-layout-v1";
const CHAT_KEY = "book-viewer-chat-v1";
const MAX_SAVED_TURNS = 30;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function headingTag(level: number | null) {
  const normalized = clamp(level ?? 3, 1, 6);
  return `h${normalized}` as keyof JSX.IntrinsicElements;
}

function SemanticBlock({ item }: { item: ContentItem }) {
  const text = item.text?.trim();
  const isHeading = item.content_type === "title" || item.content_type === "sub_title";
  if (isHeading) {
    const Tag = headingTag(item.doc_level);
    return <Tag className={`semantic-heading semantic-heading-${clamp(item.doc_level ?? 3, 1, 6)}`}>{text || "제목"}</Tag>;
  }
  if (item.content_type === "image" || item.content_type === "table") {
    return <div className={`coordinate-placeholder ${item.content_type}`}>{text || (item.content_type === "image" ? "이미지 영역" : "표 영역")}</div>;
  }
  return <div className="coordinate-text">{text || ""}</div>;
}

function CoordinatePage({ contents, focusContentId }: { contents: ContentItem[]; focusContentId: number | null }) {
  const positioned = useMemo(() => contents.filter((item) => item.bbox), [contents]);
  const bounds = useMemo(() => {
    const maxX = Math.max(1, ...positioned.map((item) => item.bbox?.xmax ?? 0));
    const maxY = Math.max(1, ...positioned.map((item) => item.bbox?.ymax ?? 0));
    return { width: maxX * 1.03, height: maxY * 1.03 };
  }, [positioned]);

  if (!positioned.length) {
    return <div className="coordinate-empty">이 페이지에는 좌표 데이터가 없습니다.</div>;
  }

  return (
    <div className="coordinate-page-shell">
      <div className="coordinate-page" style={{ aspectRatio: `${bounds.width} / ${bounds.height}` }}>
        {positioned.map((item) => {
          const box = item.bbox!;
          const left = (box.xmin / bounds.width) * 100;
          const top = (box.ymin / bounds.height) * 100;
          const width = Math.max(((box.xmax - box.xmin) / bounds.width) * 100, 0.5);
          const height = Math.max(((box.ymax - box.ymin) / bounds.height) * 100, 0.5);
          return (
            <div
              key={item.id}
              className={`coordinate-block ${focusContentId === item.id ? "focused" : ""} type-${item.content_type ?? "unknown"}`}
              style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, minHeight: `${height}%` }}
              title={`content #${item.id}${item.page ? ` · p.${item.page}` : ""}`}
            >
              <SemanticBlock item={item} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

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

function SourceDock({ turn, onOpen }: { turn: ChatTurn | undefined; onOpen: (source: RagSource) => void }) {
  if (!turn) return null;
  return (
    <section className="source-dock" aria-label="참조 문서">
      <div className="source-dock-heading">
        <div>
          <strong>참조 문서</strong>
          <small>검색 근거가 먼저 표시되고, 그 아래에서 답변이 생성됩니다.</small>
        </div>
        <span>{turn.sources.length}</span>
      </div>
      {turn.sources.length ? (
        <div className="source-strip">
          {turn.sources.map((source) => (
            <button key={source.source_id} type="button" onClick={() => onOpen(source)}>
              <span className="source-id">{source.source_id}</span>
              <span className="source-copy">
                <strong>{source.title_path.join(" > ") || `content #${source.content_id}`}</strong>
                <small>{source.document_name}{source.page ? ` · p.${source.page}` : ""}</small>
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

export default function WorkspaceV2() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<number | null>(null);
  const [toc, setToc] = useState<TocNode[]>([]);
  const [contents, setContents] = useState<ContentItem[]>([]);
  const [activePage, setActivePage] = useState<number | undefined>();
  const [focusContentId, setFocusContentId] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<Mode>("agent");
  const [assistantTab, setAssistantTab] = useState<AssistantTab>("assistant");
  const [topK, setTopK] = useState(5);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [loadingViewer, setLoadingViewer] = useState(false);
  const [startupError, setStartupError] = useState("");
  const [layout, setLayout] = useState<LayoutState>({ tocWidth: 290, chatWidth: 410, tocCollapsed: false, chatCollapsed: false });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const savedLayout = window.localStorage.getItem(LAYOUT_KEY);
      if (savedLayout) {
        const parsed = JSON.parse(savedLayout) as Partial<LayoutState>;
        setLayout((current) => ({
          tocWidth: parsed.tocWidth ? clamp(parsed.tocWidth, 220, 460) : current.tocWidth,
          chatWidth: parsed.chatWidth ? clamp(parsed.chatWidth, 340, 660) : current.chatWidth,
          tocCollapsed: typeof parsed.tocCollapsed === "boolean" ? parsed.tocCollapsed : current.tocCollapsed,
          chatCollapsed: typeof parsed.chatCollapsed === "boolean" ? parsed.chatCollapsed : current.chatCollapsed,
        }));
      }
      const savedChat = window.localStorage.getItem(CHAT_KEY);
      if (savedChat) {
        const restored = JSON.parse(savedChat) as ChatTurn[];
        setTurns(restored.map((turn) => ({ ...turn, pending: false })).slice(-MAX_SAVED_TURNS));
      }
    } catch {
      window.localStorage.removeItem(LAYOUT_KEY);
      window.localStorage.removeItem(CHAT_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  }, [layout]);

  useEffect(() => {
    const stable = turns.map((turn) => ({ ...turn, pending: false })).slice(-MAX_SAVED_TURNS);
    window.localStorage.setItem(CHAT_KEY, JSON.stringify(stable));
  }, [turns]);

  useEffect(() => {
    api.listDocuments().then((items) => {
      setDocuments(items);
      if (items.length) {
        setSelectedIds([items[0].id]);
        setActiveDocumentId(items[0].id);
      }
    }).catch((error: Error) => setStartupError(error.message));
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
    return () => { cancelled = true; };
  }, [activeDocumentId, activePage]);

  const activeDocument = useMemo(() => documents.find((document) => document.id === activeDocumentId) ?? null, [documents, activeDocumentId]);
  const latestTurn = turns.length ? turns[turns.length - 1] : undefined;

  function toggleDocument(documentId: number) {
    setSelectedIds((current) => current.includes(documentId)
      ? (current.length === 1 ? current : current.filter((id) => id !== documentId))
      : [...current, documentId]);
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

  function beginResize(side: "toc" | "chat", event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "toc" ? layout.tocWidth : layout.chatWidth;
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      setLayout((current) => ({
        ...current,
        [side === "toc" ? "tocWidth" : "chatWidth"]: side === "toc"
          ? clamp(startWidth + delta, 220, 460)
          : clamp(startWidth - delta, 340, 660),
      }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
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
      onPlan: (plan: AgentPlan) => setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, plan } : turn)),
      onSources: (sources: RagSource[]) => setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, sources } : turn)),
      onToken: (token: string) => setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, answer: turn.answer + token } : turn)),
      onDone: () => setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, pending: false } : turn)),
    };

    try {
      if (mode === "agent") await streamAgent(clean, selectedIds, topK, handlers, controller.signal);
      else await streamRag(clean, selectedIds, topK, handlers, controller.signal);
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      const message = error instanceof Error ? error.message : String(error);
      setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, pending: false, error: message } : turn));
    }
  }

  const gridStyle = {
    gridTemplateColumns: `${layout.tocCollapsed ? 0 : layout.tocWidth}px ${layout.tocCollapsed ? 0 : 6}px minmax(460px, 1fr) ${layout.chatCollapsed ? 0 : 6}px ${layout.chatCollapsed ? 0 : layout.chatWidth}px`,
  };

  return (
    <main className="workspace-shell workspace-v2">
      <header className="topbar">
        <div className="brand-block"><strong>LAH 기술문서</strong><span>Book Viewer · Agentic RAG</span></div>
        <div className="topbar-actions">
          {layout.tocCollapsed ? <button type="button" onClick={() => setLayout((current) => ({ ...current, tocCollapsed: false }))}>목차 열기</button> : null}
          {layout.chatCollapsed ? <button type="button" onClick={() => setLayout((current) => ({ ...current, chatCollapsed: false }))}>AI 비서 열기</button> : null}
          <span className="status-pill">문서 {documents.length}개 · 선택 {selectedIds.length}개</span>
        </div>
      </header>

      {startupError ? <div className="global-error">{startupError}</div> : null}

      <section className="workspace-grid" style={gridStyle}>
        <aside className={`document-pane panel ${layout.tocCollapsed ? "collapsed" : ""}`}>
          <div className="panel-heading compact-heading">
            <div><h2>목차 · 검색 범위</h2><p>검색 문서를 선택하고 목차로 이동합니다.</p></div>
            <button type="button" className="icon-button" onClick={() => setLayout((current) => ({ ...current, tocCollapsed: true }))}>‹</button>
          </div>
          <div className="document-picker">
            <div className="section-label">검색 문서</div>
            <div className="document-list document-list-large">
              {documents.map((document) => {
                const selected = selectedIds.includes(document.id);
                return (
                  <button key={document.id} type="button" className={`document-item ${selected ? "selected" : ""} ${activeDocumentId === document.id ? "active" : ""}`} onClick={() => toggleDocument(document.id)}>
                    <span className="checkbox-mark">{selected ? "✓" : ""}</span>
                    <span><strong>{document.title}</strong><small>Document #{document.id}</small></span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="toc-section"><div className="section-label">Document outline</div>{toc.length ? <TocTree nodes={toc} onPick={openToc} /> : <div className="muted">목차 없음</div>}</div>
        </aside>

        <div className={`resize-handle ${layout.tocCollapsed ? "hidden" : ""}`} onPointerDown={(event) => beginResize("toc", event)} />

        <section className="viewer-pane panel">
          <div className="panel-heading viewer-heading">
            <div><h2>{activeDocument?.title ?? "문서 선택"}</h2><p>{activePage ? `페이지 ${activePage}` : "전체 구조화 본문"}{focusContentId ? ` · content #${focusContentId}` : ""}</p></div>
            {activePage ? <button type="button" className="ghost-button" onClick={() => setActivePage(undefined)}>전체 보기</button> : null}
          </div>
          <div className="viewer-scroll">
            {loadingViewer ? <div className="empty-state">문서를 불러오는 중...</div> : activePage ? <CoordinatePage contents={contents} focusContentId={focusContentId} /> : <div className="semantic-document semantic-document-full">{contents.map((item) => <article key={item.id} className={`semantic-row ${focusContentId === item.id ? "focused" : ""}`}><div className="content-meta"><span>#{item.id}</span><span>{item.content_type ?? "unknown"}</span>{item.page ? <span>p.{item.page}</span> : null}</div><SemanticBlock item={item} /></article>)}</div>}
          </div>
        </section>

        <div className={`resize-handle ${layout.chatCollapsed ? "hidden" : ""}`} onPointerDown={(event) => beginResize("chat", event)} />

        <aside className={`chat-pane panel ${layout.chatCollapsed ? "collapsed" : ""}`}>
          <div className="assistant-header">
            <div className="assistant-tabs">
              <button type="button" className={assistantTab === "assistant" ? "active" : ""} onClick={() => setAssistantTab("assistant")}>AI 비서</button>
              <button type="button" className={assistantTab === "process" ? "active" : ""} onClick={() => setAssistantTab("process")}>Agent Process</button>
            </div>
            <button type="button" className="icon-button" onClick={() => setLayout((current) => ({ ...current, chatCollapsed: true }))}>›</button>
          </div>

          {assistantTab === "assistant" ? (
            <>
              <div className="chat-controls"><div className="segmented"><button type="button" className={mode === "agent" ? "active" : ""} onClick={() => setMode("agent")}>Agent</button><button type="button" className={mode === "rag" ? "active" : ""} onClick={() => setMode("rag")}>Hybrid RAG</button></div><label>Top K<select value={topK} onChange={(event) => setTopK(Number(event.target.value))}>{[3, 5, 8, 10].map((value) => <option key={value}>{value}</option>)}</select></label></div>
              <SourceDock turn={latestTurn} onOpen={openSource} />
              <div className="chat-log">
                {!turns.length ? <div className="empty-chat"><strong>선택한 문서에 질문하세요.</strong><p>근거 문서를 먼저 보여주고 답변을 스트리밍합니다.</p></div> : null}
                {turns.map((turn) => <article key={turn.id} className="chat-turn"><div className="user-message">{turn.question}</div><div className="assistant-message"><div className="answer-text">{turn.answer || (turn.pending ? "답변 생성 중..." : "")}{turn.pending ? <span className="cursor" /> : null}</div>{turn.error ? <div className="turn-error">{turn.error}</div> : null}</div></article>)}
              </div>
              <form className="question-form" onSubmit={submitQuestion}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="선택한 문서에 대해 질문하세요" rows={3} /><div><span>{selectedIds.length}개 문서 범위 · 대화는 이 브라우저에 임시 저장</span><button type="submit" disabled={!question.trim() || !selectedIds.length}>질문 전송</button></div></form>
            </>
          ) : (
            <div className="process-pane">{latestTurn?.plan ? <><div className="process-status">{latestTurn.pending ? "실행 중" : "완료"}</div><dl><div><dt>Tool</dt><dd>{latestTurn.plan.tool}</dd></div><div><dt>Query</dt><dd>{latestTurn.plan.query}</dd></div><div><dt>Top K</dt><dd>{latestTurn.plan.top_k}</dd></div><div><dt>Reason</dt><dd>{latestTurn.plan.rationale || "-"}</dd></div><div><dt>Sources</dt><dd>{latestTurn.sources.length}</dd></div></dl></> : <div className="empty-chat"><strong>아직 Agent 실행 내역이 없습니다.</strong><p>Agent 모드로 질문하면 이 탭에서 계획을 확인할 수 있습니다.</p></div>}</div>
          )}
        </aside>
      </section>
    </main>
  );
}
