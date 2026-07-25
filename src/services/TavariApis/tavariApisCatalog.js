/** Canonical Tavari public API endpoint definitions for the dashboard module UI. */

export const TAVARI_API_BUSINESS_NAME = 'tavari-api-business-name';
export const TAVARI_API_BUSINESS_EMAIL = 'tavari-api-business-email';
export const TAVARI_API_BUSINESS_PHONE = 'tavari-api-business-phone';
export const TAVARI_API_BUSINESS_ADDRESS = 'tavari-api-business-address';
export const TAVARI_API_BUSINESS_LOGO = 'tavari-api-business-logo';
export const TAVARI_API_BUSINESS_FAVICON = 'tavari-api-business-favicon';
export const TAVARI_API_BUSINESS_HOURS = 'tavari-api-business-hours';
export const TAVARI_API_BUSINESS_PRODUCTS = 'tavari-api-business-products';
export const TAVARI_API_PARTY_GUEST_LIST = 'tavari-api-party-guest-list';
export const TAVARI_API_CAMP_REGISTRATION = 'tavari-api-camp-registration';
export const TAVARI_API_PARTY_PACKAGES = 'tavari-api-party-packages';
export const TAVARI_API_BOOKING_CATALOG = 'tavari-api-booking-catalog';
export const TAVARI_API_BOOKING_AVAILABILITY = 'tavari-api-booking-availability';
export const TAVARI_API_CAMP_SESSIONS = 'tavari-api-camp-sessions';
export const TAVARI_API_WAIVER_STATUS = 'tavari-api-waiver-status';
export const TAVARI_API_WAIVER_EMBED = 'tavari-api-waiver-embed';
export const TAVARI_API_REPUTATION_FEED = 'tavari-api-reputation-feed';
export const TAVARI_API_BUSINESS_LINKS = 'tavari-api-business-links';
export const TAVARI_API_WEBSITE_PROMOTIONS = 'tavari-api-website-promotions';
export const TAVARI_API_MANAGE_BOOKING = 'tavari-api-manage-booking';
export const TAVARI_API_STORYBOOK_ADVENTURE = 'tavari-api-storybook-adventure';
export const TAVARI_API_LIVE_CAPACITY = 'tavari-api-live-capacity';
export const TAVARI_API_WEBSITE_HERO_SLIDES = 'tavari-api-website-hero-slides';
export const TAVARI_API_WEBSITE_FAQS = 'tavari-api-website-faqs';
export const TAVARI_API_WEBSITE_COPY_TOKENS = 'tavari-api-website-copy-tokens';
export const TAVARI_API_WEBSITE_MENU = 'tavari-api-website-menu';
export const TAVARI_API_HOLIDAY_PAGES = 'tavari-api-holiday-pages';
export const TAVARI_API_WEBSITE_GALLERY = 'tavari-api-website-gallery';
export const TAVARI_API_WEBSITE_BUILDER_PAGES = 'tavari-api-website-builder-pages';
export const TAVARI_API_DIGITAL_SIGNAGE = 'tavari-api-digital-signage';
export const TAVARI_API_WEBSITE_PUBLIC_PROFILE = 'website-public-profile';

export const TAVARI_API_ENDPOINTS = [
  {
    id: TAVARI_API_WEBSITE_PUBLIC_PROFILE,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_WEBSITE_PUBLIC_PROFILE}`,
    summary: 'Public business profile',
    description:
      'Returns a website-ready profile in one call: business name, email, phone, address, branding, hours summary, weekly hours, and special hours.',
    fields: [
      'businessId',
      'name',
      'email',
      'phone',
      'address',
      'logoUrl',
      'faviconUrl',
      'timezone',
      'hoursSummary',
      'weeklyHours',
      'specialHours',
      'links',
    ],
    status: 'live',
    queryExample: '?businessId={businessId}',
  },
  {
    id: TAVARI_API_BUSINESS_NAME,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_BUSINESS_NAME}`,
    summary: 'Business name',
    description:
      'Returns the Business Name from Dashboard → Settings → Basic Information (businesses.name).',
    fields: ['businessId', 'name'],
    status: 'live',
    queryExample: '?businessId={businessId}',
  },
  {
    id: TAVARI_API_BUSINESS_EMAIL,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_BUSINESS_EMAIL}`,
    summary: 'Business email',
    description:
      'Returns the Business Email from Dashboard → Settings → Basic Information (businesses.business_email).',
    fields: ['businessId', 'email'],
    status: 'live',
    queryExample: '?businessId={businessId}',
  },
  {
    id: TAVARI_API_BUSINESS_PHONE,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_BUSINESS_PHONE}`,
    summary: 'Business phone',
    description:
      'Returns the Business Phone from Dashboard → Settings → Basic Information (businesses.business_phone).',
    fields: ['businessId', 'phone'],
    status: 'live',
    queryExample: '?businessId={businessId}',
  },
  {
    id: TAVARI_API_BUSINESS_ADDRESS,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_BUSINESS_ADDRESS}`,
    summary: 'Business address',
    description:
      'Returns the full formatted address from Dashboard → Settings → Basic Information (street, city, province/state, postal code combined as one line).',
    fields: ['businessId', 'address', 'street', 'city', 'state', 'postalCode'],
    status: 'live',
    queryExample: '?businessId={businessId}',
  },
  {
    id: TAVARI_API_BUSINESS_LOGO,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_BUSINESS_LOGO}`,
    summary: 'Business logo',
    description:
      'Returns the Logo URL from Dashboard → Settings → Basic Information (app_branding.logo_url).',
    fields: ['businessId', 'logoUrl'],
    status: 'live',
    queryExample: '?businessId={businessId}',
  },
  {
    id: TAVARI_API_BUSINESS_FAVICON,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_BUSINESS_FAVICON}`,
    summary: 'Business favicon',
    description:
      'Returns the Favicon URL from Dashboard → Settings → Basic Information (app_branding.favicon_url).',
    fields: ['businessId', 'faviconUrl'],
    status: 'live',
    queryExample: '?businessId={businessId}',
  },
  {
    id: TAVARI_API_BUSINESS_HOURS,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_BUSINESS_HOURS}`,
    summary: 'Operating & holiday hours',
    description:
      'Returns timezone, weekly hours, and holiday/special hours from Dashboard → Settings → Operating Hours and Holiday Hours (businesses.timezone, operating_hours, holiday_hours).',
    fields: ['businessId', 'timezone', 'weeklyHours', 'specialHours', 'hoursSummary'],
    status: 'live',
    queryExample: '?businessId={businessId}',
  },
  {
    id: TAVARI_API_BUSINESS_PRODUCTS,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_BUSINESS_PRODUCTS}`,
    summary: 'Website products (inventory)',
    description:
      'Single public inventory API for external websites. Returns POS items with Expose to website API enabled: name, description, gate/online prices, image. Optional context filter: admission (Show on admission pricing page). Fetch all exposed items, by ids, or by context. Used for concession menu links, birthday packages, admission rates, socks, and builder cards. Stock quantity is never returned; tracked items at zero stock are omitted.',
    fields: ['businessId', 'context', 'products'],
    status: 'live',
    queryExample:
      '?businessId={businessId} | ?businessId={businessId}&ids={uuid},{uuid} | ?businessId={businessId}&context=admission',
  },
  {
    id: TAVARI_API_PARTY_GUEST_LIST,
    method: 'POST',
    path: `/functions/v1/${TAVARI_API_PARTY_GUEST_LIST}`,
    summary: 'Party guest list (OTWK host portal)',
    description:
      'Phone OTP auth, guest list CRUD, waiver matching. Actions: getPortalInfo (GET), sendOtp, verifyOtp, selectBooking, getList, saveList, submitList. Host portal: /customer-portal/{businessId}/party-guest-list',
    fields: ['businessId', 'action', 'sessionToken', 'entries', 'hostPortalUrl', 'websitePortalUrl'],
    status: 'live',
    queryExample:
      'GET ?businessId={uuid}&action=getPortalInfo | POST { "businessId": "{uuid}", "action": "sendOtp", "phoneNumber": "5195551234" }',
  },
  {
    id: TAVARI_API_CAMP_REGISTRATION,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_CAMP_REGISTRATION}`,
    summary: 'Camp registration portal (OTWK)',
    description:
      'Public portal info for annual camp registration and medical forms. Returns hostPortalUrl (Tavari customer portal), optional websitePortalUrl, form title, and intro. Parents sign in with phone OTP on the portal to complete forms per camper.',
    fields: ['businessId', 'formTitle', 'formIntro', 'hostPortalUrl', 'websitePortalUrl'],
    status: 'live',
    queryExample: 'GET ?businessId={uuid}&action=getPortalInfo',
  },
  {
    id: TAVARI_API_WAIVER_STATUS,
    method: 'POST',
    path: `/functions/v1/${TAVARI_API_WAIVER_STATUS}`,
    summary: 'Waiver validity check (OTWK)',
    description:
      'Lightweight public waiver status for website first-visit and admission flows. Returns valid, expiresAt, and lastSignedAt only — no full waiver payload. Verify with phone/email OTP (sendOtp → verifyOtp) or reuse statusToken / customer session token.',
    fields: [
      'businessId',
      'action',
      'valid',
      'expiresAt',
      'lastSignedAt',
      'found',
      'needsResign',
      'expiringSoon',
      'message',
      'statusToken',
      'maskedEmail',
    ],
    status: 'live',
    queryExample: 'POST { businessId, action: "sendOtp", phoneNumber } | GET ?businessId={businessId}&statusToken=...',
  },
  {
    id: TAVARI_API_WAIVER_EMBED,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_WAIVER_EMBED}`,
    summary: 'Waiver embed config + signing (OTWK)',
    description:
      'Public waiver template metadata, branding, field schema, consent text, and submit endpoint config for on-brand website signing — no customer app session. GET action=config returns render payload; POST sendOtp → verifyOtp → submit completes signing via phone OTP.',
    fields: [
      'businessId',
      'action',
      'templateKey',
      'branding',
      'template',
      'fields',
      'consents',
      'submit',
      'embed',
      'submitToken',
      'pendingToken',
      'maskedEmail',
    ],
    status: 'live',
    queryExample:
      'GET ?businessId={businessId}&action=config | POST { businessId, action: "sendOtp", phoneNumber, email }',
  },
  {
    id: TAVARI_API_REPUTATION_FEED,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_REPUTATION_FEED}`,
    summary: 'Reputation feed (OTWK reviews)',
    description:
      'Public aggregate reputation feed for marketing websites. Returns average rating, review count, recent review snippets (reviewer first name + text + date), Google review URL, leave-a-review URL, and optional widget layout config.',
    fields: [
      'businessId',
      'averageRating',
      'averageRatingFormatted',
      'reviewCount',
      'snippetCount',
      'googleReviewUrl',
      'leaveReviewUrl',
      'reviews',
      'reviewerName',
      'text',
      'date',
      'dateFormatted',
      'rating',
      'widget',
    ],
    status: 'live',
    queryExample: '?businessId={businessId} | ?businessId={businessId}&limit=9&minRating=4',
  },
  {
    id: TAVARI_API_BUSINESS_LINKS,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_BUSINESS_LINKS}`,
    summary: 'Canonical website links (OTWK)',
    description:
      'Single source of truth for booking, waiver, review, customer portal, party guest list, and camp registration URLs. Resolves Tavari module defaults with per-business overrides from business_website_links.',
    fields: [
      'businessId',
      'websiteBaseUrl',
      'hostPortalUrl',
      'links',
      'bookingUrl',
      'openPlayBookingUrl',
      'partyBookingUrl',
      'campBookingUrl',
      'groupBookingUrl',
      'waiverUrl',
      'reviewUrl',
      'googleReviewUrl',
      'customerPortalUrl',
      'partyGuestListUrl',
      'campRegistrationUrl',
      'partyManageUrl',
      'manageBookingUrl',
      'labels',
    ],
    status: 'live',
    queryExample: '?businessId={businessId}',
  },
  {
    id: TAVARI_API_WEBSITE_PROMOTIONS,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_WEBSITE_PROMOTIONS}`,
    summary: 'Website promotions (OTWK)',
    description:
      'Active website-facing campaigns: hero slides, popups, floating CTAs, landing pages, and POS free-with-purchase offers. Filter by audience (web/app/both), slug, and date window.',
    fields: [
      'businessId',
      'businessName',
      'timezone',
      'asOf',
      'promotions',
      'id',
      'slug',
      'title',
      'label',
      'kind',
      'audience',
      'priority',
      'startsAt',
      'endsAt',
      'imageUrl',
      'ctaUrl',
      'ctaLabel',
      'heroEnabled',
      'popupEnabled',
      'floatingEnabled',
      'homeButtonEnabled',
      'posOffer',
    ],
    status: 'live',
    queryExample: '?businessId={businessId}&audience=web&activeOnly=true',
  },
  {
    id: TAVARI_API_WEBSITE_HERO_SLIDES,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_WEBSITE_HERO_SLIDES}`,
    summary: 'Homepage hero carousel (OTWK)',
    description:
      'Always-on homepage hero rotator with sort order, image/alt, optional CTA, and calendar/day scheduling (validFrom, validUntil, showOnDays). Separate from campaign promotions hero images.',
    fields: [
      'businessId',
      'businessName',
      'timezone',
      'asOf',
      'calendarDate',
      'slides',
      'id',
      'slug',
      'imageUrl',
      'alt',
      'title',
      'caption',
      'ctaText',
      'ctaHref',
      'sortOrder',
      'showTextOverlay',
      'imageFocusX',
      'imageFocusY',
      'validFrom',
      'validUntil',
      'showOnDays',
    ],
    status: 'live',
    queryExample: '?businessId={businessId}&activeOnly=true',
  },
  {
    id: TAVARI_API_WEBSITE_FAQS,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_WEBSITE_FAQS}`,
    summary: 'Website FAQs (OTWK)',
    description:
      'Public FAQ feed by pageKey (faq, first-visit, home-teaser, admission) with sort order, optional category, and {{token}} resolution for pricing and walk-in messaging.',
    fields: [
      'businessId',
      'businessName',
      'timezone',
      'asOf',
      'resolveTokens',
      'faqs',
      'id',
      'slug',
      'pageKey',
      'category',
      'question',
      'answer',
      'answerTemplate',
      'sortOrder',
    ],
    status: 'live',
    queryExample: '?businessId={businessId}&pageKey=faq&resolveTokens=true',
  },
  {
    id: TAVARI_API_WEBSITE_COPY_TOKENS,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_WEBSITE_COPY_TOKENS}`,
    summary: 'Website copy tokens (OTWK)',
    description:
      'Single {{token}} map for builder text, FAQs, and SEO snippets — grip socks pricing, party package prices/summaries, live walk-in message, party weekend urgency, and camp spots messaging from Tavari inventory, party packages, live capacity, and booking availability.',
    fields: [
      'businessId',
      'businessName',
      'timezone',
      'asOf',
      'tokens',
      'grip_socks_price',
      'party_12_price',
      'party_24_price',
      'party_36_price',
      'party_private_price',
      'party_entry_capacity',
      'party_entry_adults',
      'party_entry_food_credit',
      'party_capacity_summary',
      'party_packages_summary',
      'party_starting_price',
      'walk_in_message',
      'party_weekend_urgency',
      'camp_spots_message',
    ],
    status: 'live',
    queryExample: '?businessId={businessId}',
  },
  {
    id: TAVARI_API_WEBSITE_MENU,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_WEBSITE_MENU}`,
    summary: 'Concession menu (OTWK)',
    description:
      'Website menu sections with manual rows or Tavari-linked inventory SKUs. Resolves live names, gate prices, and images from POS inventory when menuSource is api. Includes optional menu PDF URL.',
    fields: [
      'businessId',
      'businessName',
      'timezone',
      'asOf',
      'menuSource',
      'menuPdfUrl',
      'sections',
      'id',
      'title',
      'subtitle',
      'sortOrder',
      'items',
      'kind',
      'name',
      'note',
      'imageUrl',
      'price',
      'tavariProductId',
      'priceLayout',
      'variants',
      'product',
    ],
    status: 'live',
    queryExample: '?businessId={businessId}',
  },
  {
    id: TAVARI_API_HOLIDAY_PAGES,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_HOLIDAY_PAGES}`,
    summary: 'Holiday landing pages (OTWK)',
    description:
      'Holiday guide landing page config keyed to special-hour event keys: slug, route, SEO, intro, CTA, related links, and linked special-hour dates from businesses.holiday_hours.',
    fields: [
      'businessId',
      'businessName',
      'timezone',
      'asOf',
      'calendarDate',
      'eventOptions',
      'pages',
      'slug',
      'routePath',
      'name',
      'eventKeys',
      'eventKeywords',
      'seoTitle',
      'seoDescription',
      'h1',
      'intro',
      'searchQuestion',
      'whenText',
      'planningTip',
      'primaryCtaLabel',
      'relatedLinks',
      'linkedSpecialHours',
      'date',
      'hoursText',
      'label',
      'eventKey',
    ],
    status: 'live',
    queryExample: '?businessId={businessId}&slug=family-day-activities-london-ontario',
  },
  {
    id: TAVARI_API_WEBSITE_GALLERY,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_WEBSITE_GALLERY}`,
    summary: 'Facility gallery (OTWK)',
    description:
      'Public facility gallery images with alt text, sort order, optional caption, and tags. Reusable on marketing sites and in-venue displays.',
    fields: [
      'businessId',
      'businessName',
      'timezone',
      'asOf',
      'images',
      'id',
      'slug',
      'imageUrl',
      'alt',
      'caption',
      'tags',
      'sortOrder',
    ],
    status: 'live',
    queryExample: '?businessId={businessId}&tag=playground',
  },
  {
    id: TAVARI_API_WEBSITE_BUILDER_PAGES,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_WEBSITE_BUILDER_PAGES}`,
    summary: 'CMS builder pages (OTWK)',
    description:
      'Read-only builder JSON by slug: sections, metaTitle, metaDescription. OTWK remains the renderer; Tavari is the layout source of truth for phased rollout pages.',
    fields: [
      'businessId',
      'businessName',
      'timezone',
      'asOf',
      'page',
      'pages',
      'slug',
      'label',
      'metaTitle',
      'metaDescription',
      'sections',
      'updatedAt',
    ],
    status: 'live',
    queryExample: '?businessId={businessId}&slug=home',
  },
  {
    id: TAVARI_API_DIGITAL_SIGNAGE,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_DIGITAL_SIGNAGE}`,
    summary: 'Digital signage creatives (venue + web)',
    description:
      'Active ad creatives from digital_signage_ads with image, click URL, and schedule. Filter by audience (venue/web/both). Returns creatives plus legacy promos alias for OTWK App.',
    fields: [
      'businessId',
      'businessName',
      'timezone',
      'asOf',
      'calendarDate',
      'localDate',
      'audience',
      'creatives',
      'promos',
      'id',
      'title',
      'imageUrl',
      'clickUrl',
      'contentType',
      'schedule',
      'startDate',
      'endDate',
      'startTime',
      'endTime',
      'daysOfWeek',
      'contentPlayStartDate',
      'contentPlayEndDate',
    ],
    status: 'live',
    queryExample: '?businessId={businessId}&audience=web&activeOnly=true&limit=8',
  },
  {
    id: TAVARI_API_STORYBOOK_ADVENTURE,
    method: 'POST',
    path: `/functions/v1/${TAVARI_API_STORYBOOK_ADVENTURE}`,
    summary: 'Storybook Explorer Adventure fulfillment (OTWK)',
    description:
      'After a Storybook Explorer Adventure submission on the OTWK website, sends the promo code by email through Tavari Mail and syncs the parent email into mail_contacts. Use consentEmailMarketing for express marketing list opt-in (separate from photo-use consent). Idempotent per entryId.',
    fields: [
      'businessId',
      'action',
      'entryId',
      'email',
      'parentFirstName',
      'childFirstName',
      'promoCode',
      'promoOffer',
      'promoExpiry',
      'consentContact',
      'consentEmailMarketing',
      'emailSent',
      'contactId',
      'marketingSubscribed',
    ],
    status: 'live',
    queryExample:
      'GET ?businessId={uuid}&action=getPortalInfo | POST { businessId, action: "fulfillSubmission", entryId, email, parentFirstName, promoCode, promoOffer, consentContact: true, consentEmailMarketing: true }',
  },
  {
    id: TAVARI_API_MANAGE_BOOKING,
    method: 'POST',
    path: `/functions/v1/${TAVARI_API_MANAGE_BOOKING}`,
    summary: 'Manage booking self-service (OTWK)',
    description:
      'Public OTP flow to find and manage existing bookings: sendOtp → verifyOtp → selectBooking returns manageBookingUrl, booking summary, allowed actions, and payment/reschedule links. Token actions proxy to manage-booking-self-service (getBooking, availability, cancel, reschedule).',
    fields: [
      'businessId',
      'action',
      'manageBookingUrl',
      'hostManageBookingUrl',
      'websiteManageUrl',
      'sessionToken',
      'bookings',
      'bookingId',
      'bookingNumber',
      'links',
      'actions',
      'selfService',
      'token',
    ],
    status: 'live',
    queryExample:
      'GET ?businessId={businessId}&action=getPortalInfo | POST { businessId, action: "sendOtp", phoneNumber } | POST { businessId, action: "getBooking", token }',
  },
  {
    id: TAVARI_API_LIVE_CAPACITY,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_LIVE_CAPACITY}`,
    summary: 'Live walk-in capacity (OTWK)',
    description:
      'Real-time drop-in occupancy for website messaging: current band (quiet/moderate/busy/full), on-site units, estimated counter wait, today peak booking windows, and recommended book-online CTA. Uses checked-in attendance + category capacity pool + slot occupancy.',
    fields: [
      'businessId',
      'timezone',
      'asOf',
      'isOpenNow',
      'occupancyBand',
      'occupancyPercent',
      'onSiteUnits',
      'scheduledUnitsToday',
      'maxCapacity',
      'remainingCapacity',
      'currentSlot',
      'estimatedWait',
      'walkInMessage',
      'peakWindowsToday',
      'bookingCta',
    ],
    status: 'live',
    queryExample: '?businessId={businessId} | ?businessId={businessId}&typeKey=drop_in_play',
  },
  {
    id: TAVARI_API_CAMP_SESSIONS,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_CAMP_SESSIONS}`,
    summary: 'Camp sessions calendar (OTWK)',
    description:
      'Public camp session calendar from Tavari booking schedules. Returns dated sessions with age range, daily schedule summary, price, spots remaining, and registration activityId/portalUrl. Filter by campKey (pa_day, summer, march_break, winter_break) or activityId.',
    fields: [
      'businessId',
      'campKey',
      'timezone',
      'fromDate',
      'toDate',
      'hostPortalUrl',
      'sessions',
      'activityId',
      'date',
      'endDate',
      'ageRange',
      'scheduleSummary',
      'price',
      'priceFormatted',
      'spotsRemaining',
      'totalSpots',
      'portalUrl',
      'registrationOpen',
    ],
    status: 'live',
    queryExample: '?businessId={businessId}&campKey=pa_day',
  },
  {
    id: TAVARI_API_BOOKING_AVAILABILITY,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_BOOKING_AVAILABILITY}`,
    summary: 'Booking availability (OTWK)',
    description:
      'Public schedule occupancy for portal-visible activities. Returns per-activity date ranges with remaining capacity, closed/blocked dates, next open slot, and website summaries for walk-in capacity, weekend party urgency, and camp spots left.',
    fields: [
      'businessId',
      'timezone',
      'fromDate',
      'toDate',
      'summaries',
      'activities',
      'nextOpenSlot',
      'dayRemainingCapacity',
      'walkInMessage',
      'weekendUrgencyMessage',
      'spotsMessage',
    ],
    status: 'live',
    queryExample: '?businessId={businessId} | ?businessId={businessId}&typeKey=drop_in_play&summary=false',
  },
  {
    id: TAVARI_API_BOOKING_CATALOG,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_BOOKING_CATALOG}`,
    summary: 'Booking catalog (OTWK Book now)',
    description:
      'Read-only public catalog of Tavari customer-portal bookable activities. Returns booking types and portal-visible activities with summaries, images, starting prices, and deep links to the Tavari booking portal (/customer-portal/{businessId}/portal). Used for website Book now CTAs instead of Bookeo.',
    fields: [
      'businessId',
      'hostPortalUrl',
      'types',
      'activities',
      'typeKey',
      'startingPrice',
      'startingPriceFormatted',
      'priceFromLabel',
      'portalUrl',
      'imageUrl',
    ],
    status: 'live',
    queryExample: '?businessId={businessId}',
  },
  {
    id: TAVARI_API_PARTY_PACKAGES,
    method: 'GET',
    path: `/functions/v1/${TAVARI_API_PARTY_PACKAGES}`,
    summary: 'Birthday party packages (OTWK)',
    description:
      'Website-oriented party tiers from Tavari booking activities and inventory. Returns capacity (kids/adults), duration, food credit, inclusions, starting price, and bookable activityId per tier. Configure via booking activity “Show on website party packages” and linked POS inventory.',
    fields: [
      'businessId',
      'packages',
      'activityId',
      'inventoryItemId',
      'includedKids',
      'includedAdults',
      'durationMinutes',
      'foodCredit',
      'startingPrice',
      'startingPriceFormatted',
      'inclusions',
      'unlimitedPlayPolicy',
    ],
    status: 'live',
    queryExample: '?businessId={businessId}',
  },
  {
    id: 'website-public-hours',
    method: 'GET',
    path: '/functions/v1/website-public-hours',
    summary: 'Operating & holiday hours (legacy alias)',
    description: 'Use tavari-api-business-hours — same data, canonical Tavari APIs name.',
    fields: ['timezone', 'weeklyHours', 'specialHours', 'hoursSummary'],
    status: 'planned',
  },
];

export function getTavariApiFunctionUrl(functionName) {
  const base = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  if (!base) return '';
  return `${base}/functions/v1/${functionName}`;
}

export async function fetchTavariApiBusinessName(businessId) {
  return fetchTavariApiByBusinessId(TAVARI_API_BUSINESS_NAME, businessId);
}

export async function fetchTavariApiBusinessEmail(businessId) {
  return fetchTavariApiByBusinessId(TAVARI_API_BUSINESS_EMAIL, businessId);
}

export async function fetchTavariApiBusinessPhone(businessId) {
  return fetchTavariApiByBusinessId(TAVARI_API_BUSINESS_PHONE, businessId);
}

export async function fetchTavariApiBusinessAddress(businessId) {
  return fetchTavariApiByBusinessId(TAVARI_API_BUSINESS_ADDRESS, businessId);
}

export async function fetchTavariApiBusinessLogo(businessId) {
  return fetchTavariApiByBusinessId(TAVARI_API_BUSINESS_LOGO, businessId);
}

export async function fetchTavariApiBusinessFavicon(businessId) {
  return fetchTavariApiByBusinessId(TAVARI_API_BUSINESS_FAVICON, businessId);
}

export async function fetchTavariApiBusinessHours(businessId) {
  return fetchTavariApiByBusinessId(TAVARI_API_BUSINESS_HOURS, businessId);
}

export async function fetchTavariApiBusinessProducts(businessId, options = {}) {
  const url = getTavariApiFunctionUrl(TAVARI_API_BUSINESS_PRODUCTS);
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  if (!url || !anonKey) {
    throw new Error('Supabase is not configured in this environment.');
  }
  if (!businessId) {
    throw new Error('Business ID is required.');
  }

  const params = new URLSearchParams({ businessId });
  const ids = options.ids;
  if (Array.isArray(ids) && ids.length > 0) {
    params.set('ids', ids.filter(Boolean).join(','));
  }
  if (options.context) {
    params.set('context', String(options.context));
  }

  const response = await fetch(`${url}?${params.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

export async function fetchTavariApiWebsitePublicProfile(businessId) {
  return fetchTavariApiByBusinessId(TAVARI_API_WEBSITE_PUBLIC_PROFILE, businessId);
}

export async function fetchTavariApiCampRegistrationPortal(businessId) {
  return fetchTavariApiByBusinessId(TAVARI_API_CAMP_REGISTRATION, businessId, { action: 'getPortalInfo' });
}

export async function fetchTavariApiPartyGuestListPortal(businessId) {
  return fetchTavariApiByBusinessId(TAVARI_API_PARTY_GUEST_LIST, businessId, { action: 'getPortalInfo' });
}

export async function fetchTavariApiPartyPackages(businessId) {
  return fetchTavariApiByBusinessId(TAVARI_API_PARTY_PACKAGES, businessId);
}

export async function fetchTavariApiBookingCatalog(businessId) {
  return fetchTavariApiByBusinessId(TAVARI_API_BOOKING_CATALOG, businessId);
}

export async function fetchTavariApiBookingAvailability(businessId, extraQuery = {}) {
  return fetchTavariApiByBusinessId(TAVARI_API_BOOKING_AVAILABILITY, businessId, extraQuery);
}

export async function fetchTavariApiCampSessions(businessId, extraQuery = {}) {
  return fetchTavariApiByBusinessId(TAVARI_API_CAMP_SESSIONS, businessId, extraQuery);
}

export async function fetchTavariApiReputationFeed(businessId, extraQuery = {}) {
  return fetchTavariApiByBusinessId(TAVARI_API_REPUTATION_FEED, businessId, extraQuery);
}

export async function fetchTavariApiBusinessLinks(businessId, extraQuery = {}) {
  return fetchTavariApiByBusinessId(TAVARI_API_BUSINESS_LINKS, businessId, extraQuery);
}

export async function fetchTavariApiWebsitePromotions(businessId, extraQuery = {}) {
  return fetchTavariApiByBusinessId(TAVARI_API_WEBSITE_PROMOTIONS, businessId, extraQuery);
}

export async function fetchTavariApiManageBookingPortal(businessId) {
  return fetchTavariApiByBusinessId(TAVARI_API_MANAGE_BOOKING, businessId, { action: 'getPortalInfo' });
}

export async function fetchTavariApiLiveCapacity(businessId, extraQuery = {}) {
  return fetchTavariApiByBusinessId(TAVARI_API_LIVE_CAPACITY, businessId, extraQuery);
}

export async function fetchTavariApiWebsiteHeroSlides(businessId, extraQuery = {}) {
  return fetchTavariApiByBusinessId(TAVARI_API_WEBSITE_HERO_SLIDES, businessId, extraQuery);
}

export async function fetchTavariApiWebsiteFaqs(businessId, extraQuery = {}) {
  return fetchTavariApiByBusinessId(TAVARI_API_WEBSITE_FAQS, businessId, extraQuery);
}

export async function fetchTavariApiWebsiteCopyTokens(businessId, extraQuery = {}) {
  return fetchTavariApiByBusinessId(TAVARI_API_WEBSITE_COPY_TOKENS, businessId, extraQuery);
}

export async function fetchTavariApiWebsiteMenu(businessId, extraQuery = {}) {
  return fetchTavariApiByBusinessId(TAVARI_API_WEBSITE_MENU, businessId, extraQuery);
}

export async function fetchTavariApiHolidayPages(businessId, extraQuery = {}) {
  return fetchTavariApiByBusinessId(TAVARI_API_HOLIDAY_PAGES, businessId, extraQuery);
}

export async function fetchTavariApiWebsiteGallery(businessId, extraQuery = {}) {
  return fetchTavariApiByBusinessId(TAVARI_API_WEBSITE_GALLERY, businessId, extraQuery);
}

export async function fetchTavariApiWebsiteBuilderPages(businessId, extraQuery = {}) {
  return fetchTavariApiByBusinessId(TAVARI_API_WEBSITE_BUILDER_PAGES, businessId, extraQuery);
}

export async function fetchTavariApiDigitalSignage(businessId, extraQuery = {}) {
  return fetchTavariApiByBusinessId(TAVARI_API_DIGITAL_SIGNAGE, businessId, extraQuery);
}

export async function fetchTavariApiStorybookAdventure(businessId, payload = {}, options = {}) {
  const url = getTavariApiFunctionUrl(TAVARI_API_STORYBOOK_ADVENTURE);
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  if (!url || !anonKey) {
    throw new Error('Supabase is not configured in this environment.');
  }
  if (!businessId) {
    throw new Error('Business ID is required.');
  }

  const method = options.method || 'POST';
  const params = new URLSearchParams({ businessId, ...payload });
  const fetchUrl = method === 'GET' ? `${url}?${params.toString()}` : url;
  const response = await fetch(fetchUrl, {
    method,
    headers: {
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: method === 'POST' ? JSON.stringify({ businessId, ...payload }) : undefined,
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `Request failed (${response.status})`);
  }
  return result;
}

export async function fetchTavariApiManageBooking(businessId, payload = {}, options = {}) {
  const url = getTavariApiFunctionUrl(TAVARI_API_MANAGE_BOOKING);
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  if (!url || !anonKey) {
    throw new Error('Supabase is not configured in this environment.');
  }
  if (!businessId) {
    throw new Error('Business ID is required.');
  }

  const method = options.method || 'POST';
  const params = new URLSearchParams({ businessId, ...payload });
  const fetchUrl = method === 'GET' ? `${url}?${params.toString()}` : url;
  const headers = {
    Authorization: `Bearer ${anonKey}`,
    apikey: anonKey,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const response = await fetch(fetchUrl, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify({ businessId, ...payload }) : undefined,
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `Request failed (${response.status})`);
  }
  return result;
}

export async function fetchTavariApiWaiverEmbed(businessId, extraQuery = {}, options = {}) {
  const url = getTavariApiFunctionUrl(TAVARI_API_WAIVER_EMBED);
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  if (!url || !anonKey) {
    throw new Error('Supabase is not configured in this environment.');
  }
  if (!businessId) {
    throw new Error('Business ID is required.');
  }

  const method = options.method || 'GET';
  const params = new URLSearchParams({ businessId, ...extraQuery });
  const fetchUrl = method === 'GET' ? `${url}?${params.toString()}` : url;
  const response = await fetch(fetchUrl, {
    method,
    headers: {
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: method === 'POST' ? JSON.stringify({ businessId, ...extraQuery }) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

export async function fetchTavariApiWaiverStatus(businessId, extraQuery = {}, options = {}) {
  const url = getTavariApiFunctionUrl(TAVARI_API_WAIVER_STATUS);
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  if (!url || !anonKey) {
    throw new Error('Supabase is not configured in this environment.');
  }
  if (!businessId) {
    throw new Error('Business ID is required.');
  }

  const method = options.method || 'GET';
  const params = new URLSearchParams({ businessId, ...extraQuery });
  const fetchUrl = method === 'GET' ? `${url}?${params.toString()}` : url;
  const response = await fetch(fetchUrl, {
    method,
    headers: {
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: method === 'POST' ? JSON.stringify({ businessId, ...extraQuery }) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTavariApiByBusinessId(functionName, businessId, extraQuery = {}) {
  const url = getTavariApiFunctionUrl(functionName);
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  if (!url || !anonKey) {
    throw new Error('Supabase is not configured in this environment.');
  }
  if (!businessId) {
    throw new Error('Business ID is required.');
  }

  const params = new URLSearchParams({ businessId, ...extraQuery });
  let response;
  try {
    response = await fetchWithTimeout(`${url}?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request timed out (${functionName}).`);
    }
    throw error;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}
