import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AboutPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 py-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-navy-800">About LinkMe+</h1>
        <p className="text-muted-foreground mt-2">Building the future of community and commerce</p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4 text-sm text-muted-foreground">
          <p>
            LinkMe+ is a community and professional social platform where people, creators, businesses,
            and organizations publish content, build audiences, sell products, create communities, and discover work.
          </p>
          <p>
            Our mission is to create a trusted, inclusive space where meaningful connections drive
            opportunity — whether that means finding a job, launching a business, learning a skill,
            or simply sharing what matters to you.
          </p>
          <p>
            Built with modern technology and a commitment to user safety, LinkMe+ combines the best
            of social networking, marketplace commerce, professional networking, and community building
            into one seamless platform.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle level={2} className="text-base">
            Our Values
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div>
            <p className="font-medium text-foreground">Trust First</p>
            <p>Every feature is designed with safety and transparency in mind.</p>
          </div>
          <div>
            <p className="font-medium text-foreground">Community Driven</p>
            <p>We build what our users need, not what we think they should want.</p>
          </div>
          <div>
            <p className="font-medium text-foreground">Open & Fair</p>
            <p>Everyone deserves equal access to opportunity and connection.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
