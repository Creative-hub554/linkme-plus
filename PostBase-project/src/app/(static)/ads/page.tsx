import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdvertisingPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 py-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-navy-800">Advertising on LinkMe+</h1>
        <p className="text-muted-foreground mt-2">Reach communities, not just feeds</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle level={2} className="text-base">
            Why advertise here
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            LinkMe+ members gather around things they care about — marketplaces, job hunting, and
            communities built on shared interests. Advertising on the platform reaches people in
            that mindset, in context, without following them around the web.
          </p>
          <p>
            Placements are clearly labelled, never injected into private conversations, and never
            targeted with information you did not choose to share. The rules are spelled out in our{" "}
            <a href="/ad-policy" className="text-brand-blue hover:underline">
              Advertising Policy
            </a>
            .
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle level={2} className="text-base">
            What is available
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div>
            <p className="font-medium text-foreground">Feed placements</p>
            <p>Labelled promotions between organic posts, ranked by relevance to the viewer.</p>
          </div>
          <div>
            <p className="font-medium text-foreground">Marketplace sponsorships</p>
            <p>Featured placement in a category for products that fit what the browser is shopping for.</p>
          </div>
          <div>
            <p className="font-medium text-foreground">Jobs and community partnerships</p>
            <p>Sponsored openings and community programs, reviewed before they run.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle level={2} className="text-base">
            Get in touch
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            Tell us what you would like to promote and who it is for:{" "}
            <span className="text-brand-blue">advertising@linkmeplus.com</span>. We will reply with
            current availability and rates.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
