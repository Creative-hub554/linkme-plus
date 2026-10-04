import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function CareersPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 py-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-navy-800">Careers at LinkMe+</h1>
        <p className="text-muted-foreground mt-2">Help us build where community meets opportunity</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle level={2} className="text-base">
            Why LinkMe+
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            We are a small team building a platform where people find their people, sell what they
            make, and discover their next move. The work is broad — social feeds, marketplace
            commerce, jobs, and communities — and every engineer, designer, and operator here shapes
            the product directly.
          </p>
          <p>We work in the open, ship weekly, and treat user safety as a feature, not a cost.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle level={2} className="text-base">
            Open Roles
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            There are no open roles right now. When one opens, it will be posted here first, and we
            announce every opening to our community feeds as well.
          </p>
          <p>
            Nothing that matches your craft? Send a short note about what you would build to{" "}
            <span className="text-brand-blue">careers@linkmeplus.com</span> and we will keep it on
            file for the next opening.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle level={2} className="text-base">
            What We Offer
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div>
            <p className="font-medium text-foreground">Meaningful ownership</p>
            <p>Small surface area per person; your work ships to every member of the community.</p>
          </div>
          <div>
            <p className="font-medium text-foreground">A safety-first culture</p>
            <p>Trust and safety sit in the room where decisions are made, not after them.</p>
          </div>
          <div>
            <p className="font-medium text-foreground">Sustainable pace</p>
            <p>We build for the long term, and we expect the team to last with it.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
