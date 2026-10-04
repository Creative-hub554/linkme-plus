import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-surface-border bg-ink-800 text-navy-200">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-white mb-3">LinkMe<span className="text-brand-purple">+</span></h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/about" className="hover:text-white">About</Link></li>
              <li><Link href="/careers" className="hover:text-white">Careers</Link></li>
              <li><Link href="/press" className="hover:text-white">Press</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Product</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/marketplace" className="hover:text-white">Marketplace</Link></li>
              <li><Link href="/jobs" className="hover:text-white">Jobs</Link></li>
              <li><Link href="/groups" className="hover:text-white">Groups</Link></li>
              <li><Link href="/ads" className="hover:text-white">Advertising</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Support</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/help" className="hover:text-white">Help Center</Link></li>
              <li><Link href="/safety" className="hover:text-white">Safety Center</Link></li>
              <li><Link href="/report" className="hover:text-white">Report Issue</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Legal</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/terms" className="hover:text-white">Terms of Service</Link></li>
              <li><Link href="/privacy" className="hover:text-white">Privacy Policy</Link></li>
              <li><Link href="/cookies" className="hover:text-white">Cookie Policy</Link></li>
              <li><Link href="/ad-policy" className="hover:text-white">Advertising Policy</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-8 border-t border-ink-700 pt-4 text-center text-sm text-navy-400">
          &copy; {new Date().getFullYear()} LinkMe+. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
