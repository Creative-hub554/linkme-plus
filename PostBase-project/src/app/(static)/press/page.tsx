import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function PressPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 py-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-navy-800">Press</h1>
        <p className="text-muted-foreground mt-2">News, announcements, and media resources</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle level={2} className="text-base">
            Latest Announcements
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div>
            <p className="font-medium text-foreground">LinkMe+ opens its marketplace to every member</p>
            <p>January 2026 — Listings, categories, and community selling are now live for all accounts.</p>
          </div>
          <div>
            <p className="font-medium text-foreground">Groups arrive on LinkMe+</p>
            <p>Communities with their own members, categories, and discussions launch across the platform.</p>
          </div>
          <div>
            <p className="font-medium text-foreground">A jobs board built into the network</p>
            <p>Members can now discover and apply to openings without leaving their community.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle level={2} className="text-base">
            Media Contact
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            For interviews, commentary, or press materials, write to{" "}
            <span className="text-brand-blue">press@linkmeplus.com</span>. We answer within two
            business days.
          </p>
          <p>
            Please do not send product support questions to this address — the{" "}
            <a href="/help" className="text-brand-blue hover:underline">
              Help Center
            </a>{" "}
            is the fastest route to an answer.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle level={2} className="text-base">
            About LinkMe+
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            LinkMe+ is a community and professional platform where people publish content, build
            audiences, sell products, and discover work. See{" "}
            <a href="/about" className="text-brand-blue hover:underline">
              About
            </a>{" "}
            for the short version.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
