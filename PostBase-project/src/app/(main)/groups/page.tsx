"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { GroupCard } from "@/components/groups/group-card";
import { FilterChip } from "@/components/shared/filter-chip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, Plus, TrendingUp, Users, Loader2, Compass, RefreshCw } from "lucide-react";

interface Group {
  id: string;
  name: string;
  description?: string | null;
  coverUrl?: string | null;
  visibility?: string;
  categoryId?: string | null;
  categoryName?: string | null;
  memberCount: number;
  isMember: boolean;
}

const categories = ["All", "Joined", "New"];

export default function GroupsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState({ name: "", description: "", visibility: "public" });

  const loadGroups = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/groups?limit=50");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load communities");
      setGroups(payload.data || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load communities");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user) void loadGroups();
  }, [authLoading, user]);

  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return groups.filter((group) => {
      const matchesSearch = !query || group.name.toLowerCase().includes(query) || (group.description || "").toLowerCase().includes(query);
      const matchesView = selectedCategory === "All" || (selectedCategory === "Joined" && group.isMember) || (selectedCategory === "New" && group.memberCount <= 10);
      return matchesSearch && matchesView;
    });
  }, [groups, searchQuery, selectedCategory]);

  const updateMembership = (groupId: string, isMember: boolean) => {
    setGroups((current) => current.map((group) => group.id === groupId ? { ...group, isMember, memberCount: Math.max(0, group.memberCount + (isMember ? 1 : -1)) } : group));
  };

  async function createGroup(event: React.FormEvent) {
    event.preventDefault();
    if (!newGroup.name.trim()) return setCreateError("Add a name for your community.");
    setCreating(true);
    setCreateError(null);
    try {
      const response = await fetch("/api/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...newGroup, name: newGroup.name.trim(), description: newGroup.description.trim() }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to create community");
      setGroups((current) => [{ ...payload.group, memberCount: 1, isMember: true }, ...current]);
      setNewGroup({ name: "", description: "", visibility: "public" });
      setDialogOpen(false);
    } catch (createFailure) {
      setCreateError(createFailure instanceof Error ? createFailure.message : "Unable to create community");
    } finally {
      setCreating(false);
    }
  }

  const joinedGroups = groups.filter((group) => group.isMember).slice(0, 5);

  if (authLoading) {
    return <div className="mx-auto max-w-3xl py-16 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-blue" aria-label="Loading community" /></div>;
  }

  if (!user) {
    return <Card className="mx-auto max-w-xl"><CardContent className="flex flex-col items-center py-16 text-center"><Users className="h-10 w-10 text-brand-blue/60" /><h1 className="mt-4 text-xl font-bold text-navy-800">Join the community</h1><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Sign in to discover communities, join conversations, and create your own group.</p><div className="mt-5 flex gap-2"><Button asChild><Link href="/login">Sign in</Link></Button><Button asChild variant="outline"><Link href="/register">Create account</Link></Button></div></CardContent></Card>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-purple">Community</p><h1 className="mt-2 text-2xl font-bold text-navy-800">Find your people</h1><p className="mt-1 text-sm text-muted-foreground">Join conversations that move you forward.</p></div>
        <Button onClick={() => { setCreateError(null); setDialogOpen(true); }}><Plus className="mr-2 h-4 w-4" />Create community</Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search communities" placeholder="Search communities..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="bg-card pl-9" /></div>
          <div role="group" aria-label="Filter communities" className="flex gap-2 overflow-x-auto pb-1">{categories.map((category) => <FilterChip key={category} selected={selectedCategory === category} onClick={() => setSelectedCategory(category)}>{category}</FilterChip>)}</div>

          {loading ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-56 animate-pulse rounded-xl border border-surface-border bg-card" />)}</div> : error ? <Card><CardContent className="flex flex-col items-center gap-3 py-12 text-center"><p className="text-sm text-red-600">{error}</p><Button variant="outline" onClick={() => void loadGroups()}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button></CardContent></Card> : filteredGroups.length ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{filteredGroups.map((group) => <GroupCard key={group.id} {...group} category={group.categoryName || undefined} onMembershipChange={updateMembership} />)}</div> : <Card><CardContent className="flex flex-col items-center py-14 text-center"><Compass className="h-10 w-10 text-brand-blue/50" /><h2 className="mt-3 font-semibold text-navy-800">No communities found</h2><p className="mt-1 text-sm text-muted-foreground">Try another search or create the first community around this idea.</p></CardContent></Card>}
        </div>

        <aside className="space-y-4">
          <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-brand-blue" />Your communities</CardTitle></CardHeader><CardContent>{joinedGroups.length ? <div className="space-y-2">{joinedGroups.map((group) => <div key={group.id} className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-surface-light-blue"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-blue/10 font-bold text-brand-blue">{group.name[0]}</div><div className="min-w-0"><p className="truncate text-sm font-medium text-navy-800">{group.name}</p><p className="text-xs text-muted-foreground">{group.memberCount.toLocaleString()} members</p></div></div>)}</div> : <p className="text-sm text-muted-foreground">Join a community to see it here.</p>}</CardContent></Card>
          <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4 text-brand-purple" />Popular topics</CardTitle></CardHeader><CardContent><div className="flex flex-wrap gap-2">{["JavaScript", "React", "Design", "Startups", "Wellness", "Photography"].map((topic) => <Badge key={topic} variant="secondary">#{topic}</Badge>)}</div></CardContent></Card>
        </aside>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent><DialogHeader><DialogTitle>Create a community</DialogTitle><DialogDescription>Give people a welcoming place to share, learn, and connect.</DialogDescription></DialogHeader><form onSubmit={createGroup} className="space-y-4"><div className="space-y-2"><Label htmlFor="group-name">Community name</Label><Input id="group-name" value={newGroup.name} onChange={(event) => setNewGroup({ ...newGroup, name: event.target.value })} placeholder="e.g. Creative Builders" maxLength={100} required /></div><div className="space-y-2"><Label htmlFor="group-description">Description</Label><Textarea id="group-description" value={newGroup.description} onChange={(event) => setNewGroup({ ...newGroup, description: event.target.value })} placeholder="What is this community about?" maxLength={500} /></div>{createError && <p role="alert" className="text-sm text-red-600">{createError}</p>}<DialogFooter><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button type="submit" disabled={creating}>{creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{creating ? "Creating..." : "Create community"}</Button></DialogFooter></form></DialogContent></Dialog>
    </div>
  );
}
