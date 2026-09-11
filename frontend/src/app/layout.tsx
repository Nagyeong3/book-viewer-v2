import type { ReactNode } from "react";

export const metadata = {
  title: "Book Viewer V2",
  description: "Booklet viewer and RAG chatbot",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
