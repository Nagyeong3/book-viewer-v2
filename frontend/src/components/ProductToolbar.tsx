"use client";

import { createElement, useEffect, useMemo, useState } from "react";

import { api, ContentItem } from "../lib/api";
import { getSafeImageUrl } from "../lib/seaweed";

const FOCUS_KEY = "book-viewer-focus-mode-v1";
const DEFAULT_PAGE_SIZE = { width: 1250, height: 1755 };

type PageSize = typeof DEFAULT_PAGE_SIZE;
type PrintState = {
  documentId: number;
  documentTitle: string;
  contents: ContentItem[];
  pageSize: PageSize;
} | null;

function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable;
}

function activeDocumentFromDom(): { id: number; title: string } | null {
  const active = document.querySelector<HTMLElement>(".document-item.active");
  if (!active) return null;
  const idText = active.querySelector("small")?.textContent ?? "";
  const id = Number(idText.match(/#(\d+)/)?.[1]);
  if (!id) return null;
  return { id, title: active.querySelector("strong")?.textContent?.trim() || `Document #${id}` };
}

function headingTag(level: number | null) {
  const normalized = Math.min(Math.max(level ?? 3, 1), 6);
  return `h${normalized}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
}

function PrintBlock({ item }: { item: ContentItem }) {
  const text = item.text?.trim();
  if (item.content_type === "title" || item.content_type === "sub_title") {
    return createElement(headingTag(item.doc_level), { className: `semantic-heading semantic-heading-${Math.min(Math.max(item.doc_level ?? 3, 1), 6)}` }, text || "제목");
  }
  if (item.content_type === "image") {
    const src = getSafeImageUrl(item.cropped_image_path);
    return src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="coordinate-cropped-image" src={src} alt={text || `content ${item.id}`} loading="eager" />
    ) : null;
  }
  if (item.content_type === "table") return <div className="coordinate-table">{text || "표"}</div>;
  return <div className="coordinate-text">{text || ""}</div>;
}

function PrintDocument({ state }: { state: NonNullable<PrintState> }) {
  const pages = useMemo(() => {
    const grouped = new Map<number, ContentItem[]>();
    for (const item of state.contents) {
      if (!item.page || !item.bbox) continue;
      const current = grouped.get(item.page) ?? [];
      current.push(item);
      grouped.set(item.page, current);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => a - b);
  }, [state.contents]);

  return (
    <section className="full-document-print" aria-hidden="true">
      {pages.map(([page, contents]) => (
        <article className="print-document-page" key={page} data-page={page}>
          <div className="print-page-paper" style={{ aspectRatio: `${state.pageSize.width} / ${state.pageSize.height}` }}>
            {contents.map((item) => {
              const box = item.bbox!;
              const left = (box.xmin / state.pageSize.width) * 100;
              const top = (box.ymin / state.pageSize.height) * 100;
              const width = ((box.xmax - box.xmin) / state.pageSize.width) * 100;
              const height = ((box.ymax - box.ymin) / state.pageSize.height) * 100;
              return (
                <div
                  key={item.id}
                  className={`coordinate-block print-coordinate-block type-${item.content_type ?? "unknown"}`}
                  style={{ left: `${left}%`, top: `${top}%`, width: `${Math.max(width, 0.2)}%`, height: `${Math.max(height, 0.2)}%` }}
                >
                  <PrintBlock item={item} />
                </div>
              );
            })}
          </div>
        </article>
      ))}
    </section>
  );
}

async function measurePageSize(contents: ContentItem[]): Promise<PageSize> {
  const path = contents.find((item) => item.doc_image_path)?.doc_image_path;
  const src = getSafeImageUrl(path);
  if (!src) return DEFAULT_PAGE_SIZE;
  return new Promise((resolve) => {
    const image = new Image();
    const finish = (size: PageSize) => resolve(size);
    const timer = window.setTimeout(() => finish(DEFAULT_PAGE_SIZE), 1200);
    image.onload = () => {
      window.clearTimeout(timer);
      finish(image.naturalWidth && image.naturalHeight ? { width: image.naturalWidth, height: image.naturalHeight } : DEFAULT_PAGE_SIZE);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      finish(DEFAULT_PAGE_SIZE);
    };
    image.src = src;
  });
}

async function waitForPrintAssets() {
  await document.fonts?.ready;
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const images = Array.from(document.querySelectorAll<HTMLImageElement>(".full-document-print img"));
  await Promise.race([
    Promise.all(images.map((image) => image.complete ? Promise.resolve() : new Promise<void>((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    }))),
    new Promise((resolve) => window.setTimeout(resolve, 1800)),
  ]);
}

export default function ProductToolbar() {
  const [focusMode, setFocusMode] = useState(false);
  const [printState, setPrintState] = useState<PrintState>(null);
  const [printStatus, setPrintStatus] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem(FOCUS_KEY) === "true";
    setFocusMode(stored);
    document.body.classList.toggle("product-focus-mode", stored);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.key.toLowerCase() === "f" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setFocusMode((current) => {
          const next = !current;
          document.body.classList.toggle("product-focus-mode", next);
          window.localStorage.setItem(FOCUS_KEY, String(next));
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!printState) return;
    let cancelled = false;
    void waitForPrintAssets().then(() => {
      if (cancelled) return;
      setPrintStatus("");
      window.print();
      setPrintState(null);
    });
    return () => { cancelled = true; };
  }, [printState]);

  const toggleFocus = () => {
    setFocusMode((current) => {
      const next = !current;
      document.body.classList.toggle("product-focus-mode", next);
      window.localStorage.setItem(FOCUS_KEY, String(next));
      return next;
    });
  };

  const scrollTop = () => {
    document.querySelector<HTMLElement>(".chapter-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const printWholeDocument = async () => {
    if (printStatus) return;
    const active = activeDocumentFromDom();
    if (!active) {
      setPrintStatus("인쇄할 문서를 먼저 선택하세요.");
      window.setTimeout(() => setPrintStatus(""), 1800);
      return;
    }
    setPrintStatus("전체 문서를 인쇄용으로 불러오는 중...");
    try {
      const contents = await api.listContents(active.id);
      const pageSize = await measurePageSize(contents);
      setPrintStatus(`전체 ${new Set(contents.map((item) => item.page).filter(Boolean)).size}페이지를 준비하는 중...`);
      setPrintState({ documentId: active.id, documentTitle: active.title, contents, pageSize });
    } catch (error) {
      setPrintStatus(error instanceof Error ? `인쇄 준비 실패: ${error.message}` : "인쇄 준비에 실패했습니다.");
      window.setTimeout(() => setPrintStatus(""), 3000);
    }
  };

  return (
    <>
      {printState ? <PrintDocument state={printState} /> : null}
      {printStatus ? <div className="print-loading-toast"><span className="loading-spinner" />{printStatus}</div> : null}
      <nav className="product-utility-bar" aria-label="문서 뷰어 도구">
        <button type="button" onClick={toggleFocus} aria-pressed={focusMode} title="집중 보기 (F)">
          <span className="utility-icon" aria-hidden="true">{focusMode ? "◫" : "□"}</span>
          <span>{focusMode ? "패널 복원" : "집중 보기"}</span>
          <kbd>F</kbd>
        </button>
        <span className="utility-divider" />
        <button type="button" onClick={scrollTop} title="현재 챕터 상단으로 이동">
          <span className="utility-icon" aria-hidden="true">↑</span>
          <span>상단</span>
        </button>
        <button type="button" onClick={printWholeDocument} disabled={Boolean(printStatus)} title="현재 선택한 문서 전체를 A4 기준으로 인쇄">
          <span className="utility-icon" aria-hidden="true">▣</span>
          <span>전체 인쇄</span>
        </button>
      </nav>
    </>
  );
}
