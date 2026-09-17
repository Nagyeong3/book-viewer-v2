"use client";

import { useEffect, useState } from "react";

const FOCUS_KEY = "book-viewer-focus-mode-v1";

function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable;
}

export default function ProductToolbar() {
  const [focusMode, setFocusMode] = useState(false);

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

  const printLoadedPages = () => {
    window.print();
  };

  return (
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
      <button type="button" onClick={printLoadedPages} title="현재 로드된 페이지를 A4 기준으로 인쇄">
        <span className="utility-icon" aria-hidden="true">▣</span>
        <span>인쇄</span>
      </button>
    </nav>
  );
}
