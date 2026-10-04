import { Card, CardContent } from "@/components/ui/card";

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 py-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-navy-800">Privacy Policy</h1>
        <p className="text-muted-foreground mt-2">Last updated: January 2026</p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4 text-sm text-muted-foreground">
          <section>
            <h2 className="font-semibold text-foreground mb-2">Information We Collect</h2>
            <p>We collect information you provide directly, such as your name, email, profile information, and content you post. We also collect usage data automatically, including device information, IP address, and browsing activity on the platform.</p>
          </section>
          <section>
            <h2 className="font-semibold text-foreground mb-2">How We Use Your Information</h2>
            <p>We use your information to provide, maintain, and improve LinkMe+, to communicate with you, to detect and prevent fraud, and to comply with legal obligations.</p>
          </section>
          <section>
            <h2 className="font-semibold text-foreground mb-2">Information Sharing</h2>
            <p>We do not sell your personal information. We may share information with service providers who help us operate the platform, as required by law, or with your consent.</p>
          </section>
          <section>
            <h2 className="font-semibold text-foreground mb-2">Data Security</h2>
            <p>We implement industry-standard security measures to protect your data. However, no method of transmission over the Internet is 100% secure.</p>
          </section>
          <section>
            <h2 className="font-semibold text-foreground mb-2">Your Rights</h2>
            <p>You can access, update, or delete your account information at any time through Settings. You may also request a copy of all data we hold about you.</p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
