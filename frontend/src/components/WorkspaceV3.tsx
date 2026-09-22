"use client";

import {
  createElement,
  CSSProperties,
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
  AgentStep,
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
type ChatTurn = { id: number; question: string; answer: string; sources: RagSource[]; plan?: AgentPlan; steps?: AgentStep[]; pending: boolean; error?: string };
type LayoutState = { tocWidth: number; chatWidth: number; tocCollapsed: boolean; chatCollapsed: boolean };
type PageSize = { width: number; height: number };
type ChapterRange = { id: number; title: string; startPage: number; endPage: number };
type TranslationPanel = { item: ContentItem; translatedText: string; loading: boolean; error?: string } | null;
type ScopeSearchResult = { item: ContentItem; document: DocumentSummary };

const LAYOUT_KEY = "book-viewer-layout-v1";
const CHAT_KEY = "book-viewer-chat-v1";
const MAX_SAVED_TURNS = 30;
const DEFAULT_PAGE_SIZE: PageSize = { width: 1250, height: 1755 };
const pageSizeCache = new Map<number, PageSize>();
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const CUSTOM_TRANSLATION_LANGUAGE = "__custom__";
const PARTIAL_TRANSLATION_OPTIONS = [
  { value: "en", label: "영어" },
  { value: "ko", label: "한국어" },
  { value: "fil", label: "필리핀어" },
  { value: "pl", label: "폴란드어" },
  { value: "ja", label: "일본어" },
  { value: "ar-SA", label: "사우디(아랍어)" },
  { value: CUSTOM_TRANSLATION_LANGUAGE, label: "기타(직접입력)" },
] as const;
const STORED_LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  ko: "한국어",
  fil: "Filipino",
  pl: "Polski",
  ja: "日本語",
  "ar-SA": "العربية (Saudi Arabia)",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
};

function languageLabel(code: string) {
  return STORED_LANGUAGE_LABELS[code] ?? code;
}

function storedTranslation(item: ContentItem, language: string): string | null {
  const candidate = item.translations?.[language];
  if (typeof candidate !== "string" || !candidate.trim()) return null;
  return candidate;
}

function headingTag(level: number | null): "h2" | "h3" | "h4" | "h5" | "h6" {
  // Document title levels 1/2/3 intentionally map to h2/h3/h4.
  // h1 remains reserved for the product/page shell.
  const normalized = clamp((level ?? 3) + 1, 2, 6);
  return `h${normalized}` as "h2" | "h3" | "h4" | "h5" | "h6";
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

function SemanticBlock({ item, textOverride }: { item: ContentItem; textOverride?: string | null }) {
  const text = (textOverride ?? item.text)?.trim();
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

function DocumentPage({
  page,
  contents,
  pageSize,
  focusContentId,
  zoom,
  translationEnabled,
  fullTranslationEnabled,
  fullTranslationLanguage,
  onTranslate,
}: {
  page: number;
  contents: ContentItem[];
  pageSize: PageSize;
  focusContentId: number | null;
  zoom: number;
  translationEnabled: boolean;
  fullTranslationEnabled: boolean;
  fullTranslationLanguage: string;
  onTranslate: (item: ContentItem) => void;
}) {
  const positioned = contents.filter((item) => item.bbox && item.page === page);
  const zoomScale = zoom / 100;
  const isLandscape = pageSize.width > pageSize.height;
  const frameStyle = {
    width: `${zoom}%`,
    maxWidth: `${1040 * zoomScale}px`,
    fontSize: `${12 * zoomScale}px`,
    "--viewer-zoom-scale": zoomScale,
  } as CSSProperties & { "--viewer-zoom-scale": number };
  const paperStyle: CSSProperties = {
    aspectRatio: `${pageSize.width} / ${pageSize.height}`,
    width: "100%",
    maxWidth: `${(isLandscape ? 1040 : 880) * zoomScale}px`,
  };
  return (
    <article className="chapter-page-frame" data-page={page} style={frameStyle}>
      <div className="chapter-page-toolbar"><span>p.{page}</span><span>{positioned.length}개 영역</span></div>
      <div className={`chapter-page-paper ${isLandscape ? "landscape" : "portrait"}`} style={paperStyle}>
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
              className={`coordinate-block type-${item.content_type ?? "unknown"} ${focusContentId === item.id ? "focused" : ""} ${translationEnabled && item.text?.trim() && item.content_type !== "image" ? "translation-target" : ""}`}
              style={{ left: `${left}%`, top: `${top}%`, width: `${Math.max(width, 0.2)}%`, height: `${Math.max(height, 0.2)}%` }}
              onClick={() => {
                if (translationEnabled && item.text?.trim() && item.content_type !== "image") onTranslate(item);
              }}
            >
              <SemanticBlock
                item={item}
                textOverride={fullTranslationEnabled
                  ? (item.content_type === "table"
                      ? (storedTranslation(item, fullTranslationLanguage)?.trim().startsWith("<table")
                          ? storedTranslation(item, fullTranslationLanguage)
                          : item.text)
                      : storedTranslation(item, fullTranslationLanguage) ?? item.text)
                  : item.text}
              />
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

function UiIcon({ name, size = 14 }: { name: "search" | "sliders" | "send" | "chevron" | "sparkles" | "translate" | "minus" | "plus" | "close"; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "search") return <svg {...common}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>;
  if (name === "sliders") return <svg {...common}><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" /></svg>;
  if (name === "send") return <svg {...common}><path d="m4 5 16 7-16 7 3-7-3-7Z" /><path d="M7 12h8" /></svg>;
  if (name === "chevron") return <svg {...common}><path d="m9 6 6 6-6 6" /></svg>;
  if (name === "translate") return <svg {...common}><path d="M4 5h8M8 3v2M6 5c.7 3.2 2.8 5.7 6 7M11 5c-.7 3.3-2.8 5.8-6 7" /><path d="m14 19 3-8 3 8M15 16h4" /></svg>;
  if (name === "minus") return <svg {...common}><path d="M5 12h14" /></svg>;
  if (name === "plus") return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
  if (name === "close") return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  return <svg {...common}><path d="m12 3 1.4 3.6L17 8l-3.6 1.4L12 13l-1.4-3.6L7 8l3.6-1.4L12 3Z" /><path d="m18 14 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z" /></svg>;
}

function SourceDock({ turn, onOpen }: { turn: ChatTurn | undefined; onOpen: (source: RagSource) => void }) {
  if (!turn) return null;
  return (
    <details className="source-dock" open>
      <summary className="source-dock-heading">
        <div><strong>참조 문서</strong><small>답변에 사용된 검색 근거</small></div>
        <span className="source-count">{turn.sources.length}</span>
      </summary>
      {turn.sources.length ? <div className="source-strip">{turn.sources.map((source) => (
        <button key={source.source_id} type="button" onClick={() => onOpen(source)}><span className="source-id">{source.source_id}</span><span className="source-copy"><strong>{source.title_path.join(" > ") || `content #${source.content_id}`}</strong><small>{source.document_name}{source.page ? ` · p.${source.page}` : ""}</small></span></button>
      ))}</div> : <div className="source-waiting">{turn.pending ? "관련 문서를 검색 중입니다..." : "참조 문서가 없습니다."}</div>}
    </details>
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
  const [viewerZoom, setViewerZoom] = useState(100);
  const [fullTranslationEnabled, setFullTranslationEnabled] = useState(false);
  const [fullTranslationLanguage, setFullTranslationLanguage] = useState("");
  const [fullTranslationLanguages, setFullTranslationLanguages] = useState<string[]>([]);
  const [fullTranslationLanguagesLoading, setFullTranslationLanguagesLoading] = useState(false);
  const [scopeSearchQuery, setScopeSearchQuery] = useState("");
  const [scopeSearchResults, setScopeSearchResults] = useState<ScopeSearchResult[]>([]);
  const [translationEnabled, setTranslationEnabled] = useState(false);
  const [translationLanguage, setTranslationLanguage] = useState("en");
  const [customTranslationLanguage, setCustomTranslationLanguage] = useState("");
  const [translationPanel, setTranslationPanel] = useState<TranslationPanel>(null);
  const [translationPanelPosition, setTranslationPanelPosition] = useState<{ x: number; y: number } | null>(null);
  const [layout, setLayout] = useState<LayoutState>({ tocWidth: 320, chatWidth: 430, tocCollapsed: false, chatCollapsed: false });
  const abortRef = useRef<AbortController | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const loadedPagesRef = useRef(new Set<number>());
  const inFlightRef = useRef(new Set<number>());
  const generationRef = useRef(0);
  const pageSizeLoadingRef = useRef(false);
  const pendingScrollPageRef = useRef<number | null>(null);
  const tocManualLockUntilRef = useRef(0);
  const submittingRef = useRef(false);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const chatAutoStickRef = useRef(true);
  const translationCacheRef = useRef(new Map<string, string>());
  const translationRequestRef = useRef<string | null>(null);
  const translationPanelRef = useRef<HTMLElement | null>(null);

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
    const root = chatLogRef.current;
    if (!root || !chatAutoStickRef.current) return;
    requestAnimationFrame(() => {
      const latest = turns[turns.length - 1];
      root.scrollTo({ top: root.scrollHeight, behavior: latest?.pending ? "auto" : "smooth" });
    });
  }, [turns.length, turns[turns.length - 1]?.answer.length]);

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
    setTranslationPanel(null);
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

  useEffect(() => {
    const query = scopeSearchQuery.trim().toLowerCase();
    if (!selectedIds.length || query.length < 2) {
      setScopeSearchResults([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void Promise.all(
        selectedIds.map(async (documentId) => {
          const document = documents.find((item) => item.id === documentId);
          if (!document) return [];
          const items = await api.listContents(documentId);
          return items
            .filter((item) => item.text?.replace(/<[^>]*>/g, "").toLowerCase().includes(query))
            .map((item) => ({ item, document }));
        }),
      ).then((groups) => {
        if (cancelled) return;
        setScopeSearchResults(groups.flat().slice(0, 16));
      }).catch(() => {
        if (!cancelled) setScopeSearchResults([]);
      });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [documents, scopeSearchQuery, selectedIds]);

  function centerTranslationPanel() {
    const width = Math.min(440, Math.max(320, window.innerWidth - 48));
    const height = Math.min(430, Math.max(260, window.innerHeight - 80));
    setTranslationPanelPosition({
      x: Math.max(20, Math.round((window.innerWidth - width) / 2)),
      y: Math.max(20, Math.round((window.innerHeight - height) / 2)),
    });
  }


  async function translateItem(item: ContentItem) {
    const source = item.text?.trim();
    if (!translationEnabled || !source) return;
    const key = `${translationLanguage}:${item.id}:${source}`;
    const cached = translationCacheRef.current.get(key);
    centerTranslationPanel();
    if (cached) {
      setTranslationPanel({ item, translatedText: cached, loading: false });
      return;
    }
    if (translationRequestRef.current === key) return;
    translationRequestRef.current = key;
    setTranslationPanel({ item, translatedText: "", loading: true });
    try {
      const result = await api.translate(source, translationLanguage);
      translationCacheRef.current.set(key, result.translated_text);
      setTranslationPanel({ item, translatedText: result.translated_text, loading: false });
    } catch (error) {
      setTranslationPanel({
        item,
        translatedText: "",
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (translationRequestRef.current === key) translationRequestRef.current = null;
    }
  }

  const availableTranslationLanguages = useMemo(() => {
    const discovered = new Set<string>(["en", "fil", "pl"]);
    Object.values(pageContents).flat().forEach((item) => {
      Object.keys(item.translations ?? {}).forEach((code) => discovered.add(code));
    });
    return Array.from(discovered);
  }, [pageContents]);

  const languageLabel = (code: string) => ({
    en: "English",
    fil: "Filipino",
    pl: "Polski",
    ja: "日本語",
    "zh-CN": "简体中文",
    "zh-TW": "繁體中文",
    es: "Español",
    fr: "Français",
    de: "Deutsch",
  }[code] ?? code);

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

  function openScopeSearchResult(result: ScopeSearchResult) {
    setScopeSearchQuery("");
    setScopeSearchResults([]);
    setFocusContentId(result.item.id);
    pendingScrollPageRef.current = result.item.page ?? null;

    if (result.document.id !== activeDocumentId) {
      setActiveDocumentId(result.document.id);
      window.setTimeout(() => {
        if (result.item.page) setLoadAnchorPage(result.item.page);
      }, 0);
      return;
    }

    if (result.item.page) navigateToPage(result.item.page, result.item.id);
  }

  function beginTranslationDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!translationPanelPosition) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = translationPanelPosition;

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const rect = translationPanelRef.current?.getBoundingClientRect();
      const panelWidth = rect?.width ?? Math.min(440, Math.max(320, window.innerWidth - 48));
      const panelHeight = rect?.height ?? Math.min(430, Math.max(260, window.innerHeight - 80));
      setTranslationPanelPosition({
        x: clamp(origin.x + (moveEvent.clientX - startX), 8, Math.max(8, window.innerWidth - panelWidth - 8)),
        y: clamp(origin.y + (moveEvent.clientY - startY), 8, Math.max(8, window.innerHeight - panelHeight - 8)),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function changeViewerZoom(delta: number) {
    const root = viewerRef.current;
    const nextZoom = clamp(viewerZoom + delta, 60, 160);
    if (!root || nextZoom === viewerZoom) {
      setViewerZoom(nextZoom);
      return;
    }

    // Preserve the document point currently under the viewport centre.
    // The page itself changes its layout dimensions, so both horizontal and
    // vertical scroll positions need to be restored after React reflows it.
    const centerXRatio = (root.scrollLeft + root.clientWidth / 2) / Math.max(root.scrollWidth, root.clientWidth);
    const centerYRatio = (root.scrollTop + root.clientHeight / 2) / Math.max(root.scrollHeight, root.clientHeight);
    const previousScrollBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    setViewerZoom(nextZoom);

    requestAnimationFrame(() => requestAnimationFrame(() => {
      const next = viewerRef.current;
      if (!next) return;
      next.scrollTo({
        left: Math.max(0, centerXRatio * next.scrollWidth - next.clientWidth / 2),
        top: Math.max(0, centerYRatio * next.scrollHeight - next.clientHeight / 2),
        behavior: "auto",
      });
      next.style.scrollBehavior = previousScrollBehavior;
    }));
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
    if (!clean || !selectedIds.length || submittingRef.current) return;

    submittingRef.current = true;
    chatAutoStickRef.current = true;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const id = Date.now();
    setTurns((current) => [...current, { id, question: clean, answer: "", sources: [], pending: true }]);
    setQuestion("");
    setAssistantTab("assistant");

    const handlers = {
      onPlan: (plan: AgentPlan) => setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, plan } : turn)),
      onStep: (step: AgentStep) => setTurns((current) => current.map((turn) => {
        if (turn.id !== id) return turn;
        const existing = turn.steps ?? [];
        const index = existing.findIndex((item) => item.id === step.id);
        const steps = index >= 0
          ? existing.map((item, stepIndex) => stepIndex === index ? step : item)
          : [...existing, step];
        return { ...turn, steps };
      })),
      onSources: (sources: RagSource[]) => setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, sources } : turn)),
      onToken: (token: string) => setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, answer: turn.answer + token } : turn)),
      onDone: () => setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, pending: false } : turn)),
    };

    try {
      if (mode === "agent") await streamAgent(clean, selectedIds, topK, handlers, controller.signal);
      else await streamRag(clean, selectedIds, topK, handlers, controller.signal);
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        const message = error instanceof Error ? error.message : String(error);
        setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, pending: false, error: message } : turn));
      }
    } finally {
      submittingRef.current = false;
    }
  }

  const gridStyle = { gridTemplateColumns: `${layout.tocCollapsed ? 0 : layout.tocWidth}px ${layout.tocCollapsed ? 0 : 6}px minmax(500px, 1fr) ${layout.chatCollapsed ? 0 : 6}px ${layout.chatCollapsed ? 0 : layout.chatWidth}px` };

  return (
    <main className="workspace-shell workspace-v3">
      <header className="topbar product-topbar"><div className="brand-block"><span className="brand-mark" aria-hidden="true">B</span><span className="brand-copy"><strong>기술문서 AI Viewer</strong><small>{activeDocument?.title ?? "문서를 선택하세요"}</small></span></div><div className="topbar-actions">{chapter ? <span className="chapter-pill"><span>현재 위치</span>{chapter.title} · p.{activePage ?? chapter.startPage}</span> : null}<div className="scope-search-control"><UiIcon name="search" size={13} /><input value={scopeSearchQuery} onChange={(event) => setScopeSearchQuery(event.target.value)} placeholder={selectedIds.length ? "선택 문서 검색" : "검색 문서를 선택하세요"} disabled={!selectedIds.length} />{scopeSearchQuery.trim().length >= 2 ? <div className="scope-search-results">{scopeSearchResults.length ? scopeSearchResults.map((result) => <button key={`${result.document.id}-${result.item.id}`} type="button" onClick={() => openScopeSearchResult(result)}><span><strong>{result.item.text?.replace(/<[^>]*>/g, "").slice(0, 72) || `Content #${result.item.id}`}</strong><small>{result.document.title}</small></span><em>p.{result.item.page ?? "-"}</em></button>) : <div className="scope-search-empty">선택한 문서에서 결과를 찾지 못했습니다.</div>}</div> : null}</div><span className="topbar-index-slot" /></div></header>
      {startupError ? <div className="global-error">{startupError}</div> : null}
      <section className="workspace-grid" style={gridStyle}>
        <aside className={`document-pane panel ${layout.tocCollapsed ? "collapsed" : ""}`}><div className="panel-heading compact-heading"><div><span className="panel-eyebrow">LIBRARY</span><h2>문서 탐색</h2><p>열람 문서와 AI 검색 범위를 관리합니다.</p></div><button type="button" className="icon-button icon-button-back" aria-label="목차 접기" title="목차 접기" onClick={() => setLayout((current) => ({ ...current, tocCollapsed: true }))}><UiIcon name="chevron" size={13} /></button></div><div className="document-picker polished-picker"><input className="document-search" value={documentQuery} onChange={(event) => setDocumentQuery(event.target.value)} placeholder="문서명 또는 ID 검색" /><div className="scope-toolbar"><div><strong>AI 검색 범위</strong><span>{selectedIds.length}개 문서 선택</span></div><div><button type="button" onClick={selectAllDocuments} disabled={selectedIds.length === documents.length && documents.length > 0}>전체 선택</button><button type="button" onClick={clearDocumentScope} disabled={!selectedIds.length}>전체 해제</button></div></div><div className="document-list document-list-large">{filteredDocuments.map((document) => { const selected = selectedIds.includes(document.id); const active = activeDocumentId === document.id; const indexStatus = indexStatuses[document.id]; const ready = indexStatus?.state === "ready"; const running = indexStatus?.state === "queued" || indexStatus?.state === "indexing"; return <div key={document.id} className={`document-list-row ${active ? "active-row" : ""}`}><button type="button" className={`scope-checkbox ${selected ? "checked" : ""}`} aria-pressed={selected} aria-label={`${document.title} AI 검색 범위 ${selected ? "제외" : "포함"}`} onClick={() => toggleDocumentScope(document.id)}><span className="checkbox-mark">{selected ? "✓" : ""}</span></button><button type="button" className={`document-item ${active ? "active" : ""}`} onClick={() => openDocument(document.id)}><span className="document-copy"><span className="document-title-line"><strong>{document.title}</strong><span className={`document-index-badge ${ready ? "ready" : running ? "running" : "missing"}`}>{ready ? "RAG 준비" : running ? "구축 중" : "DB 미구축"}</span></span><small>Document #{document.id}{active ? " · 현재 열림" : ""}</small></span></button></div>; })}</div></div><div className="toc-section"><div className="section-label">목차</div>{toc.length ? <TocTree nodes={toc} activeTocId={activeTocId} expandedIds={expandedTocIds} onPick={openToc} onToggle={toggleToc} /> : <div className="muted">목차 없음</div>}</div></aside>
        <div className={`resize-handle toc-resize-handle ${layout.tocCollapsed ? "hidden" : ""}`} onPointerDown={(event) => beginResize("toc", event)} />
        <section className="viewer-pane panel chapter-viewer-panel"><div className="panel-heading viewer-heading sticky-viewer-heading"><div className="viewer-heading-main"><button type="button" className="viewer-menu-button" aria-label={layout.tocCollapsed ? "목차 열기" : "목차 닫기"} title={layout.tocCollapsed ? "목차 열기" : "목차 닫기"} onClick={() => setLayout((current) => ({ ...current, tocCollapsed: !current.tocCollapsed }))}><span /><span /><span /></button><div><span className="panel-eyebrow">DOCUMENT VIEWER</span><h2>{activeDocument?.title ?? "문서 선택"}</h2><p>{chapter ? `${chapter.title} · p.${chapter.startPage}–${chapter.endPage}` : "챕터를 불러오는 중"}</p></div></div><div className="viewer-toolbar"><div className="translate-controls full-translate-controls"><button type="button" className={`translate-toggle ${fullTranslationEnabled ? "active" : ""}`} aria-pressed={fullTranslationEnabled} onClick={() => { setFullTranslationEnabled((current) => !current); setTranslationEnabled(false); setTranslationPanel(null); }}><UiIcon name="translate" size={13} /><span>전체 번역</span></button><select value={fullTranslationLanguage} onChange={(event) => setFullTranslationLanguage(event.target.value)} aria-label="전체 번역 언어">{availableTranslationLanguages.map((code) => <option key={code} value={code}>{languageLabel(code)}</option>)}</select></div><div className="translate-controls"><button type="button" className={`translate-toggle ${translationEnabled ? "active" : ""}`} aria-pressed={translationEnabled} onClick={() => { setTranslationEnabled((current) => !current); setFullTranslationEnabled(false); setTranslationPanel(null); }}><UiIcon name="translate" size={13} /><span>부분 번역</span></button>{translationEnabled ? <select value={translationLanguage} onChange={(event) => { setTranslationLanguage(event.target.value); setTranslationPanel(null); }} aria-label="부분 번역 언어"><option value="en">English</option><option value="ja">日本語</option><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="es">Español</option><option value="fr">Français</option><option value="de">Deutsch</option></select> : null}</div><div className="zoom-controls"><button type="button" aria-label="축소" onClick={() => changeViewerZoom(-10)}><UiIcon name="minus" size={12} /></button><span>{viewerZoom}%</span><button type="button" aria-label="확대" onClick={() => changeViewerZoom(10)}><UiIcon name="plus" size={12} /></button></div><div className="viewer-status"><span>{pageSizeError || `${pageSize.width} × ${pageSize.height}`}</span><strong>p.{activePage ?? "-"}</strong>{layout.chatCollapsed ? <button type="button" className="viewer-ai-open-button" onClick={() => setLayout((current) => ({ ...current, chatCollapsed: false }))} title="AI 비서 열기"><UiIcon name="sparkles" size={13} /><span>AI 비서 열기</span></button> : null}</div></div></div><div className={`viewer-scroll chapter-scroll ${translationEnabled ? "translation-active" : "translation-inactive"}`} ref={viewerRef}><div className={`page-load-sentinel ${loadingEdge === "top" ? "edge-load-active" : ""}`}>{loadedPages.length && loadedPages[0] > 1 ? "이전 페이지 준비 중" : ""}</div>{loadedPages.map((page) => <DocumentPage key={page} page={page} contents={pageContents[page] ?? []} pageSize={pageSize} focusContentId={focusContentId} zoom={viewerZoom} translationEnabled={translationEnabled} fullTranslationEnabled={fullTranslationEnabled} fullTranslationLanguage={fullTranslationLanguage} onTranslate={(item) => { void translateItem(item); }} />)}<div className={`page-load-sentinel ${loadingEdge === "bottom" ? "edge-load-active" : ""}`}>{loadedPages.length && loadedPages[loadedPages.length - 1] < documentMaxPage ? "다음 페이지 준비 중" : ""}</div></div>{translationPanel ? <aside ref={translationPanelRef} className="translation-panel" style={translationPanelPosition ? { left: translationPanelPosition.x, top: translationPanelPosition.y } : undefined}><header onPointerDown={beginTranslationDrag}><div><UiIcon name="translate" size={14} /><strong>부분 번역</strong><small>드래그하여 이동</small></div><button type="button" aria-label="번역 패널 닫기" onPointerDown={(event) => event.stopPropagation()} onClick={() => setTranslationPanel(null)}><UiIcon name="close" size={13} /></button></header><div className="translation-source"><span>원문</span><p>{translationPanel.item.text?.replace(/<[^>]*>/g, "")}</p></div><div className="translation-result"><span>번역</span>{translationPanel.loading ? <p className="translation-loading">번역 중...</p> : translationPanel.error ? <p className="translation-error">번역 요청에 실패했습니다.</p> : <p>{translationPanel.translatedText}</p>}</div><footer>행 단위 AI 번역 · 원문은 변경되지 않습니다.</footer></aside> : null}</section>
        <div className={`resize-handle chat-resize-handle ${layout.chatCollapsed ? "hidden" : ""}`} onPointerDown={(event) => beginResize("chat", event)} />
        <aside className={`chat-pane panel ${layout.chatCollapsed ? "collapsed" : ""}`}><div className="assistant-titlebar"><div><span className="panel-eyebrow">AI WORKSPACE</span><strong>문서 AI 비서</strong><small className="assistant-scope-meta">AI 검색 범위 · {selectedIds.length}개 문서</small></div><button type="button" className="icon-button" aria-label="AI 비서 접기" title="AI 비서 접기" onClick={() => setLayout((current) => ({ ...current, chatCollapsed: true }))}><UiIcon name="chevron" size={13} /></button></div><div className="assistant-header"><div className="assistant-tabs"><button type="button" className={assistantTab === "assistant" ? "active" : ""} onClick={() => setAssistantTab("assistant")}>AI 비서</button><button type="button" className={assistantTab === "process" ? "active" : ""} onClick={() => setAssistantTab("process")}>Agent Process</button></div></div>{assistantTab === "assistant" ? <><div className="chat-controls"><div className="segmented"><button type="button" className={mode === "agent" ? "active" : ""} onClick={() => setMode("agent")}>Agent</button><button type="button" className={mode === "rag" ? "active" : ""} onClick={() => setMode("rag")}>Hybrid RAG</button></div><details className="assistant-settings"><summary><UiIcon name="sliders" size={12} /><span>검색 설정</span></summary><label>검색 결과 수<select value={topK} onChange={(event) => setTopK(Number(event.target.value))}>{[3,5,8,10].map((value) => <option key={value}>{value}</option>)}</select></label></details></div><SourceDock turn={latestTurn} onOpen={openSource} /><div className="chat-log" ref={chatLogRef} onScroll={(event) => { const root = event.currentTarget; chatAutoStickRef.current = root.scrollHeight - root.scrollTop - root.clientHeight < 80; }}>{!turns.length ? <div className="empty-chat"><strong>선택한 문서에 질문하세요.</strong><p>근거 문서를 먼저 보여주고 답변을 스트리밍합니다.</p></div> : null}{turns.map((turn) => <article key={turn.id} className="chat-turn"><div className="user-message">{turn.question}</div><div className="assistant-message"><div className="answer-text">{turn.answer || (turn.pending ? "답변 생성 중..." : "")}{turn.pending ? <span className="cursor" /> : null}</div>{turn.error ? <div className="turn-error">{turn.error}</div> : null}</div></article>)}</div><form className="question-form" onSubmit={submitQuestion}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return; event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={selectedIds.length ? "선택한 문서에 대해 질문하세요" : "AI 검색 대상으로 사용할 문서를 먼저 선택하세요"} rows={3} disabled={!selectedIds.length} /><div><span className={!selectedIds.length ? "scope-empty-warning" : ""}>{selectedIds.length ? "대화는 이 브라우저에 저장됩니다." : "AI 검색 대상으로 선택된 문서가 없습니다."}</span><button type="submit" className="send-button icon-only-send" aria-label="질문 전송" title="질문 전송" disabled={!question.trim() || !selectedIds.length}><UiIcon name="send" size={19} /></button></div></form></> : <div className="process-pane">{latestTurn && ((latestTurn.steps?.length ?? 0) > 0 || latestTurn.plan) ? <><div className="process-overview"><div><span className={`process-live-dot ${latestTurn.pending ? "running" : "done"}`} /><strong>{latestTurn.pending ? "Agent 실행 중" : "Agent 실행 완료"}</strong></div><small>{latestTurn.steps?.length ?? 0} steps</small></div><ol className="agent-step-list">{(latestTurn.steps ?? []).map((step, index) => <li key={step.id} className={step.status}><span>{index + 1}</span><div><strong>{step.title}</strong><small>{step.detail}</small>{step.tool || step.query ? <em>{[step.tool, step.query].filter(Boolean).join(" · ")}</em> : null}</div></li>)}</ol><div className="process-query"><span>초기 검색 계획</span><strong>{latestTurn.plan ? `${latestTurn.plan.tool} · ${latestTurn.plan.query}` : "Planner 실행 중"}</strong></div></> : <div className="empty-chat"><strong>아직 Agent 실행 내역이 없습니다.</strong><p>Agent 모드로 질문하면 계획·검색·근거평가·재검색·답변 생성 과정을 확인할 수 있습니다.</p></div>}</div>}</aside>
      </section>
    </main>
  );
}
