import { Card, CardContent } from "@/components/ui/card";

export default function AdPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 py-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-navy-800">Advertising Policy</h1>
        <p className="text-muted-foreground mt-2">Last updated: January 2026</p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4 text-sm text-muted-foreground">
          <section>
            <h2 className="font-semibold text-foreground mb-2">Clearly labelled, always</h2>
            <p>
              Paid content on LinkMe+ is labelled as paid. Nothing that someone paid to place is
              ever presented as an organic post, an ordinary listing, or a community member&rsquo;s
              recommendation.
            </p>
          </section>
          <section>
            <h2 className="font-semibold text-foreground mb-2">What we do not allow</h2>
            <p>
              No advertising for illegal goods or services, weapons, adult content, gambling,
              deceptive financial products, or anything the{" "}
              <a href="/terms" className="text-brand-blue hover:underline">
                Terms of Service
              </a>{" "}
              prohibits members from posting. Ads that discriminate by who they exclude, or that
              impersonate platform features, are rejected.
            </p>
          </section>
          <section>
            <h2 className="font-semibold text-foreground mb-2">Targeting limits</h2>
            <p>
              Advertisers may reach categories of interest on the platform. They do not get access
              to member identities, private content, or contact information, and sensitive
              attributes are never targeting inputs.
            </p>
          </section>
          <section>
            <h2 className="font-semibold text-foreground mb-2">Member control</h2>
            <p>
              You can always tell paid content apart from organic content. If you believe an
              advertiser crossed a line, report the ad through the{" "}
              <a href="/report" className="text-brand-blue hover:underline">
                Report Issue
              </a>{" "}
              channel — paid placements are held to the same standards as member content, and
              removal applies to the whole campaign, not one instance.
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
