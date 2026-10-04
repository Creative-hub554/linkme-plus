"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Users, FileText, Flag, BarChart3, Settings, AlertTriangle, CheckCircle, Clock } from "lucide-react";

const stats = [
  { label: "Total Users", value: "12,456", change: "+234 this week", icon: Users },
  { label: "Active Posts", value: "3,892", change: "+156 today", icon: FileText },
  { label: "Reports Pending", value: "23", change: "5 urgent", icon: Flag },
  { label: "Revenue", value: "$4,567", change: "+12% vs last month", icon: BarChart3 },
];

const recentReports = [
  { id: "1", type: "Spam", content: "User posting crypto scams", status: "pending", reportedAt: "2h ago" },
  { id: "2", type: "Harassment", content: "Inappropriate comments on post", status: "pending", reportedAt: "4h ago" },
  { id: "3", type: "Fake Account", content: "Impersonating a public figure", status: "reviewed", reportedAt: "1d ago" },
  { id: "4", type: "Spam", content: "Multiple duplicate listings", status: "resolved", reportedAt: "2d ago" },
];

const pendingUsers = [
  { id: "1", name: "John Doe", email: "john@example.com", signedUp: "1h ago" },
  { id: "2", name: "Jane Smith", email: "jane@example.com", signedUp: "3h ago" },
];

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy-800">Admin Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your LinkMe+ platform</p>
        </div>
        <Button variant="outline">
          <Settings className="h-4 w-4 mr-2" />
          Settings
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-bold text-navy-800 mt-1">{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stat.change}</p>
                </div>
                <div className="h-10 w-10 rounded-lg bg-brand-blue/10 flex items-center justify-center">
                  <stat.icon className="h-5 w-5 text-brand-blue" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

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
        </TabsList>

        <TabsContent value="reports" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Reports</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {recentReports.map((report) => (
                  <div key={report.id} className="flex items-center justify-between p-3 rounded-lg border border-surface-border hover:bg-surface-light-blue transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center ${
                        report.status === "pending" ? "bg-yellow-100" :
                        report.status === "reviewed" ? "bg-blue-100" : "bg-green-100"
                      }`}>
                        {report.status === "pending" ? (
                          <Clock className="h-4 w-4 text-yellow-600" />
                        ) : report.status === "reviewed" ? (
                          <AlertTriangle className="h-4 w-4 text-blue-600" />
                        ) : (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        )}
                        {/* The status was a colour and a glyph, both invisible
                            to a screen reader: three reports read out
                            identically. */}
                        <span className="sr-only">Status: {report.status}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium">{report.type}</p>
                        <p className="text-xs text-muted-foreground">{report.content}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">{report.reportedAt}</span>
                      {report.status === "pending" && (
                        <Button size="sm" variant="outline">Review</Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pending User Approvals</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {pendingUsers.map((user) => (
                  <div key={user.id} className="flex items-center justify-between p-3 rounded-lg border border-surface-border">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-surface-light-blue flex items-center justify-center text-sm font-medium">
                        {user.name[0]}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{user.name}</p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{user.signedUp}</span>
                      <Button size="sm" variant="outline">Approve</Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="content" className="mt-4">
          <Card>
            <CardContent className="p-8 text-center">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">Content moderation tools coming soon</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <Card>
            <CardContent className="p-8 text-center">
              <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">Analytics dashboard coming soon</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
