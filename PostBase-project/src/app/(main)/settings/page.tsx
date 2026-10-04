"use client";

import { useAuth } from "@/components/auth-provider";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AuthenticatorSecurity } from "@/components/auth/authenticator-security";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { ProfileAvatarUpload } from "@/components/profile/profile-avatar-upload";
import { UserRound, MapPin, Sparkles, Check, Loader2, Briefcase, GraduationCap, Phone, Mail } from "lucide-react";

type Visibility = "public" | "followers" | "private";

interface ProfileForm {
  displayName: string;
  username: string;
  bio: string;
  location: string;
  website: string;
  work: string;
  education: string;
  skills: string;
  visibility: Visibility;
  contactEmail: string;
  contactPhone: string;
}

const initialForm: ProfileForm = {
  displayName: "",
  username: "",
  bio: "",
  location: "",
  website: "",
  work: "",
  education: "",
  skills: "",
  visibility: "public",
  contactEmail: "",
  contactPhone: "",
};

/** Which form fields belong to which save section. */
const sectionFields: Record<string, (keyof ProfileForm)[]> = {
  identity: ["displayName", "username"],
  basics: ["bio", "location"],
  work: ["work", "education"],
  contact: ["website", "contactEmail", "contactPhone"],
  interests: ["skills"],
  visibility: ["visibility"],
};

export default function SettingsPage() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState<ProfileForm>(initialForm);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [sectionNotice, setSectionNotice] = useState<Record<string, string>>({});
  const [sectionError, setSectionError] = useState<Record<string, string>>({});
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [profileReloadKey, setProfileReloadKey] = useState(0);
  const authAvatarUrl = user?.image ?? user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture ?? null;

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.push("/login");
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!user?.id) return;
    // Captured as a `const` so the nested `loadProfile` below keeps the
    // narrowing this guard establishes.
    const userId = user.id;
    let cancelled = false;
    const fallbackName = user.name || user.email?.split("@")[0] || "User";
    const fallbackUsername = user.username || user.email?.split("@")[0]?.replace(/[^a-z0-9_]/gi, "").slice(0, 30) || "user";
    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;

    // Render usable settings immediately from the authenticated user. A database
    // outage should show an error state, not leave the whole page spinning forever.
    setForm((current) => ({
      ...current,
      displayName: current.displayName || fallbackName,
      username: current.username || fallbackUsername,
      website: current.website || (typeof metadata.website === "string" ? metadata.website : ""),
      work: current.work || (typeof metadata.work === "string" ? metadata.work : ""),
      education: current.education || (typeof metadata.education === "string" ? metadata.education : ""),
      contactEmail: current.contactEmail || (typeof metadata.contact_email === "string" ? metadata.contact_email : ""),
      contactPhone: current.contactPhone || (typeof metadata.contact_phone === "string" ? metadata.contact_phone : ""),
    }));
    setAvatarUrl(authAvatarUrl);

    async function loadProfile() {
      setLoadingProfile(true);
      setSectionError({});
      try {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 10000);
        const response = await fetch(`/api/users?id=${encodeURIComponent(userId)}`, { signal: controller.signal });
        window.clearTimeout(timeout);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Unable to load your profile");
        if (!cancelled && payload.user) {
          const profile = payload.user;
          setAvatarUrl(profile.avatarUrl || authAvatarUrl);
          setForm({
            displayName: profile.displayName || fallbackName,
            username: profile.username || fallbackUsername,
            bio: profile.bio || "",
            location: profile.location || "",
            website: (profile as Record<string, unknown>).website as string || "",
            work: (profile as Record<string, unknown>).work as string || "",
            education: (profile as Record<string, unknown>).education as string || "",
            skills: Array.isArray(profile.skills) ? profile.skills.join(", ") : "",
            visibility: profile.visibility || "public",
            contactEmail: (profile as Record<string, unknown>).contactEmail as string || "",
            contactPhone: (profile as Record<string, unknown>).contactPhone as string || "",
          });
        }
      } catch (loadError) {
        if (!cancelled) {
          setSectionError({
            load: loadError instanceof DOMException && loadError.name === "AbortError"
              ? "Profile loading timed out. You can still edit the settings below."
              : loadError instanceof Error
                ? loadError.message
                : "Unable to load your profile",
          });
        }
      } finally {
        if (!cancelled) {
          setProfileLoaded(true);
          setLoadingProfile(false);
        }
      }
    }

    void loadProfile();
    return () => { cancelled = true; };
    // `user.user_metadata` is the session's own object (see `useSession`), so its
    // reference is stable across renders and will not re-run this effect.
  }, [user?.id, user?.name, user?.username, user?.email, user?.user_metadata, authAvatarUrl, profileReloadKey]);

  const update = (key: keyof ProfileForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSectionNotice((current) => {
      if (!(key in sectionFields) || !sectionFields) return current;
      const next = { ...current };
      for (const [section, fields] of Object.entries(sectionFields)) {
        if (fields.includes(key)) delete next[section];
      }
      return next;
    });
    setSectionError((current) => {
      const next = { ...current };
      for (const [section, fields] of Object.entries(sectionFields)) {
        if (fields.includes(key)) delete next[section];
      }
      return next;
    });
  };

  const saveSection = async (section: keyof typeof sectionFields) => {
    setSavingSection(section);
    const sectionMessages: Record<string, string> = {};
    const sectionErrors: Record<string, string> = {};

    try {
      if (section === "identity") {
        const username = form.username.trim().toLowerCase();
        if (!/^[a-z0-9_]{3,30}$/.test(username)) {
          throw new Error("Username must be 3–30 characters using only letters, numbers, or underscores.");
        }
        if (!form.displayName.trim()) {
          throw new Error("Please add a display name.");
        }
        sectionMessages.identity = "Identity saved.";
      }

      if (section === "basics") {
        sectionMessages.basics = "Basic information saved.";
      }

      if (section === "work") {
        sectionMessages.work = "Work and education saved.";
      }

      if (section === "contact") {
        if (form.contactEmail && !/^\S+@\S+\.\S+$/.test(form.contactEmail.trim())) {
          throw new Error("Please enter a valid contact email.");
        }
        sectionMessages.contact = "Contact details saved.";
      }

      if (section === "interests") {
        sectionMessages.interests = "Interests saved.";
      }

      if (section === "visibility") {
        sectionMessages.visibility = "Visibility saved.";
      }

      const response = await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: section === "identity" ? form.displayName.trim() : undefined,
          username: section === "identity" ? form.username.trim().toLowerCase() : undefined,
          bio: section === "basics" ? form.bio.trim() || null : undefined,
          location: section === "basics" ? form.location.trim() || null : undefined,
          work: section === "work" ? form.work.trim() || null : undefined,
          education: section === "work" ? form.education.trim() || null : undefined,
          website: section === "contact" ? form.website.trim() || null : undefined,
          contactEmail: section === "contact" ? form.contactEmail.trim() || null : undefined,
          contactPhone: section === "contact" ? form.contactPhone.trim() || null : undefined,
          skills: section === "interests" ? form.skills.split(",").map((skill) => skill.trim()).filter(Boolean).slice(0, 12) : undefined,
          visibility: section === "visibility" ? form.visibility : undefined,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to save changes");

      if (section === "identity") {
        const username = form.username.trim().toLowerCase();
        setForm((current) => ({ ...current, username }));
      }

      setSectionNotice(sectionMessages);
      setSectionError({});
    } catch (saveError) {
      sectionErrors[section] = saveError instanceof Error ? saveError.message : "Unable to save changes";
      setSectionError((current) => ({ ...current, ...sectionErrors }));
    } finally {
      setSavingSection(null);
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-brand-blue" aria-label="Loading settings" /></div>;
  }
  if (!user) return null;
  if (loadingProfile && !profileLoaded) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-brand-blue" aria-label="Loading settings" /></div>;
  }

  const SectionFooter = ({ section, extraButton }: { section: keyof typeof sectionFields; extraButton?: React.ReactNode }) => (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      {extraButton}
      <Button
        type="button"
        disabled={savingSection === section}
        onClick={() => void saveSection(section)}
      >
        {savingSection === section && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {savingSection === section ? "Saving..." : `Save ${section === "identity" ? "identity" : section === "basics" ? "basic info" : section === "work" ? "work & education" : section === "contact" ? "contact details" : section === "interests" ? "interests" : "visibility"}`}
      </Button>
    </div>
  );

  const SectionNotice = ({ section }: { section: string }) => (
    <>
      {sectionError[section] && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {sectionError[section]}
        </div>
      )}
      {sectionNotice[section] && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          <Check className="h-4 w-4" />
          {sectionNotice[section]}
        </div>
      )}
    </>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-blue">Account</p>
        <h1 className="mt-2 text-2xl font-bold text-navy-800">Profile settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Each profile section saves independently — update just what you need.</p>
      </div>

      <AppearanceSettings />

      {sectionError.load && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          <span>{sectionError.load}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => { setSectionError((current) => ({ ...current, load: "" })); setProfileReloadKey((key) => key + 1); }}>Retry</Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UserRound className="h-5 w-5 text-brand-blue" /> Identity</CardTitle>
          <CardDescription>Your name and username are shown on your public profile.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <ProfileAvatarUpload name={form.displayName || user.name || "User"} avatarUrl={avatarUrl} onUploaded={(url) => setAvatarUrl(url)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="display-name">Display name</Label>
              <Input id="display-name" value={form.displayName} onChange={(event) => update("displayName", event.target.value)} maxLength={50} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-sm text-muted-foreground">@</span>
                <Input id="username" value={form.username} onChange={(event) => update("username", event.target.value.replace(/\s/g, ""))} maxLength={30} className="pl-7" required />
              </div>
              <p className="text-xs text-muted-foreground">Letters, numbers, and underscores only.</p>
            </div>
          </div>
          <SectionNotice section="identity" />
          <SectionFooter section="identity" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5 text-brand-blue" /> Basic information</CardTitle>
          <CardDescription>Tell people a little about yourself and where you are.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea id="bio" value={form.bio} onChange={(event) => update("bio", event.target.value)} placeholder="Tell people what you're about" maxLength={500} />
            <p className="text-right text-xs text-muted-foreground">{form.bio.length}/500</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input id="location" value={form.location} onChange={(event) => update("location", event.target.value)} placeholder="City, country" className="pl-9" maxLength={100} />
            </div>
          </div>
          <SectionNotice section="basics" />
          <SectionFooter section="basics" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Briefcase className="h-5 w-5 text-brand-blue" /> Work & education</CardTitle>
          <CardDescription>Show your current role and studies on your profile.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="work">Work</Label>
            <div className="relative">
              <Briefcase className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input id="work" value={form.work} onChange={(event) => update("work", event.target.value)} placeholder="e.g. Product Designer at TechCo" className="pl-9" maxLength={120} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="education">Education</Label>
            <div className="relative">
              <GraduationCap className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input id="education" value={form.education} onChange={(event) => update("education", event.target.value)} placeholder="e.g. Stanford University" className="pl-9" maxLength={120} />
            </div>
          </div>
          <SectionNotice section="work" />
          <SectionFooter section="work" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Phone className="h-5 w-5 text-brand-blue" /> Contact details</CardTitle>
          <CardDescription>Choose how people can reach you. This appears on your profile.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="website">Website</Label>
            <Input id="website" value={form.website} onChange={(event) => update("website", event.target.value)} placeholder="https://yourwebsite.com" maxLength={200} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contact-email">Contact email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input id="contact-email" type="email" value={form.contactEmail} onChange={(event) => update("contactEmail", event.target.value)} placeholder="you@example.com" className="pl-9" maxLength={200} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-phone">Contact phone</Label>
              <Input id="contact-phone" type="tel" value={form.contactPhone} onChange={(event) => update("contactPhone", event.target.value)} placeholder="+855 12 345 678" maxLength={30} />
            </div>
          </div>
          <SectionNotice section="contact" />
          <SectionFooter section="contact" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-brand-purple" /> Interests & skills</CardTitle>
          <CardDescription>Help people discover what you care about.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="skills">Interests and skills</Label>
            <Input id="skills" value={form.skills} onChange={(event) => update("skills", event.target.value)} placeholder="Design, photography, hiking" />
            <p className="text-xs text-muted-foreground">Separate interests with commas.</p>
          </div>
          <SectionNotice section="interests" />
          <SectionFooter section="interests" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-brand-purple" /> Profile visibility</CardTitle>
          <CardDescription>Choose who can see your profile.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="visibility">Who can see your profile?</Label>
            <Select value={form.visibility} onValueChange={(value: Visibility) => update("visibility", value)}>
              <SelectTrigger id="visibility"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Everyone on LinkMe+</SelectItem>
                <SelectItem value="followers">Followers only</SelectItem>
                <SelectItem value="private">Only me</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-surface-border bg-surface-light-blue/40 p-4">
            <div>
              <p className="text-sm font-medium text-navy-800">Show profile in discovery</p>
              <p className="mt-1 text-xs text-muted-foreground">Your profile can appear in search and Discover recommendations.</p>
            </div>
            <Switch checked={form.visibility === "public"} onCheckedChange={(checked) => update("visibility", checked ? "public" : "followers")} aria-label="Show profile in discovery" />
          </div>
          <SectionNotice section="visibility" />
          <SectionFooter section="visibility" />
        </CardContent>
      </Card>

      <Separator />

      <AuthenticatorSecurity />

      <Card>
        <CardHeader><CardTitle>Email</CardTitle><CardDescription>Your login email is managed by your authentication provider.</CardDescription></CardHeader>
        <CardContent><Input type="email" value={user.email || ""} disabled aria-label="Email address" /></CardContent>
      </Card>
    </div>
  );
}
