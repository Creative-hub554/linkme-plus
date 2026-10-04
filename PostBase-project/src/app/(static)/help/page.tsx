import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const faqs = [
  { q: "How do I create an account?", a: "Click Sign Up and follow the registration process. You can sign up with email, Google, or Facebook." },
  { q: "How do I list an item on the Marketplace?", a: "Go to Marketplace and click Sell Item. Fill in the details, add photos, and set your price." },
  { q: "How do I apply for a job?", a: "Browse the Jobs board, find a position you like, and click Apply. You can attach your resume and cover letter." },
  { q: "How do I report inappropriate content?", a: "Click the three-dot menu on any post, listing, or profile and select Report." },
  { q: "How do I change my password?", a: "Go to Settings, then Security, and click Change Password." },
  { q: "How do I delete my account?", a: "Go to Settings, then Account, scroll to the bottom, and click Delete Account." },
];

export default function HelpPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 py-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-navy-800">Help Center</h1>
        <p className="text-muted-foreground mt-2">Find answers and get support</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle level={2} className="text-base">
            Frequently Asked Questions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {faqs.map((faq) => (
            <div key={faq.q} className="space-y-1">
              <p className="font-medium text-sm">{faq.q}</p>
              <p className="text-sm text-muted-foreground">{faq.a}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 text-center">
          <p className="text-sm text-muted-foreground">Still need help?</p>
          <p className="text-sm mt-1">Email us at <span className="text-brand-blue">support@linkmeplus.com</span></p>
        </CardContent>
      </Card>
    </div>
  );
}
