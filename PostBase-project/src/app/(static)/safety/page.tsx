import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SafetyPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 py-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-navy-800">Safety Center</h1>
        <p className="text-muted-foreground mt-2">Staying safe on LinkMe+, and what we do about it</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle level={2} className="text-base">
            Report anything that breaks the rules
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Every post, listing, comment, and profile has a report control — use it. Reports go to
            the moderation queue and are reviewed by people, not just filters. For anything urgent,
            use{" "}
            <a href="/report" className="text-brand-blue hover:underline">
              Report Issue
            </a>{" "}
            to reach the team directly.
          </p>
          <p>
            You are never required to explain why a post made you uncomfortable to have it
            reviewed. Reporting is confidential.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle level={2} className="text-base">
            Marketplace safety
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Keep conversations and payments on the platform until you are confident in the other
            party. Dealings moved off-platform lose every protection the{" "}
            <a href="/terms" className="text-brand-blue hover:underline">
              Terms of Service
            </a>{" "}
            and the moderation team can offer.
          </p>
          <p>
            If a listing looks too good to be true, or a buyer pushes you to ship before payment
            clears, report it before you transact.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle level={2} className="text-base">
            Your tools
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div>
            <p className="font-medium text-foreground">Block and mute</p>
            <p>From any profile. Blocking removes every interaction between the two accounts, both ways.</p>
          </div>
          <div>
            <p className="font-medium text-foreground">Visibility controls</p>
            <p>Private accounts and followers-only posts are enforced on every endpoint, not just the feed.</p>
          </div>
          <div>
            <p className="font-medium text-foreground">Data control</p>
            <p>Access, correct, or delete your information at any time — see the{" "}
              <a href="/privacy" className="text-brand-blue hover:underline">
                Privacy Policy
              </a>{" "}
              for how.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
