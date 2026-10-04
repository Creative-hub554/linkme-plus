import { Card, CardContent } from "@/components/ui/card";

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 py-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-navy-800">Terms of Service</h1>
        <p className="text-muted-foreground mt-2">Last updated: January 2026</p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4 text-sm text-muted-foreground">
          <section>
            <h2 className="font-semibold text-foreground mb-2">1. Acceptance of Terms</h2>
            <p>By accessing or using LinkMe+, you agree to be bound by these Terms of Service. If you do not agree, do not use the platform.</p>
          </section>
          <section>
            <h2 className="font-semibold text-foreground mb-2">2. User Accounts</h2>
            <p>You must be at least 13 years old to create an account. You are responsible for maintaining the security of your account and for all activities that occur under your account.</p>
          </section>
          <section>
            <h2 className="font-semibold text-foreground mb-2">3. Content</h2>
            <p>You retain ownership of content you post. By posting content, you grant LinkMe+ a non-exclusive license to display, distribute, and promote your content on the platform.</p>
          </section>
          <section>
            <h2 className="font-semibold text-foreground mb-2">4. Marketplace</h2>
            <p>LinkMe+ facilitates transactions between buyers and sellers. We are not a party to any transaction and do not guarantee the quality, safety, or legality of items listed.</p>
          </section>
          <section>
            <h2 className="font-semibold text-foreground mb-2">5. Prohibited Conduct</h2>
            <p>You may not use LinkMe+ to post illegal, harmful, threatening, abusive, harassing, defamatory, or otherwise objectionable content. Violation may result in account suspension or termination.</p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
