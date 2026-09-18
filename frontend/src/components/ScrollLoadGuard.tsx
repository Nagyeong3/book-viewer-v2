"use client";

import { useEffect } from "react";

const NEAR_EDGE_PX = 900;
const RETRY_MS = 260;
const MAX_PULSES = 24;

export default function ScrollLoadGuard() {
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>(".chapter-scroll");
    if (!scroller) return;

    let retryTimer: number | null = null;
    let pulseCount = 0;
    let lastPageCount = scroller.querySelectorAll(".chapter-page-frame").length;
    let activeSide: "top" | "bottom" | null = null;

    const sentinelFor = (side: "top" | "bottom") => scroller.querySelector<HTMLElement>(
      side === "bottom" ? ".page-load-sentinel:last-child" : ".page-load-sentinel:first-child",
    );

    const clearRetry = () => {
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      retryTimer = null;
    };

    const clearLoading = () => {
      clearRetry();
      scroller.querySelectorAll<HTMLElement>(".page-load-sentinel.edge-load-active")
        .forEach((element) => element.classList.remove("edge-load-active"));
      activeSide = null;
      pulseCount = 0;
    };

    const nearEdge = (side: "top" | "bottom") => {
      if (side === "top") return scroller.scrollTop <= NEAR_EDGE_PX;
      return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= NEAR_EDGE_PX;
    };

    const pulseScroll = (side: "top" | "bottom") => {
      if (!nearEdge(side)) {
        clearLoading();
        return;
      }
      const sentinel = sentinelFor(side);
      if (!sentinel?.textContent?.trim()) {
        clearLoading();
        return;
      }

      activeSide = side;
      sentinel.classList.add("edge-load-active");
      pulseCount += 1;

      // IntersectionObserver가 이미 sentinel을 intersecting 상태로 유지하면 새 callback이
      // 발생하지 않을 수 있다. 사용자가 위/아래로 흔들지 않아도 되도록 1px 미만의
      // 시각적으로 느껴지지 않는 scroll pulse로 observer를 재평가한다.
      const originalTop = scroller.scrollTop;
      const delta = side === "bottom" ? -1 : 1;
      scroller.scrollTop = Math.max(0, originalTop + delta);
      requestAnimationFrame(() => {
        scroller.scrollTop = originalTop;
      });

      clearRetry();
      if (pulseCount < MAX_PULSES) {
        retryTimer = window.setTimeout(() => pulseScroll(side), RETRY_MS);
      }
    };

    const ensureEdgeLoad = () => {
      const pageCount = scroller.querySelectorAll(".chapter-page-frame").length;
      if (pageCount !== lastPageCount) {
        lastPageCount = pageCount;
        clearLoading();
        // 새 페이지가 붙은 뒤에도 viewport가 여전히 하단 preload 영역이면 다음 페이지
        // 로딩을 즉시 이어간다. 추가 사용자 scroll을 요구하지 않는다.
        requestAnimationFrame(() => {
          if (nearEdge("bottom") && sentinelFor("bottom")?.textContent?.trim()) pulseScroll("bottom");
          else if (nearEdge("top") && sentinelFor("top")?.textContent?.trim()) pulseScroll("top");
        });
        return;
      }

      if (nearEdge("bottom") && sentinelFor("bottom")?.textContent?.trim()) {
        if (activeSide !== "bottom") {
          clearLoading();
          pulseScroll("bottom");
        }
      } else if (nearEdge("top") && sentinelFor("top")?.textContent?.trim()) {
        if (activeSide !== "top") {
          clearLoading();
          pulseScroll("top");
        }
      } else {
        clearLoading();
      }
    };

    const observer = new MutationObserver(ensureEdgeLoad);
    observer.observe(scroller, { childList: true, subtree: true });
    scroller.addEventListener("scroll", ensureEdgeLoad, { passive: true });
    requestAnimationFrame(ensureEdgeLoad);

    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", ensureEdgeLoad);
      clearLoading();
    };
  }, []);

  return null;
}
