"use client";

import { useEffect, useState } from "react";

const ALLOWED_TAGS = new Set([
  "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD", "CAPTION",
  "COLGROUP", "COL", "BR", "STRONG", "B", "EM", "I", "SPAN", "P",
]);

const ALLOWED_ATTRS = new Set([
  "rowspan", "colspan", "scope", "align", "valign", "width", "height",
]);

function sanitizeTableHtml(html: string): string {
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(html, "text/html");

  documentNode.querySelectorAll("script, style, iframe, object, embed, link, meta").forEach((node) => node.remove());

  for (const element of Array.from(documentNode.body.querySelectorAll("*"))) {
    if (!ALLOWED_TAGS.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (!ALLOWED_ATTRS.has(name)) element.removeAttribute(attribute.name);
    }
  }

  return documentNode.body.innerHTML;
}

export default function TableHtml({ html }: { html: string | undefined | null }) {
  const [safeHtml, setSafeHtml] = useState("");

  useEffect(() => {
    const source = html?.trim() ?? "";
    setSafeHtml(source ? sanitizeTableHtml(source) : "");
  }, [html]);

  if (!html?.trim()) return <div className="coordinate-table table-html-empty">표</div>;

  return (
    <div
      className="coordinate-table table-html"
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}
