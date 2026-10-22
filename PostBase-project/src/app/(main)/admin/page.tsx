"use client";

import { AdminStats } from "@/components/admin/admin-stats";
import { AdminUsers } from "@/components/admin/admin-users";
import { AdminModeration } from "@/components/admin/admin-moderation";
import { AdminModerationHistory } from "@/components/admin/admin-moderation-history";
import { AdminReports } from "@/components/admin/admin-reports";
import { CampaignReviewQueue } from "@/components/admin/campaign-review-queue";
import { AdminVerificationRequests } from "@/components/admin/admin-verification-requests";
import { CreatorBoostReviewQueue } from "@/components/admin/creator-boost-review-queue";
import { CreatorSupportQueue } from "@/components/admin/creator-support-queue";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BarChart3 } from "lucide-react";

/**
 * The admin dashboard.
 *
 * Everything that prints a number now prints a real one: the heading row is
 * `AdminStats` (GET /api/admin/stats) and the reports tab is `AdminReports`
 * (GET /api/admin/reports), both loading their own data — and their own
 * failure states — rather than the invented rows that used to sit here. The
 * campaigns tab keeps the review queue, the one section that has always been
 * live. The two tabs with no route behind them hold self-describing
 * placeholders, which is a placeholder that describes itself rather than a
 * placeholder that pretends.
 */
export default function AdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-800">Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your LinkMe+ platform</p>
      </div>

      {/* Computed by GET /api/admin/stats — nothing here asserts a number. */}
      <AdminStats />

      {/* Tabs */}
      <Tabs defaultValue="reports">
        {/* The four sections of the dashboard, named so that the set of them
            says what is being chosen between — the tabs themselves only name
            where each one goes. */}
        <TabsList aria-label="Admin sections">
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="verification">Verification</TabsTrigger>
          <TabsTrigger value="creator-boost">Creator Boost</TabsTrigger>
        </TabsList>

        <TabsContent value="reports" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reports</CardTitle>
            </CardHeader>
            <CardContent>
              <AdminReports />
            </CardContent>
          </Card>
        </TabsContent>

        {/* The member list the roles route serves: searchable, filtered, and
            the two moderator moves. */}
        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Members</CardTitle>
              <p className="text-sm text-muted-foreground">
                Promote to moderator and demote from it. Admin roles belong to the owner console.
              </p>
            </CardHeader>
            <CardContent>
              <AdminUsers />
            </CardContent>
          </Card>
        </TabsContent>

        {/* The moderation queue's hands and the record they write: pending
            content and account reports, decided with a required reason
            through the moderate route — then every action ever recorded,
            listed underneath with its actor, reason and date. */}
        <TabsContent value="content" className="mt-4">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Reported content</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Warn or remove reported posts and comments; suspend or ban reported accounts. Every decision carries a reason.
                </p>
              </CardHeader>
              <CardContent>
                <AdminModeration />
              </CardContent>
            </Card>

            {/* GET /api/admin/moderation-actions — the decision ledger. */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Moderation history</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Every recorded moderation action, newest first, with who made it, why and when.
                </p>
              </CardHeader>
              <CardContent>
                <AdminModerationHistory />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/*
          The one section that is not a placeholder, and the reason the tab
          exists: a boosted post cannot run until somebody who is not the
          advertiser has said it may, and this is where that happens.
        */}
        <TabsContent value="campaigns" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Boosted post campaigns</CardTitle>
              <p className="text-sm text-muted-foreground">
                Campaigns that have been paid for and are waiting for a decision from the platform.
              </p>
            </CardHeader>
            <CardContent>
              <CampaignReviewQueue />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="verification" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Account verification</CardTitle>
              <p className="text-sm text-muted-foreground">Review public links submitted by members. Approving awards the verified badge.</p>
            </CardHeader>
            <CardContent><AdminVerificationRequests /></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="creator-boost" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Creator Boost applications</CardTitle>
              <p className="text-sm text-muted-foreground">The platform owner makes the final decision. Approval awards a time-limited creator badge and discounted boosts; it does not verify identity.</p>
            </CardHeader>
            <CardContent><div className="space-y-6"><CreatorBoostReviewQueue /><div className="border-t border-surface-border pt-5"><h3 className="mb-1 text-sm font-semibold text-navy-800">Priority support</h3><p className="mb-3 text-sm text-muted-foreground">Private support requests from active Creator Boost members.</p><CreatorSupportQueue /></div></div></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <Card>
            <CardContent className="p-8 text-center">
              <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-3" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">Analytics dashboard coming soon</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
