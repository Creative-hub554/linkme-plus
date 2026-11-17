import { Suspense } from "react";
import type { Metadata } from "next";
import { LinkMeDesign } from "@/components/linkme-design/linkme-design";

export const metadata: Metadata = {
  title: "LinkMe+ Design Preview",
  robots: { index: false, follow: false },
};

export default function DesignLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Suspense
        fallback={<main aria-busy="true">Loading design preview…</main>}
      >
        <LinkMeDesign />
      </Suspense>
      {children}
    </>
  );
}
