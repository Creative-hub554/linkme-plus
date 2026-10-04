import { Card, CardContent } from "@/components/ui/card";

export default function CookiesPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 py-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-navy-800">Cookie Policy</h1>
        <p className="text-muted-foreground mt-2">Last updated: January 2026</p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4 text-sm text-muted-foreground">
          <section>
            <h2 className="font-semibold text-foreground mb-2">What cookies are</h2>
            <p>
              Cookies are small files a site stores in your browser. LinkMe+ uses a small number of
              them, and this page says exactly what each kind is for. The{" "}
              <a href="/privacy" className="text-brand-blue hover:underline">
                Privacy Policy
              </a>{" "}
              covers the data behind them.
            </p>
          </section>
          <section>
            <h2 className="font-semibold text-foreground mb-2">Cookies we use</h2>
            <p>
              <strong className="text-foreground">Session cookies</strong> keep you signed in as
              you move between pages. Without them, every page load would ask you to sign in again.
              They expire when you sign out or close your browser.
            </p>
            <p className="mt-2">
              <strong className="text-foreground">Preference cookies</strong> remember choices you
              make — view settings and similar conveniences — so the platform behaves the way you
              left it.
            </p>
          </section>
          <section>
            <h2 className="font-semibold text-foreground mb-2">What we do not use</h2>
            <p>
              LinkMe+ carries no third-party advertising or tracking cookies. Nothing here follows
              you to other sites, and no advertising network reads LinkMe+ cookies. If advertising
              is ever introduced, it will follow the{" "}
              <a href="/ad-policy" className="text-brand-blue hover:underline">
                Advertising Policy
              </a>{" "}
              and this page will be updated first.
            </p>
          </section>
          <section>
            <h2 className="font-semibold text-foreground mb-2">Your choices</h2>
            <p>
              Every browser lets you delete cookies or block them per site. Blocking session
              cookies will sign you out and keep you signed out, but every public page of the
              platform remains readable.
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
