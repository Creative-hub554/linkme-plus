# LinkMe+ Product Requirements

## 1. Product Vision

**LinkMe+** is a community and professional social platform where people, creators, businesses, and organizations publish content, build audiences, sell products or services, create communities, discover work, and promote offerings through paid banner placements.

The first release is a responsive web application. It supports public discovery while protecting users with account controls, content moderation, reporting, and privacy settings.

## 2. User Types

| User type | Primary capabilities |
| --- | --- |
| Visitor | Browse public content, listings, pages, groups, and jobs; create an account. |
| Member | Create a profile, publish content, follow, comment, buy/sell, apply for jobs, and report content. |
| Seller | Create marketplace listings and manage a storefront. |
| Employer | Create a company page, post jobs, and review applications. |
| Page or group administrator | Manage their page/group, posts, members, rules, and moderators. |
| Advertiser | Create, pay for, and monitor banner-rental campaigns. |
| Platform administrator | Moderate content, manage users and categories, review reports, and approve advertising. |

## 3. Core Modules

### 3.1 Accounts, Profiles, and Privacy

- Email/password sign-up, login, password reset, logout, and account deletion.
- A profile includes display name, username, photo, cover image, bio, location, skills, contact preferences, and optional portfolio/CV.
- Profiles may be public, followers-only, or private where applicable.
- Users can block accounts and control who can follow, message, tag, or view contact details.

### 3.2 Social Feed and Short Video

- Members create text, image, video, and short-video posts.
- Posts support visibility settings, hashtags, mentions, comments, reactions, shares, saves, edit/delete, and reporting.
- The home feed combines followed people, followed pages, joined groups, and approved sponsored placements.
- Video uploads need size/duration limits, thumbnails, processing status, and moderation before distribution where required.
- Notifications cover follows, reactions, comments, mentions, group/page activity, marketplace messages, applications, and advertising status.

### 3.3 Public Pages and Groups

- Public pages represent a business, creator, organization, community, or cause.
- A public page has name, username, category, description, profile image, cover image, contact details, followers, and posts.
- Groups have name, description, category, rules, cover image, members, posts, and administrator/moderator roles.
- Members may join public groups directly. Administrators can remove content or members and assign moderators.
- Page administrators may select an eligible published page post and submit it as a **Boosted Post** campaign to reach people beyond existing followers.

### 3.4 Marketplace

- Sellers create listings for products, services, or rental offers.
- A listing includes title, description, category, price or price range, media, condition, location, availability, seller contact method, and status (draft, active, reserved, sold, expired, removed).
- Sellers have an **Inventory Manager** for physical products. It supports stock quantity, SKU, unit cost (private), selling price, low-stock threshold, stock adjustment reason, and availability status.
- A product may have variants such as size, colour, material, or package; each variant can have its own SKU, price, image, and stock quantity.
- Inventory activity records stock added, manually adjusted, reserved, sold, returned, damaged, or expired, including timestamp and responsible seller/admin where relevant.
- Listings automatically show **In stock**, **Low stock**, **Out of stock**, or **Pre-order** based on the seller's inventory rules. Out-of-stock products cannot be purchased/reserved and can be hidden automatically if the seller chooses.
- Services, made-to-order products, and rental offers do not require quantity tracking; they instead use availability, appointment/date capacity, or booking status.
- The Inventory Manager provides a searchable product/variant list, filters by stock state, bulk stock adjustment/import/export in a later release, and low-stock notifications.
- Sellers may create a **Promoted Listing** campaign for an active, in-stock marketplace item. A promoted listing is clearly labelled **Sponsored** or **Promoted** and receives premium placement in relevant marketplace discovery surfaces.
- A seller chooses the listing, promotion duration, budget, target location, and relevant category. The platform can offer a simple goal of more views, messages, or store visits.
- Promoted listings can appear in the marketplace home page, category pages, search results, and recommendation modules; they must not appear in irrelevant categories or bypass a buyer's active filters.
- Before a campaign is active, the system confirms item stock/availability, validates creative and destination details, collects payment, and applies advertising-policy review. A listing that is sold, out of stock, expired, removed, or reported for a serious policy violation immediately pauses its promotion.
- Sellers see promotion results: impressions, listing views, clicks, messages started, saves, store visits, spend, campaign dates, and remaining budget. The platform must not disclose identifiable buyer information in campaign reports.
- A promoted listing respects frequency caps, user hide/report controls, and fair rotation. Promotion can improve discovery but must not guarantee a sale or permanently displace organic listings.
- Buyers can search, filter, save listings, contact the seller, and report fraudulent or prohibited listings.
- A seller storefront shows the seller profile, active listings, rating/review capability in a later release, and contact options.
- Payment and delivery can begin as buyer/seller agreement outside the platform; introduce integrated payments only after fraud, refund, and compliance rules are designed.

### 3.5 Jobs

- Employers create company pages and job listings.
- A job includes title, company, location/remote status, job type, salary range (optional), description, requirements, skills, application deadline, contact/application method, and status.
- Job seekers create an optional professional profile/CV, save jobs, apply, and track application status.
- Employers review applicants and move them through received, reviewing, shortlisted, rejected, and hired states.

### 3.6 Banner Rental Marketplace (Advertising)

LinkMe+ provides paid, time-limited promotional placements. These are advertisements, not ordinary marketplace product listings.

**Advertiser workflow**

1. Select an available banner placement and duration.
2. Upload desktop/mobile banner artwork or use a simple banner builder.
3. Supply headline, optional call-to-action, target destination URL or internal LinkMe+ destination, target audience/location, and payment details.
4. Submit the campaign for review.
5. After approval and successful payment, LinkMe+ schedules and displays the banner.
6. The advertiser sees campaign status, dates, impressions, clicks, and remaining time.

**Banner inventory**

| Placement | Example location | Booking rule |
| --- | --- | --- |
| Home feed sponsored card | Between feed posts | Sold by dates, audience, and impression allocation. |
| Marketplace banner | Marketplace search/listing pages | Sold by category, location, and dates. |
| Job banner | Job search/listing pages | Sold by job category, location, and dates. |
| Group/Page banner | Inside selected public groups or pages | Requires administrator and platform approval. |
| Site-wide hero banner | Homepage/discovery page | Limited premium inventory, one advertiser per time slot. |
| Promoted marketplace listing | Marketplace home, category, search, and recommendation modules | Seller promotes an active listing by duration/budget, category, and location. |

**Boosted Posts**

- A boosted post uses an existing public-page post as the creative and appears as a **Sponsored** post in the home/discovery feed.
- Only page administrators can request a boost; the post must be public, published, owned by the page, and comply with the advertising policy.
- The administrator selects campaign duration, budget, target location, optional interests/categories, and a goal such as reach, engagement, website visits, marketplace visits, or job applications.
- A boosted post has the same campaign statuses, payment requirement, creative review, frequency caps, reporting, hide/report controls, and audit trail as banner campaigns.
- Metrics include reach, impressions, clicks, reactions, comments, shares, follows, conversion events where available, spend, and campaign dates. Advertisers cannot see personally identifiable viewer data.
- Material edits to a boosted post pause the campaign and require review before it resumes. Deleted, reported, or policy-violating posts immediately stop delivery.

**Banner requirements and rules**

- Every paid placement is visibly labelled **Sponsored** or **Advertisement**.
- Banner creative includes image/video asset, alt text, destination, campaign dates, target placement, budget/price, and advertiser identity.
- The system validates asset size, format, dimensions, destination URL safety, and availability before submission.
- Campaigns use statuses: draft, pending payment, pending review, approved, scheduled, active, paused, rejected, completed, cancelled, refunded.
- Advertisements must comply with the platform content policy; scams, misleading offers, prohibited products, discriminatory hiring, adult content, malware, and deceptive links are rejected.
- Admin approval is required before a first campaign and for edited creative. Group/page administrators cannot approve their own advertising campaign.
- Campaign reporting includes impressions, clicks, click-through rate, spend, dates, and placement. Do not report identifiable viewer data to advertisers.
- Prevent a banner from being shown excessively to one person; configure frequency caps and an easy way to hide/report an advertisement.
- Reserve a placement only after payment authorization; release it if payment fails or the booking expires.

### 3.7 Messaging and Search

- Direct messages support buyer/seller communication, job application follow-up, and permitted social conversations.
- Search works without AI and supports people, posts, pages, groups, listings, companies, and jobs.
- Filters include category, location, price, job type, experience level, date, and relevance as appropriate.

### 3.8 AI Assistant

AI operates only in the **Social/Feed**, **Marketplace**, and **Jobs** modules. It is an optional helper, not a replacement for normal search, filters, or user control.

- **Social/Feed:** Suggest relevant public posts, people, pages, and groups; help draft post text, captions, hashtags, and accessible image alt text; recommend public feed content using consented activity and non-sensitive profile data.
- **Marketplace:** Help buyers find and compare listings; help sellers draft listing titles/descriptions; suggest category, price range, tags, and inventory text from seller-provided information.
- **Jobs:** Help job seekers find and compare relevant jobs; help employers draft a job description and requirements; summarize a candidate's submitted profile/CV only for the employer receiving the application.
- Every AI-generated draft requires user review and explicit publish/save confirmation.
- AI does not operate in account settings, authentication, payments, direct/private messages, advertising approval, moderation decisions, platform administration, or private group/page management.
- AI does not make final employment, payment, moderation, account-enforcement, or eligibility decisions.
- The assistant must disclose that it is AI, offer normal search/filter results when uncertain, avoid exposing private data, and allow the user to disable personalized recommendations.

## 4. Platform Safety and Administration

- A report flow exists for posts, comments, profiles, messages, listings, jobs, groups, pages, and advertisements.
- Administrators have moderation queues, reason codes, content removal, warning, suspension, ban, and appeal capabilities.
- Use rate limits and abuse controls for signup, login, posting, messages, job creation, listing creation, and advertising submissions.
- Maintain audit logs for administrator actions, campaign approval/rejection, payment/refund actions, and material moderation events.
- Publish community standards, marketplace policy, advertising policy, privacy policy, and terms of service before launch.

## 5. Essential Data Entities

`User`, `Profile`, `Follow`, `Post`, `PostMedia`, `Comment`, `Reaction`, `SavedItem`, `Notification`, `Conversation`, `Message`, `Page`, `PageRole`, `Group`, `GroupMember`, `MarketplaceListing`, `ProductVariant`, `InventoryItem`, `InventoryMovement`, `Storefront`, `Job`, `Company`, `JobApplication`, `AdvertisementCampaign`, `AdvertisementCreative`, `AdvertisementPlacement`, `AdvertisementBooking`, `AdvertisementMetric`, `PromotedListingCampaign`, `BoostedPostCampaign`, `Report`, `ModerationAction`, `Payment`, and `AuditLog`.

## 6. Non-Functional Requirements

- Responsive on mobile, tablet, and desktop; accessibility baseline follows WCAG 2.2 AA.
- Secure authentication, server-side authorization, encrypted secrets, and validation of every file upload and URL.
- Paginated or infinite-scroll feeds/search results; no unbounded queries.
- Media is stored separately from application data and delivered through a CDN.
- Backups, monitoring, error logging, and a restore plan are required before public launch.
- Record user consent for personalized recommendations and advertising personalization.

## 7. MVP Scope

1. Accounts, profiles, privacy basics, and follow/unfollow.
2. Text/image posts, a chronological feed, reactions, comments, and notifications.
3. Public pages and public groups with posts and administrator roles.
4. Marketplace product/service listings, save, filter, report, and buyer/seller messaging.
5. Seller Inventory Manager for products: quantity, SKU, variants, stock adjustments, low-stock status, and out-of-stock listing behaviour.
6. Promoted Listing campaigns: sellers promote an active item with budget/duration/basic category and location targeting, approval, Sponsored label, and performance metrics.
7. Jobs with employer pages, job listing, applications, and applicant status.
8. Banner rental with a small fixed inventory: homepage banner, marketplace banner, job banner; upload, checkout, admin approval, scheduling, Sponsored label, and impressions/clicks.
9. Page Post Boost: page administrators can choose an existing post, set a budget/duration/basic location targeting, pay, receive approval, and view reach/engagement metrics.
10. Basic platform search, reporting, moderation queue, and admin tools.

## 8. Later Releases

- Integrated marketplace payments, escrow, delivery, refunds, and reviews.
- Advanced recommendation ranking, video creator monetization, and live streaming.
- Private groups, paid communities, membership approval workflows, and events.
- Advanced audience targeting, auction bidding, programmatic advertising, and self-serve campaign optimization.
- Mobile applications, multilingual UI, voice/multimodal AI, and cross-platform social publishing.

## 9. MVP Acceptance Criteria

- A member can register, complete a profile, follow another profile/page, publish an image post, and receive an interaction notification.
- A visitor can browse publicly available pages, groups, listings, jobs, and clearly labelled sponsored placements.
- A seller can create, edit, pause, and remove a marketplace listing; a buyer can filter, save, and message the seller.
- A seller can create a product variant, adjust stock with a reason, configure a low-stock threshold, and see accurate in-stock/out-of-stock availability on the public listing.
- A seller can promote an active in-stock listing, choose duration/budget/basic targeting, complete payment, receive approval, and see clearly defined promotion metrics; a buyer sees the placement labelled Sponsored/Promoted and may hide or report it.
- An employer can create a company page, publish a job, and review an applicant's submitted profile/CV.
- A page/group administrator can create content and moderate their page/group within their authority.
- An advertiser can select an available banner slot, upload compliant creative, submit payment, receive approval/rejection, and see booked campaign dates.
- An approved active banner appears only in its booked placement, has a Sponsored label, links safely to its destination, honours frequency limits, and records impressions/clicks.
- A page administrator can boost an eligible page post; after payment and approval, it is served as a clearly labelled Sponsored post to the selected audience and reports reach, engagement, spend, and campaign dates.
- An administrator can review a reported item or banner, take action, and create an auditable record.
