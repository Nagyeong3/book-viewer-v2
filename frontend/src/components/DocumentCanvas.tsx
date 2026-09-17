"use client";

import { createElement, useEffect, useMemo, useState } from "react";

import { api, ContentItem } from "../lib/api";

export type DocumentRenderMode = "original" | "structured";

function headingTag(item: ContentItem): "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | null {
  if (item.content_type !== "title" && item.content_type !== "sub_title") return null;
  const level = Math.max(1, Math.min(item.doc_level ?? 3, 6));
  return `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
}

export function SemanticContent({ item }: { item: ContentItem }) {
  const text = item.text?.trim();
  const tag = headingTag(item);
  if (tag) {
    return createElement(
      tag,
      { className: `semantic-heading semantic-heading-${item.doc_level ?? 3}` },
      text || "제목 없음",
    );
  }
  if (item.content_type === "image" || item.content_type === "table") {
    return (
      <div className={`structured-placeholder structured-${item.content_type}`}>
        <span>{item.content_type === "image" ? "IMAGE" : "TABLE"}</span>
        {text ? <small>{text}</small> : null}
      </div>
    );
  }
  return <p className="semantic-paragraph">{text || ""}</p>;
}

export default function DocumentCanvas({
  documentId,
  page,
  contents,
  focusContentId,
  mode,
}: {
  documentId: number;
  page: number;
  contents: ContentItem[];
  focusContentId: number | null;
  mode: DocumentRenderMode;
}) {
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setNatural({ width: 0, height: 0 });
    setImageFailed(false);
  }, [documentId, page]);

  const positioned = useMemo(
    () => contents.filter((item) => item.bbox && item.page === page),
    [contents, page],
  );
  const focused = positioned.find((item) => item.id === focusContentId) ?? null;
  const canPosition = natural.width > 0 && natural.height > 0;

  return (
    <section className="document-canvas-wrap" aria-label={`문서 ${documentId} 페이지 ${page}`}>
      <div className="page-preview-toolbar">
        <div>
          <strong>{mode === "original" ? "원본 페이지" : "좌표 기반 구조화 페이지"}</strong>
          <small>p.{page}</small>
        </div>
        {mode === "structured" ? <span>{positioned.length} blocks</span> : null}
      </div>

      {imageFailed ? (
        <div className="image-fallback">
          원본 페이지 이미지 파일을 찾지 못했습니다. 구조화 본문 데이터는 아래에서 계속 확인할 수 있습니다.
        </div>
      ) : (
        <div
          className={`page-canvas ${mode}`}
          style={canPosition ? { aspectRatio: `${natural.width} / ${natural.height}` } : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="page-background"
            src={api.pageImageUrl(documentId, page)}
            alt={`Document ${documentId} page ${page}`}
            onLoad={(event) =>
              setNatural({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            onError={() => setImageFailed(true)}
          />

          {mode === "structured" && canPosition
            ? positioned.map((item) => {
                const box = item.bbox!;
                const isFocused = item.id === focusContentId;
                return (
                  <div
                    key={item.id}
                    id={`content-${item.id}`}
                    className={`coordinate-block type-${item.content_type ?? "unknown"} ${isFocused ? "focused" : ""}`}
                    style={{
                      left: `${(box.xmin / natural.width) * 100}%`,
                      top: `${(box.ymin / natural.height) * 100}%`,
                      width: `${((box.xmax - box.xmin) / natural.width) * 100}%`,
                      minHeight: `${((box.ymax - box.ymin) / natural.height) * 100}%`,
                    }}
                    title={`content #${item.id}`}
                  >
                    <SemanticContent item={item} />
                  </div>
                );
              })
            : null}

          {mode === "original" && focused?.bbox && canPosition ? (
            <div
              className="bbox-overlay"
              title={`content #${focused.id}`}
              style={{
                left: `${(focused.bbox.xmin / natural.width) * 100}%`,
                top: `${(focused.bbox.ymin / natural.height) * 100}%`,
                width: `${((focused.bbox.xmax - focused.bbox.xmin) / natural.width) * 100}%`,
                height: `${((focused.bbox.ymax - focused.bbox.ymin) / natural.height) * 100}%`,
              }}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}
