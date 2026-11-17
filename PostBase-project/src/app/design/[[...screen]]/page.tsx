import { notFound } from "next/navigation";

const screens = new Set([
  "login",
  "home",
  "shorts",
  "marketplace",
  "jobs",
  "groups",
  "messages",
  "profile",
]);

export default async function DesignPage({
  params,
}: {
  params: Promise<{ screen?: string[] }>;
}) {
  const { screen = [] } = await params;
  if (screen.length > 1 || (screen[0] && !screens.has(screen[0]))) notFound();
  return null;
}
