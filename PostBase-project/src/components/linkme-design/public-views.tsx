"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BriefcaseBusiness,
  Globe2,
  Eye,
  EyeOff,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { MOCK_SHORTS } from "@/data/mockData";
import { GoogleIcon } from "@/components/auth/google-icon";
import { signIn } from "@/lib/auth-client";
import { useDesignReducedMotion, Media, Video } from "./primitives";

const links = [
  {
    title: "Company",
    entries: [
      ["About", "/about"],
      ["Careers", "/careers"],
      ["Press", "/press"],
    ],
  },
  {
    title: "Product",
    entries: [
      ["Marketplace", "/design/marketplace"],
      ["Jobs", "/design/jobs"],
      ["Groups", "/design/groups"],
      ["Advertising", "/ads"],
    ],
  },
  {
    title: "Support",
    entries: [
      ["Help Center", "/help"],
      ["Safety Center", "/safety"],
      ["Report Issue", "/report"],
    ],
  },
  {
    title: "Legal",
    entries: [
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
      ["Cookies", "/cookies"],
    ],
  },
];
const pillars = [
  {
    icon: Globe2,
    title: "Social, without the noise",
    body: "Share ideas and stay close to the people who matter.",
    path: "/design/home",
  },
  {
    icon: ShoppingBag,
    title: "Buy and sell with confidence",
    body: "Discover useful things and meet the people behind them.",
    path: "/design/marketplace",
  },
  {
    icon: BriefcaseBusiness,
    title: "Move your career forward",
    body: "Find roles that fit and apply with your LinkMe+ profile.",
    path: "/design/jobs",
  },
  {
    icon: Sparkles,
    title: "Make your profile yours",
    body: "Set the tone with an expressive video cover.",
    path: "/design/profile",
  },
];

export function Brand() {
  return (
    <Link className="ld-brand" href="/design">
      <span aria-hidden="true">L+</span> LinkMe+
    </Link>
  );
}

export function Landing() {
  const reduce = useDesignReducedMotion();
  const [active, setActive] = useState(0);
  return (
    <>
      <header className="ld-public-nav">
        <Brand />
        <nav aria-label="Explore LinkMe+" className="ld-public-links">
          <Link href="/design/marketplace">Marketplace</Link>
          <Link href="/design/jobs">Jobs</Link>
          <Link href="/design/groups">Groups</Link>
        </nav>
        <div className="ld-row">
          <Link href="/design/login">Sign in</Link>
          <Link
            className="ld-button ld-primary"
            href="/design/login?mode=signup"
          >
            Create account
          </Link>
        </div>
      </header>
      <main className="ld-public-main">
        <section className="ld-hero" aria-labelledby="ld-hero-heading">
          <div className="ld-hero-copy">
            <h1 id="ld-hero-heading">
              Your people.
              <br />
              <em>Your next move.</em>
            </h1>
            <p>
              Meet people who share your interests. Find your next role,
              creative project, or local find.
            </p>
            <div className="ld-row ld-hero-actions">
              <Link
                className="ld-button ld-hero-primary"
                href="/design/login?mode=signup"
              >
                Create account <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <Link className="ld-hero-demo" href="/design/home">
                Explore the demo <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <div className="ld-hero-preview">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={active}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: reduce ? 1 : 0 }}
                transition={{ duration: reduce ? 0 : 0.22 }}
                className="ld-preview-content"
              >
                {active === 0 ? (
                  <>
                    <Media
                      src="/design-media/community-hero.webp"
                      alt="Three creatives laughing together around a worktable"
                    />
                    <Link className="ld-preview-story" href="/design/groups">
                      <span className="ld-preview-icon">
                        <Globe2 size={20} aria-hidden="true" />
                      </span>
                      <span>
                        <strong>Find your community</strong>
                        <small>Explore groups</small>
                      </span>
                      <ArrowRight size={18} aria-hidden="true" />
                    </Link>
                  </>
                ) : (
                  <>
                    <Video
                      src={MOCK_SHORTS[0].videoUrl}
                      poster={MOCK_SHORTS[0].posterUrl}
                      label="Short Video Studio preview"
                    />
                    <Link className="ld-preview-story" href="/design/shorts">
                      <span className="ld-preview-icon">
                        <Sparkles size={20} aria-hidden="true" />
                      </span>
                      <span>
                        <strong>Short Video Studio</strong>
                        <small>Explore Shorts</small>
                      </span>
                      <ArrowRight size={18} aria-hidden="true" />
                    </Link>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
            <div className="ld-hero-switch" aria-label="Preview">
              {["Community", "Shorts"].map((label, index) => (
                <button
                  type="button"
                  key={label}
                  onClick={() => setActive(index)}
                  aria-pressed={active === index}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>
        <section
          aria-label="Illustrative community metrics"
          className="ld-metrics ld-glass"
        >
          {[
            ["50K+", "members"],
            ["10K+", "posts per day"],
            ["2K+", "communities"],
            ["4.9/5", "community rating"],
          ].map(([value, label]) => (
            <motion.div
              key={label}
              initial={reduce ? false : { opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <strong>{value}</strong>
              <span>{label}</span>
            </motion.div>
          ))}
          <p>Illustrative community metrics</p>
        </section>
        <section className="ld-pillars" aria-label="Explore the platform">
          {pillars.map(({ icon: Icon, title, body, path }, i) => (
            <Link key={path} className="ld-glass ld-pillar" href={path}>
              <div className="ld-row ld-between">
                <Icon size={21} />
                <span>0{i + 1}</span>
              </div>
              <h2>{title}</h2>
              <p>{body}</p>
            </Link>
          ))}
        </section>
        <footer className="ld-footer ld-glass">
          {links.map((group) => (
            <section key={group.title}>
              <h2>{group.title}</h2>
              {group.entries.map(([label, path]) => (
                <Link key={path} href={path}>
                  {label}
                </Link>
              ))}
            </section>
          ))}
          <p>© 2026 LinkMe+</p>
        </footer>
      </main>
    </>
  );
}

export function Auth({
  signup,
  setSignup,
  enter,
}: {
  signup: boolean;
  setSignup: (signup: boolean) => void;
  enter: () => void;
}) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [googleError, setGoogleError] = useState("");

  async function continueWithGoogle() {
    setGooglePending(true);
    setGoogleError("");
    try {
      const { error } = await signIn.social("google");
      if (!error) return;
    } catch {
      // The browser may fail to reach the authentication service.
    }
    setGooglePending(false);
    setGoogleError("Couldn’t start Google sign-in. Please try again.");
  }

  return (
    <main className="ld-auth">
      <div className="ld-auth-main">
        <header className="ld-auth-header">
          <Brand />
        </header>
        <section className="ld-auth-card" aria-labelledby="ld-auth-heading">
          <div className="ld-auth-heading">
            <h1 id="ld-auth-heading">
              {signup ? "Create an account" : "Sign in"}
            </h1>
            <p>
              {signup ? "Already have an account?" : "New to LinkMe+?"}{" "}
              <button
                className="ld-auth-link"
                type="button"
                onClick={() => {
                  setPasswordVisible(false);
                  setSignup(!signup);
                }}
              >
                {signup ? "Sign in" : "Create an account"}
              </button>
            </p>
          </div>
          <div className="ld-auth-provider">
            <button
              type="button"
              className="ld-button"
              disabled={googlePending}
              onClick={continueWithGoogle}
            >
              <GoogleIcon />{" "}
              {googlePending ? "Opening Google…" : "Continue with Google"}
            </button>
            {googleError && <p role="alert">{googleError}</p>}
            <p className="ld-auth-divider">or use email</p>
          </div>
          <form
            className="ld-auth-form"
            key={String(signup)}
            onSubmit={(event) => {
              event.preventDefault();
              enter();
            }}
          >
            {signup && (
              <label>
                Name
                <input autoComplete="off" required />
              </label>
            )}
            <label>
              Email
              <input type="email" autoComplete="off" required />
            </label>
            <div className="ld-auth-field">
              <label htmlFor="ld-auth-password">Password</label>
              <span className="ld-auth-password">
                <input
                  id="ld-auth-password"
                  type={passwordVisible ? "text" : "password"}
                  autoComplete="off"
                  required
                />
                <button
                  type="button"
                  className="ld-auth-reveal"
                  aria-label={
                    passwordVisible ? "Hide password" : "Show password"
                  }
                  onClick={() => setPasswordVisible(!passwordVisible)}
                >
                  {passwordVisible ? (
                    <EyeOff size={19} aria-hidden="true" />
                  ) : (
                    <Eye size={19} aria-hidden="true" />
                  )}
                </button>
              </span>
            </div>
            <button className="ld-button ld-auth-submit">
              {signup ? "Create account" : "Sign in"}
            </button>
          </form>
          <div className="ld-auth-demo">
            <Link href="/design/home">
              Continue with Demo Account{" "}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <p>
              This is a preview. Use sample details or open{" "}
              <Link
                className="ld-auth-link"
                href={signup ? "/register" : "/login"}
              >
                live {signup ? "registration" : "sign-in"}
              </Link>
              .
            </p>
          </div>
        </section>
      </div>
      <aside className="ld-auth-photo" aria-hidden="true">
        <Media src="/design-media/community-hero.webp" alt="" />
      </aside>
    </main>
  );
}
