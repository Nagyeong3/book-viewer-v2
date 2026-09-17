"use client";

import { useEffect } from "react";

const NEAR_EDGE_PX = 900;
const RETRIGGER_COOLDOWN_MS = 700;

export default function ScrollLoadGuard() {
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>(".chapter-scroll");
    if (!scroller) return;
    let cooldownUntil = 0;
    let lastPageCount = scroller.querySelectorAll(".chapter-page-frame").length;

    const retriggerSentinel = (sentinel: HTMLElement) => {
      const now = performance.now();
      if (now < cooldownUntil || !sentinel.textContent?.trim()) return;
      cooldownUntil = now + RETRIGGER_COOLDOWN_MS;
      const previousVisibility = sentinel.style.visibility;
      const previousTransform = sentinel.style.transform;
      sentinel.style.visibility = "hidden";
      sentinel.style.transform = "translateY(1200px)";
      requestAnimationFrame(() => requestAnimationFrame(() => {
        sentinel.style.visibility = previousVisibility;
        sentinel.style.transform = previousTransform;
      }));
    };

    const onScroll = () => {
      const pageCount = scroller.querySelectorAll(".chapter-page-frame").length;
      if (pageCount !== lastPageCount) {
        lastPageCount = pageCount;
        cooldownUntil = 0;
      }
      const distanceBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      if (distanceBottom <= NEAR_EDGE_PX) {
        const bottom = scroller.querySelector<HTMLElement>(".page-load-sentinel:last-child");
        if (bottom) retriggerSentinel(bottom);
      } else if (scroller.scrollTop <= NEAR_EDGE_PX) {
        const top = scroller.querySelector<HTMLElement>(".page-load-sentinel:first-child");
        if (top) retriggerSentinel(top);
      }
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  return null;
}
