import type { ReactNode } from "react";
import "./globals.css";
import "./page-preview.css";
import "./workspace-v2.css";
import "./workspace-media.css";

export const metadata = {
  title: "Book Viewer V2",
  description: "Booklet viewer and Agentic RAG workspace",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
