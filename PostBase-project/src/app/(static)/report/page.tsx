import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ReportPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 py-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-navy-800">Report an Issue</h1>
        <p className="text-muted-foreground mt-2">Something wrong? Tell the team directly</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle level={2} className="text-base">
            Report content or a member
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            For a specific post, listing, comment, or account, use the report control on it — the
            three-dot menu on any surface. That routes your report with the content attached, which
            is the fastest path to a review, and it is always confidential.
          </p>
          <p>
            Not sure which rule applies? The{" "}
            <a href="/terms" className="text-brand-blue hover:underline">
              Terms of Service
            </a>{" "}
            lists what the platform does not allow, and the{" "}
            <a href="/safety" className="text-brand-blue hover:underline">
              Safety Center
            </a>{" "}
            explains how reports are handled.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle level={2} className="text-base">
            Report a technical problem
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Broken page, failed payment, something that will not load? Send the page you were on,
            what you expected, and what happened instead to{" "}
            <span className="text-brand-blue">support@linkmeplus.com</span>. A screenshot helps more
            than anything else you can attach.
          </p>
          <p>
            Security-sensitive findings — anything that might expose data or let someone act as
            someone else — should not go through the public report queue. Mark them clearly in the
            same inbox and they will be handled by the team, not the queue.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle level={2} className="text-base">
            What happens next
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Every report is read. Content reports get a decision, usually within a day; technical
            reports get a reply with what we found. You will hear back either way.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
