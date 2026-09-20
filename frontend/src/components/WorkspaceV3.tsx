"use client";

import {
  createElement,
  FormEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AgentPlan,
  api,
  ContentItem,
  DocumentIndexStatus,
  DocumentSummary,
  RagSource,
  streamAgent,
  streamRag,
  TocNode,
} from "../lib/api";
import { getSafeImageUrl } from "../lib/seaweed";
import TableHtml from "./TableHtml";

type Mode = "agent" | "rag";
type AssistantTab = "assistant" | "process";
type ChatTurn = { id: number; question: string; answer: string; sources: RagSource[]; plan?: AgentPlan; pending: boolean; error?: string };
type LayoutState = { tocWidth: number; chatWidth: number; tocCollapsed: boolean; chatCollapsed: boolean };
type PageSize = { width: number; height: number };
type ChapterRange = { id: number; title: string; startPage: number; endPage: number };

const LAYOUT_KEY = "book-viewer-layout-v1";
const CHAT_KEY = "book-viewer-chat-v1";
const MAX_SAVED_TURNS = 30;
const DEFAULT_PAGE_SIZE: PageSize = { width: 1250, height: 1755 };
const pageSizeCache = new Map<number, PageSize>();
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function headingTag(level: number | null): "h1" | "h2" | "h3" | "h4" | "h5" | "h6" {
  const normalized = clamp(level ?? 3, 1, 6);
  return `h${normalized}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
}

function firstPage(nodes: TocNode[]): number | null {
  for (const node of nodes) {
    if (node.page) return node.page;
    const nested = firstPage(node.children ?? []);
    if (nested) return nested;
  }
  return null;
}

function maxPage(nodes: TocNode[]): number {
  let value = 1;
  for (const node of nodes) {
    if (node.page) value = Math.max(value, node.page);
    if (node.children?.length) value = Math.max(value, maxPage(node.children));
  }
  return value;
}

function flattenToc(nodes: TocNode[]): TocNode[] {
  return nodes.flatMap((node) => [node, ...flattenToc(node.children ?? [])]);
}

function tocNodeForVisiblePage(nodes: TocNode[], page: number): TocNode | null {
  const candidates = flattenToc(nodes)
    .filter((node) => node.page != null && node.page <= page)
    .sort((a, b) => (b.page ?? 0) - (a.page ?? 0) || b.doc_level - a.doc_level || b.order_index - a.order_index);
  return candidates[0] ?? null;
}

function levelOneChapters(toc: TocNode[]): ChapterRange[] {
  const roots = toc
    .filter((node) => node.doc_level === 1)
    .map((node) => ({ node, page: node.page ?? firstPage(node.children ?? []) }))
    .filter((item): item is { node: TocNode; page: number } => Boolean(item.page))
    .sort((a, b) => a.page - b.page || a.node.order_index - b.node.order_index);
  const documentMax = maxPage(toc);
  return roots.map((item, index) => ({
    id: item.node.id,
    title: item.node.text,
    startPage: item.page,
    endPage: index + 1 < roots.length ? Math.max(item.page, roots[index + 1].page - 1) : documentMax,
  }));
}

function chapterForPage(toc: TocNode[], page: number): ChapterRange {
  const chapters = levelOneChapters(toc);
  const exact = chapters.find((chapter) => page >= chapter.startPage && page <= chapter.endPage);
  if (exact) return exact;
  const previous = [...chapters].reverse().find((chapter) => chapter.startPage <= page);
  if (previous) return { ...previous, endPage: Math.max(previous.endPage, page) };
  return { id: -page, title: "문서", startPage: page, endPage: page };
}

function SemanticBlock({ item }: { item: ContentItem }) {
  const text = item.text?.trim();
  if (item.content_type === "title" || item.content_type === "sub_title") {
    return createElement(headingTag(item.doc_level), { className: `semantic-heading semantic-heading-${clamp(item.doc_level ?? 3, 1, 6)}` }, text || "제목");
  }
  if (item.content_type === "image") {
    const src = getSafeImageUrl(item.cropped_image_path);
    return src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="coordinate-cropped-image" src={src} alt={text || `content ${item.id}`} loading="lazy" />
    ) : <div className="coordinate-placeholder image">이미지 경로 없음</div>;
  }
  if (item.content_type === "table") return <TableHtml html={text} />;
  return <div className="coordinate-text">{text || ""}</div>;
}

function DocumentPage({ page, contents, pageSize, focusContentId }: { page: number; contents: ContentItem[]; pageSize: PageSize; focusContentId: number | null }) {
  const positioned = contents.filter((item) => item.bbox && item.page === page);
  return (
    <article className="chapter-page-frame" data-page={page}>
      <div className="chapter-page-toolbar"><span>p.{page}</span><span>{positioned.length}개 영역</span></div>
      <div className={`chapter-page-paper ${pageSize.width > pageSize.height ? "landscape" : "portrait"}`} style={{ aspectRatio: `${pageSize.width} / ${pageSize.height}` }}>
        {positioned.map((item) => {
          const box = item.bbox!;
          const left = (box.xmin / pageSize.width) * 100;
          const top = (box.ymin / pageSize.height) * 100;
          const width = ((box.xmax - box.xmin) / pageSize.width) * 100;
          const height = ((box.ymax - box.ymin) / pageSize.height) * 100;
          return (
            <div
              key={item.id}
              id={`content-${item.id}`}
              className={`coordinate-block type-${item.content_type ?? "unknown"} ${focusContentId === item.id ? "focused" : ""}`}
              style={{ left: `${left}%`, top: `${top}%`, width: `${Math.max(width, 0.2)}%`, height: `${Math.max(height, 0.2)}%` }}
            >
              <SemanticBlock item={item} />
            </div>
          );
        })}
      </div>
    </article>
  );
}

function TocTree({
  nodes,
  activeTocId,
  expandedIds,
  onPick,
  onToggle,
}: {
  nodes: TocNode[];
  activeTocId: number | null;
  expandedIds: Set<number>;
  onPick: (node: TocNode) => void;
  onToggle: (nodeId: number) => void;
}) {
  return (
    <ul className="toc-tree">
      {nodes.map((node) => {
        const hasChildren = Boolean(node.children?.length);
        const expanded = hasChildren && expandedIds.has(node.id);
        return (
          <li key={node.id}>
            <div className="toc-row">
              {hasChildren ? (
                <button
                  type="button"
                  className="toc-toggle"
                  aria-label={expanded ? "목차 접기" : "목차 펼치기"}
                  aria-expanded={expanded}
                  onClick={() => onToggle(node.id)}
                >
                  {expanded ? "▾" : "▸"}
                </button>
              ) : <span className="toc-toggle-spacer" />}
              <button type="button" className={node.id === activeTocId ? "active toc-link" : "toc-link"} onClick={() => onPick(node)}>
                <span className="toc-num">{node.title_num}</span><span>{node.text}</span>{node.page ? <small>p.{node.page}</small> : null}
              </button>
            </div>
            {hasChildren && expanded ? (
              <TocTree nodes={node.children ?? []} activeTocId={activeTocId} expandedIds={expandedIds} onPick={onPick} onToggle={onToggle} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function SourceDock({ turn, onOpen }: { turn: ChatTurn | undefined; onOpen: (source: RagSource) => void }) {
  if (!turn) return null;
  return (
    <section className="source-dock" aria-label="참조 문서">
      <div className="source-dock-heading"><div><strong>참조 문서</strong><small>검색 근거가 먼저 표시되고, 그 아래에서 답변이 생성됩니다.</small></div><span>{turn.sources.length}</span></div>
      {turn.sources.length ? <div className="source-strip">{turn.sources.map((source) => (
        <button key={source.source_id} type="button" onClick={() => onOpen(source)}><span className="source-id">{source.source_id}</span><span className="source-copy"><strong>{source.title_path.join(" > ") || `content #${source.content_id}`}</strong><small>{source.document_name}{source.page ? ` · p.${source.page}` : ""}</small></span></button>
      ))}</div> : <div className="source-waiting">{turn.pending ? "관련 문서를 검색 중입니다..." : "참조 문서가 없습니다."}</div>}
    </section>
  );
}

export default function WorkspaceV3() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [indexStatuses, setIndexStatuses] = useState<Record<number, DocumentIndexStatus>>({});
  const [documentQuery, setDocumentQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<number | null>(null);
  const [toc, setToc] = useState<TocNode[]>([]);
  const [chapter, setChapter] = useState<ChapterRange | null>(null);
  const [pageContents, setPageContents] = useState<Record<number, ContentItem[]>>({});
  const [activePage, setActivePage] = useState<number | null>(null);
  const [loadAnchorPage, setLoadAnchorPage] = useState<number | null>(null);
  const [activeTocId, setActiveTocId] = useState<number | null>(null);
  const [expandedTocIds, setExpandedTocIds] = useState<Set<number>>(() => new Set());
  const [loadingEdge, setLoadingEdge] = useState<"top" | "bottom" | null>(null);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [pageSizeError, setPageSizeError] = useState("");
  const [focusContentId, setFocusContentId] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<Mode>("agent");
  const [assistantTab, setAssistantTab] = useState<AssistantTab>("assistant");
  const [topK, setTopK] = useState(5);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [startupError, setStartupError] = useState("");
  const [layout, setLayout] = useState<LayoutState>({ tocWidth: 310, chatWidth: 420, tocCollapsed: false, chatCollapsed: false });
  const abortRef = useRef<AbortController | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const loadedPagesRef = useRef(new Set<number>());
  const inFlightRef = useRef(new Set<number>());
  const generationRef = useRef(0);
  const pageSizeLoadingRef = useRef(false);
  const pendingScrollPageRef = useRef<number | null>(null);
  const tocManualLockUntilRef = useRef(0);

  useEffect(() => {
    try {
      const savedLayout = window.localStorage.getItem(LAYOUT_KEY);
      if (savedLayout) setLayout((current) => ({ ...current, ...JSON.parse(savedLayout) }));
      const savedChat = window.localStorage.getItem(CHAT_KEY);
      if (savedChat) setTurns((JSON.parse(savedChat) as ChatTurn[]).map((turn) => ({ ...turn, pending: false })).slice(-MAX_SAVED_TURNS));
    } catch {
      window.localStorage.removeItem(LAYOUT_KEY);
      window.localStorage.removeItem(CHAT_KEY);
    }
  }, []);
  useEffect(() => { window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); }, [layout]);
  useEffect(() => { window.localStorage.setItem(CHAT_KEY, JSON.stringify(turns.map((turn) => ({ ...turn, pending: false })).slice(-MAX_SAVED_TURNS))); }, [turns]);

  useEffect(() => {
    api.listDocuments().then((items) => {
      setDocuments(items);
      if (items.length) { setSelectedIds([items[0].id]); setActiveDocumentId(items[0].id); }
    }).catch((error: Error) => setStartupError(error.message));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshStatuses = async () => {
      try {
        const statuses = await api.listIndexStatuses();
        if (!cancelled) {
          setIndexStatuses(Object.fromEntries(statuses.map((status) => [status.document_id, status])));
        }
      } catch {
        // Viewer stays usable even when index status is temporarily unavailable.
      }
    };
    void refreshStatuses();
    const timer = window.setInterval(() => { void refreshStatuses(); }, 5000);
    const onChanged = () => { void refreshStatuses(); };
    window.addEventListener("book-viewer:index-status-changed", onChanged);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("book-viewer:index-status-changed", onChanged);
    };
  }, []);

  useEffect(() => {
    if (!activeDocumentId) return;
    let cancelled = false;
    pageSizeLoadingRef.current = false;
    setPageSize(pageSizeCache.get(activeDocumentId) ?? DEFAULT_PAGE_SIZE);
    setPageSizeError("");
    setActiveTocId(null);
    api.getToc(activeDocumentId).then((items) => {
      if (cancelled) return;
      setToc(items);
      setExpandedTocIds(new Set(items.filter((node) => node.doc_level === 1 && node.children?.length).map((node) => node.id)));
      const start = firstPage(items) ?? 1;
      setActivePage(start);
      setLoadAnchorPage(start);
      setActiveTocId(tocNodeForVisiblePage(items, start)?.id ?? null);
      setChapter(chapterForPage(items, start));
    }).catch((error: Error) => { if (!cancelled) setStartupError(error.message); });
    return () => { cancelled = true; };
  }, [activeDocumentId]);

  const ensurePageSize = useCallback((items: ContentItem[]) => {
    if (!activeDocumentId || pageSizeCache.has(activeDocumentId) || pageSizeLoadingRef.current) return;
    const path = items.find((item) => item.doc_image_path)?.doc_image_path;
    const src = getSafeImageUrl(path);
    if (!src) {
      setPageSize(DEFAULT_PAGE_SIZE);
      setPageSizeError("기본 페이지 규격 1250 × 1755를 사용 중입니다.");
      return;
    }
    pageSizeLoadingRef.current = true;
    const image = new Image();
    image.onload = () => {
      pageSizeLoadingRef.current = false;
      if (!image.naturalWidth || !image.naturalHeight) return;
      const measured = { width: image.naturalWidth, height: image.naturalHeight };
      pageSizeCache.set(activeDocumentId, measured);
      setPageSize(measured);
      setPageSizeError("");
    };
    image.onerror = () => {
      pageSizeLoadingRef.current = false;
      setPageSize(DEFAULT_PAGE_SIZE);
      setPageSizeError("이미지 서버를 사용할 수 없어 기본 페이지 규격 1250 × 1755를 사용 중입니다.");
    };
    image.src = src;
  }, [activeDocumentId]);

  const documentMaxPage = useMemo(() => maxPage(toc), [toc]);

  const fetchPage = useCallback(async (page: number, preservePrepend = false) => {
    if (!activeDocumentId || page < 1 || page > documentMaxPage) return;
    if (loadedPagesRef.current.has(page) || inFlightRef.current.has(page)) return;
    const generation = generationRef.current;
    const scroller = viewerRef.current;
    const beforeHeight = preservePrepend && scroller ? scroller.scrollHeight : 0;
    const beforeTop = preservePrepend && scroller ? scroller.scrollTop : 0;
    inFlightRef.current.add(page);
    try {
      const items = await api.listContents(activeDocumentId, page);
      if (generation !== generationRef.current) return;
      ensurePageSize(items);
      loadedPagesRef.current.add(page);
      setPageContents((current) => ({ ...current, [page]: items }));
      if (preservePrepend && scroller) requestAnimationFrame(() => requestAnimationFrame(() => { scroller.scrollTop = beforeTop + (scroller.scrollHeight - beforeHeight); }));
    } catch (error) {
      if (generation === generationRef.current) setStartupError(error instanceof Error ? error.message : String(error));
    } finally {
      inFlightRef.current.delete(page);
    }
  }, [activeDocumentId, documentMaxPage, ensurePageSize]);

  useEffect(() => {
    if (!activeDocumentId || !loadAnchorPage) return;
    generationRef.current += 1;
    loadedPagesRef.current.clear();
    inFlightRef.current.clear();
    setLoadingEdge(null);
    setPageContents({});
    const target = loadAnchorPage;
    console.debug(`[viewer] reset window anchor=${target}`);
    void fetchPage(target).then(() => {
      void fetchPage(target - 1, true);
      void fetchPage(target + 1);
    });
  }, [activeDocumentId, loadAnchorPage, fetchPage]);

  const loadedPages = useMemo(() => Object.keys(pageContents).map(Number).sort((a, b) => a - b), [pageContents]);

  useEffect(() => {
    const root = viewerRef.current;
    if (!root || !documentMaxPage) return;

    let cancelled = false;
    let running = false;
    const EDGE_PRELOAD_PX = 850;

    const loadEdge = async (side: "top" | "bottom") => {
      if (cancelled || running) return;
      const pages = Array.from(loadedPagesRef.current).sort((a, b) => a - b);
      if (!pages.length) return;
      const next = side === "top" ? pages[0] - 1 : pages[pages.length - 1] + 1;
      if (next < 1 || next > documentMaxPage) {
        console.debug(`[viewer] document boundary side=${side} next=${next} max=${documentMaxPage}`);
        return;
      }

      running = true;
      setLoadingEdge(side);
      console.debug(`[viewer] request page=${next} side=${side}`);
      await fetchPage(next, side === "top");
      console.debug(`[viewer] page=${next} finished loaded=${loadedPagesRef.current.has(next)}`);
      running = false;
      if (!cancelled) setLoadingEdge(null);

      requestAnimationFrame(() => {
        if (!cancelled) checkEdge();
      });
    };

    const checkEdge = () => {
      if (cancelled || running) return;
      const distanceBottom = root.scrollHeight - root.scrollTop - root.clientHeight;
      if (distanceBottom <= EDGE_PRELOAD_PX) {
        console.debug(`[viewer] edge check bottom distance=${Math.round(distanceBottom)}`);
        void loadEdge("bottom");
        return;
      }
      if (root.scrollTop <= EDGE_PRELOAD_PX) {
        console.debug(`[viewer] edge check top distance=${Math.round(root.scrollTop)}`);
        void loadEdge("top");
      }
    };

    root.addEventListener("scroll", checkEdge, { passive: true });
    const resizeObserver = new ResizeObserver(checkEdge);
    resizeObserver.observe(root);
    requestAnimationFrame(checkEdge);

    return () => {
      cancelled = true;
      root.removeEventListener("scroll", checkEdge);
      resizeObserver.disconnect();
    };
  }, [documentMaxPage, fetchPage, loadedPages.length]);

  useEffect(() => {
    const root = viewerRef.current;
    if (!root) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const page = Number((visible.target as HTMLElement).dataset.page);
      if (!page) return;
      setActivePage(page);
      setChapter(chapterForPage(toc, page));
      if (performance.now() >= tocManualLockUntilRef.current) {
        setActiveTocId(tocNodeForVisiblePage(toc, page)?.id ?? null);
      }
    }, { root, threshold: [0.35, 0.55, 0.75] });
    root.querySelectorAll(".chapter-page-frame").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [loadedPages.join(","), toc]);

  useEffect(() => {
    const page = pendingScrollPageRef.current;
    if (!page || !pageContents[page]) return;
    pendingScrollPageRef.current = null;
    requestAnimationFrame(() => {
      viewerRef.current?.querySelector<HTMLElement>(`.chapter-page-frame[data-page="${page}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (focusContentId) document.getElementById(`content-${focusContentId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [pageContents, focusContentId]);

  const activeDocument = useMemo(() => documents.find((document) => document.id === activeDocumentId) ?? null, [documents, activeDocumentId]);
  const latestTurn = turns.length ? turns[turns.length - 1] : undefined;
  const filteredDocuments = useMemo(() => {
    const query = documentQuery.trim().toLowerCase();
    return query ? documents.filter((document) => document.title.toLowerCase().includes(query) || String(document.id).includes(query)) : documents;
  }, [documents, documentQuery]);

  function openDocument(documentId: number) {
    if (documentId === activeDocumentId) return;
    setActiveDocumentId(documentId);
    setFocusContentId(null);
  }

  function toggleDocumentScope(documentId: number) {
    setSelectedIds((current) =>
      current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId],
    );
  }

  function selectAllDocuments() {
    setSelectedIds(documents.map((document) => document.id));
  }

  function clearDocumentScope() {
    setSelectedIds([]);
  }

  function navigateToPage(page: number, contentId: number | null = null) {
    const nextChapter = chapterForPage(toc, page);
    setFocusContentId(contentId);
    setActivePage(page);
    setChapter(nextChapter);
    pendingScrollPageRef.current = page;

    if (loadedPagesRef.current.has(page)) {
      requestAnimationFrame(() => viewerRef.current?.querySelector<HTMLElement>(`.chapter-page-frame[data-page="${page}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
      return;
    }

    setLoadAnchorPage(page);
  }

  function toggleToc(nodeId: number) {
    setExpandedTocIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  function openToc(node: TocNode) {
    const page = node.page ?? firstPage(node.children ?? []);
    setActiveTocId(node.id);
    tocManualLockUntilRef.current = performance.now() + 900;
    if (page) navigateToPage(page, node.id);
  }

  function openSource(source: RagSource) {
    pendingScrollPageRef.current = source.page ?? null;
    setFocusContentId(source.content_id);
    if (source.document_id !== activeDocumentId) setActiveDocumentId(source.document_id);
    else if (source.page) navigateToPage(source.page, source.content_id);
  }

  function beginResize(side: "toc" | "chat", event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "toc" ? layout.tocWidth : layout.chatWidth;
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      setLayout((current) => ({ ...current, [side === "toc" ? "tocWidth" : "chatWidth"]: side === "toc" ? clamp(startWidth + delta, 230, 480) : clamp(startWidth - delta, 350, 680) }));
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
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
    setQuestion(""); setAssistantTab("assistant");
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

  const gridStyle = { gridTemplateColumns: `${layout.tocCollapsed ? 0 : layout.tocWidth}px ${layout.tocCollapsed ? 0 : 6}px minmax(500px, 1fr) ${layout.chatCollapsed ? 0 : 6}px ${layout.chatCollapsed ? 0 : layout.chatWidth}px` };

  return (
    <main className="workspace-shell workspace-v3">
      <header className="topbar product-topbar"><div className="brand-block"><span className="brand-mark" aria-hidden="true">B</span><span className="brand-copy"><strong>기술문서 AI Viewer</strong><small>{activeDocument?.title ?? "문서를 선택하세요"}</small></span></div><div className="topbar-actions">{chapter ? <span className="chapter-pill"><span>현재 위치</span>{chapter.title} · p.{activePage ?? chapter.startPage}</span> : null}{layout.tocCollapsed ? <button type="button" className="topbar-ghost" onClick={() => setLayout((current) => ({ ...current, tocCollapsed: false }))}>목차 열기</button> : null}{layout.chatCollapsed ? <button type="button" className="topbar-ghost" onClick={() => setLayout((current) => ({ ...current, chatCollapsed: false }))}>AI 비서 열기</button> : null}<span className="status-pill"><span className="status-dot" />AI 검색 {selectedIds.length}개</span></div></header>
      {startupError ? <div className="global-error">{startupError}</div> : null}
      <section className="workspace-grid" style={gridStyle}>
        <aside className={`document-pane panel ${layout.tocCollapsed ? "collapsed" : ""}`}><div className="panel-heading compact-heading"><div><span className="panel-eyebrow">LIBRARY</span><h2>문서 탐색</h2><p>열람 문서와 AI 검색 범위를 관리합니다.</p></div><button type="button" className="icon-button" onClick={() => setLayout((current) => ({ ...current, tocCollapsed: true }))}>‹</button></div><div className="document-picker polished-picker"><input className="document-search" value={documentQuery} onChange={(event) => setDocumentQuery(event.target.value)} placeholder="문서명 또는 ID 검색" /><div className="scope-toolbar"><div><strong>AI 검색 범위</strong><span>{selectedIds.length}개 문서 선택</span></div><div><button type="button" onClick={selectAllDocuments} disabled={selectedIds.length === documents.length && documents.length > 0}>전체 선택</button><button type="button" onClick={clearDocumentScope} disabled={!selectedIds.length}>전체 해제</button></div></div><div className="document-list document-list-large">{filteredDocuments.map((document) => { const selected = selectedIds.includes(document.id); const active = activeDocumentId === document.id; const indexStatus = indexStatuses[document.id]; const ready = indexStatus?.state === "ready"; const running = indexStatus?.state === "queued" || indexStatus?.state === "indexing"; return <div key={document.id} className={`document-list-row ${active ? "active-row" : ""}`}><button type="button" className={`scope-checkbox ${selected ? "checked" : ""}`} aria-pressed={selected} aria-label={`${document.title} AI 검색 범위 ${selected ? "제외" : "포함"}`} onClick={() => toggleDocumentScope(document.id)}><span className="checkbox-mark">{selected ? "✓" : ""}</span></button><button type="button" className={`document-item ${active ? "active" : ""}`} onClick={() => openDocument(document.id)}><span className="document-copy"><span className="document-title-line"><strong>{document.title}</strong><span className={`document-index-badge ${ready ? "ready" : running ? "running" : "missing"}`}>{ready ? "RAG 준비" : running ? "구축 중" : "DB 미구축"}</span></span><small>Document #{document.id}{active ? " · 현재 열림" : ""}</small></span></button></div>; })}</div></div><div className="toc-section"><div className="section-label">목차</div>{toc.length ? <TocTree nodes={toc} activeTocId={activeTocId} expandedIds={expandedTocIds} onPick={openToc} onToggle={toggleToc} /> : <div className="muted">목차 없음</div>}</div></aside>
        <div className={`resize-handle toc-resize-handle ${layout.tocCollapsed ? "hidden" : ""}`} onPointerDown={(event) => beginResize("toc", event)} />
        <section className="viewer-pane panel chapter-viewer-panel"><div className="panel-heading viewer-heading sticky-viewer-heading"><div><span className="panel-eyebrow">DOCUMENT VIEWER</span><h2>{activeDocument?.title ?? "문서 선택"}</h2><p>{chapter ? `${chapter.title} · p.${chapter.startPage}–${chapter.endPage}` : "챕터를 불러오는 중"}</p></div><div className="viewer-status"><span>{pageSizeError || `${pageSize.width} × ${pageSize.height}`}</span><strong>p.{activePage ?? "-"}</strong></div></div><div className="viewer-scroll chapter-scroll" ref={viewerRef}><div className={`page-load-sentinel ${loadingEdge === "top" ? "edge-load-active" : ""}`}>{loadedPages.length && loadedPages[0] > 1 ? "이전 페이지 준비 중" : ""}</div>{loadedPages.map((page) => <DocumentPage key={page} page={page} contents={pageContents[page] ?? []} pageSize={pageSize} focusContentId={focusContentId} />)}<div className={`page-load-sentinel ${loadingEdge === "bottom" ? "edge-load-active" : ""}`}>{loadedPages.length && loadedPages[loadedPages.length - 1] < documentMaxPage ? "다음 페이지 준비 중" : ""}</div></div></section>
        <div className={`resize-handle chat-resize-handle ${layout.chatCollapsed ? "hidden" : ""}`} onPointerDown={(event) => beginResize("chat", event)} />
        <aside className={`chat-pane panel ${layout.chatCollapsed ? "collapsed" : ""}`}><div className="assistant-titlebar"><div><span className="panel-eyebrow">AI WORKSPACE</span><strong>문서 AI 비서</strong></div><button type="button" className="icon-button" onClick={() => setLayout((current) => ({ ...current, chatCollapsed: true }))}>›</button></div><div className="assistant-header"><div className="assistant-tabs"><button type="button" className={assistantTab === "assistant" ? "active" : ""} onClick={() => setAssistantTab("assistant")}>AI 비서</button><button type="button" className={assistantTab === "process" ? "active" : ""} onClick={() => setAssistantTab("process")}>Agent Process</button></div></div>{assistantTab === "assistant" ? <><div className="chat-controls"><div className="segmented"><button type="button" className={mode === "agent" ? "active" : ""} onClick={() => setMode("agent")}>Agent</button><button type="button" className={mode === "rag" ? "active" : ""} onClick={() => setMode("rag")}>Hybrid RAG</button></div><label>Top K<select value={topK} onChange={(event) => setTopK(Number(event.target.value))}>{[3,5,8,10].map((value) => <option key={value}>{value}</option>)}</select></label></div><SourceDock turn={latestTurn} onOpen={openSource} /><div className="chat-log">{!turns.length ? <div className="empty-chat"><strong>선택한 문서에 질문하세요.</strong><p>근거 문서를 먼저 보여주고 답변을 스트리밍합니다.</p></div> : null}{turns.map((turn) => <article key={turn.id} className="chat-turn"><div className="user-message">{turn.question}</div><div className="assistant-message"><div className="answer-text">{turn.answer || (turn.pending ? "답변 생성 중..." : "")}{turn.pending ? <span className="cursor" /> : null}</div>{turn.error ? <div className="turn-error">{turn.error}</div> : null}</div></article>)}</div><form className="question-form" onSubmit={submitQuestion}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={selectedIds.length ? "선택한 문서에 대해 질문하세요" : "AI 검색 대상으로 사용할 문서를 먼저 선택하세요"} rows={3} disabled={!selectedIds.length} /><div><span className={!selectedIds.length ? "scope-empty-warning" : ""}>{selectedIds.length ? `${selectedIds.length}개 문서가 AI 검색 범위에 포함됨 · 대화 로컬 저장` : "AI 검색 대상으로 선택된 문서가 없습니다."}</span><button type="submit" disabled={!question.trim() || !selectedIds.length}>질문 전송</button></div></form></> : <div className="process-pane">{latestTurn?.plan ? <><div className="process-status">{latestTurn.pending ? "실행 중" : "완료"}</div><dl><div><dt>Tool</dt><dd>{latestTurn.plan.tool}</dd></div><div><dt>Query</dt><dd>{latestTurn.plan.query}</dd></div><div><dt>Top K</dt><dd>{latestTurn.plan.top_k}</dd></div><div><dt>Reason</dt><dd>{latestTurn.plan.rationale || "-"}</dd></div><div><dt>Sources</dt><dd>{latestTurn.sources.length}</dd></div></dl></> : <div className="empty-chat"><strong>아직 Agent 실행 내역이 없습니다.</strong><p>Agent 모드로 질문하면 이 탭에서 계획을 확인할 수 있습니다.</p></div>}</div>}</aside>
      </section>
    </main>
  );
}
