import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { buildStaggeredSendSlots, clampScheduledForNotBeforeNow } from "../_shared/localSendTime.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const NAME_OF_DAY_CRON_SECRET = Deno.env.get("NAME_OF_DAY_CRON_SECRET") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-name-of-day-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** JS Sunday=0 … Saturday=6 */
type DowMap = Record<string, string>;

type CooldownTier = { max_days: number; points: number };

type ScoringProfile = {
  id?: string;
  popularity_quintile_points?: [number, number, number, number, number];
  visit_points?: { visited_30d: number; not_visited: number };
  same_waiver_duplicate_points?: { single_minor: number; multiple_minors_same_name: number };
  preschool_max_age?: number;
  preschool_points?: { in_range: number; out_of_range: number };
  /** When set (non-empty), replaces built-in `cooldownPoints` for this profile */
  cooldown_tiers?: CooldownTier[];
};

const DEFAULT_PROFILE_ID = "default";

/** Local wall-clock window for `mail_sending_queue.scheduled_for` (business timezone). */
const NAME_OF_DAY_LOCAL_SEND_START_HOUR = 6;
const NAME_OF_DAY_LOCAL_SEND_END_HOUR = 10;

function defaultProfile(): ScoringProfile {
  return {
    id: DEFAULT_PROFILE_ID,
    popularity_quintile_points: [-1, 0, 0, 1, 2],
    visit_points: { visited_30d: 2, not_visited: 0 },
    same_waiver_duplicate_points: { single_minor: 0, multiple_minors_same_name: 1 },
    preschool_max_age: 5,
    preschool_points: { in_range: 1, out_of_range: 0 },
  };
}

/** Locked cooldown tiers: days since last pick → points */
function cooldownPoints(daysSince: number): number {
  if (daysSince <= 10) return -5;
  if (daysSince <= 20) return -4;
  if (daysSince <= 30) return -3;
  if (daysSince <= 40) return -2;
  if (daysSince <= 50) return -1;
  if (daysSince <= 60) return 0;
  if (daysSince <= 70) return 1;
  if (daysSince <= 80) return 2;
  if (daysSince <= 90) return 3;
  if (daysSince <= 100) return 4;
  return 5;
}

/** Uses tiers sorted by max_days ascending; first tier where daysSince <= max_days wins */
function cooldownPointsFromTiers(daysSince: number, tiers: CooldownTier[]): number {
  const sorted = [...tiers].filter((t) =>
    Number.isFinite(t.max_days) && Number.isFinite(t.points)
  ).sort((a, b) => a.max_days - b.max_days);
  if (sorted.length === 0) return cooldownPoints(daysSince);
  for (const t of sorted) {
    if (daysSince <= t.max_days) return t.points;
  }
  return sorted[sorted.length - 1]!.points;
}

/** US SSA–style first names; used only to label gender pools (not to filter who is a minor) */
const FEMALE_NAMES = new Set(
  `emma,olivia,ava,charlotte,sophia,amelia,isabella,mia,evelyn,harper,luna,camila,gianna,elizabeth,eleanor,ella,abigail,sofia,avery,mila,scarlett,emily,aria,lily,chloe,violet,penelope,zoe,nora,lillian,hannah,lucy,ivy,brooklyn,willow,anna,daisy,cami,camille,camilla,kelly,stella,skylar,paisley,everly,riley,peyton,quinn,addison,kennedy,claire,paige,summer,autumn,brooklynn,natalie,hailey,alexa,allison,ashley,bailey,brielle,brooklynn,brynn,caroline,clara,cora,elena,elise,emilia,eva,faith,gracie,hailey,harley,heidi,hope,isla,jade,jasmine,jordyn,julia,kaitlyn,kate,katherine,kayla,kenzie,kiara,kimberly,kinley,kylie,lauren,leah,lexi,lila,lyla,mackenzie,madeline,madison,maggie,makayla,maria,mary,mckenna,melanie,molly,morgan,natalia,nevaeh,olive,payton,piper,raelynn,reagan,rose,sadie,samantha,sara,savannah,sienna,sierra,sophie,trinity,vanessa,vivian,ariadne,athena,persephone,alana,alicia,alyssa,amber,amy,andrea,angelica,angie,annabelle,annie,bethany,bianca,breanna,brittany,caitlin,cassandra,cassidy,cheyenne,courtney,danielle,denise,destiny,diana,ellen,gabrielle,giana,giselle,haylee,hayley,holly,isabelle,jenna,jillian,jocelyn,judy,karen,kelsey,kendra,kira,lacey,larissa,lindsay,lisa,livia,macy,maddie,madeleine,mallory,megan,melissa,meredith,mikayla,miranda,nadia,nicole,nikki,rachel,rebecca,regina,rhonda,shelby,siobhan,stacey,susan,tammy,tara,tiffany,whitney`
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const MALE_NAMES = new Set(
  `liam,noah,oliver,james,elijah,lucas,mason,logan,ethan,aiden,jackson,jacob,jack,henry,owen,theodore,dylan,luke,gabriel,asher,caleb,sebastian,wyatt,michael,daniel,scott,austin,milo,tim,timothy,thomas,tyler,bradley,braxton,channing,cooper,dominic,grayson,griffin,hunter,isaac,jace,jaxson,jeremiah,jordan,josiah,landon,levi,mark,micah,nash,nathan,owen,preston,robert,roger,rowan,ryder,ryker,samuel,silas,sterling,thaddeus,tristan,weston,woodrow,woody,apollo,arthur,axel,beau,bentley,brantley,brooks,bryce,cade,camden,carson,casey,cash,clayton,cody,colt,conner,connor,damian,dawson,dean,declan,derek,dexter,duke,edward,elliot,emmett,enzo,finn,forrest,george,graham,greyson,gunnar,ian,issac,jax,jayce,jett,jonah,jude,keaton,keegan,kellen,kyle,kyler,landen,leo,liam,link,maddox,malachi,mateo,maverick,max,miles,nico,parker,patton,phoenix,quinton,remington,river,roman,rocco,ryker,shane,sterling,sutton,tanner,tate,tony,trevor,tucker,ty,walker,warren,waylon,wells,xander,zane,stanley,stanly,brett,brendan,brent,brock,carter,chad,chase,christian,christopher,collin,cory,craig,dallas,damon,darren,david,dennis,derek,devin,donald,douglas,drew,edgar,eric,ethan,evan,frank,gary,gavin,greg,guy,harold,howard,hugh,ian,jake,jared,jason,jesse,jim,joe,john,jordan,joshua,justin,keith,ken,kurt,kyle,lance,larry,lee,lenny,leon,lloyd,marcus,martin,matt,maurice,maxwell,nick,noel,patrick,paul,peter,philip,quinn,ralph,randall,randy,ray,reed,reid,rick,ricky,ron,ronald,ross,russell,ryan,scott,sean,seth,shawn,spencer,steve,stuart,ted,terry,tim,toby,todd,tom,travis,trent,trevor,troy,tyson,victor,vince,walter,wayne,wesley,will,william,zachary`
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
/** In both sets → unisex: allowed in either column so both pools need other names too */
const UNISEX_NAMES = new Set(
  `riley,quinn,peyton,skylar,casey,jamie,alex,taylor,cameron,jordan,rowan,blake,avery,phoenix,river,logan,remi,remy,frankie,finley,marley,harley,riley,emerson,october`
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

/** Union of SSA-style lists: used to override bad legacy gender hints and to favor “normal” spellings in scoring */
const CANONICAL_NAME_SET = new Set<string>([...FEMALE_NAMES, ...MALE_NAMES, ...UNISEX_NAMES]);

/**
 * Strict list-based gender (same precedence as nameGenderBuckets). Used so legacy JSON gender_hint
 * cannot put clearly male listed names in the girl pool (and vice versa).
 */
function listOnlyGender(norm: string): "girl" | "boy" | "both" | "unknown" {
  const n = norm.toLowerCase();
  if (UNISEX_NAMES.has(n)) return "both";
  const f = FEMALE_NAMES.has(n);
  const m = MALE_NAMES.has(n);
  if (f && m) return "both";
  if (f && !m) return "girl";
  if (m && !f) return "boy";
  return "unknown";
}

type MinorRow = {
  participant_id: string;
  waiver_id: string;
  minor_first: string;
  minor_dob: string | null;
  guardian_email: string;
  signed_at: string | null;
  /** From DB: f / m when legacy JSON had gender/sex; modern waivers may be null */
  gender_hint: string | null;
};

type NameAgg = {
  norm: string;
  displays: string[];
  waiverIds: Set<string>;
  participantIds: string[];
  countsPerWaiver: Map<string, number>;
  /** Count of pool rows with SQL gender_hint = f (legacy JSON) */
  genderHintF: number;
  /** Count of pool rows with SQL gender_hint = m */
  genderHintM: number;
  /** Set when built from mail_name_of_day_inventory_snapshot (full DB aggregate) */
  inventoryEligibleCount?: number;
  inventoryWaiverDistinctCount?: number;
};

function hashString32(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  }
  return h;
}

/**
 * Splits *normalized* first names into girl-pool vs boy-pool for the two display columns.
 * - Names on the small allowlists go to the corresponding pool (or both if unisex).
 * - Any other name (e.g. "Lugnut" from a waiver) is assigned to **one** pool only, by hash, so
 *   the two columns are not two independent draws from the same list (the old behavior).
 */
function nameGenderBuckets(norm: string): { girl: boolean; boy: boolean } {
  const n = norm.toLowerCase();
  if (UNISEX_NAMES.has(n)) return { girl: true, boy: true };
  const f = FEMALE_NAMES.has(n);
  const m = MALE_NAMES.has(n);
  if (f && m) return { girl: true, boy: true };
  if (f && !m) return { girl: true, boy: false };
  if (m && !f) return { girl: false, boy: true };
  const h = hashString32(n);
  return (h & 1) === 0 ? { girl: true, boy: false } : { girl: false, boy: true };
}

/**
 * Gender pools: built-in lists win over legacy gender_hint when they disagree (fixes male names in the girl column).
 * For unknown spellings, trust aggregated hints, then hash split.
 */
function nameGenderFromAgg(norm: string, a: NameAgg): { girl: boolean; boy: boolean } {
  const list = listOnlyGender(norm);
  if (list === "girl") return { girl: true, boy: false };
  if (list === "boy") return { girl: false, boy: true };
  if (list === "both") return { girl: true, boy: true };

  const f = a.genderHintF;
  const m = a.genderHintM;
  if (f > 0 && m === 0) return { girl: true, boy: false };
  if (m > 0 && f === 0) return { girl: false, boy: true };
  return nameGenderBuckets(norm);
}

/**
 * Build girl/boy candidate lists without ever assigning male-only names to the girl pool (or vice versa).
 * Unisex names are split across pools to balance counts.
 */
function buildBalancedGenderPools(aggMap: Map<string, NameAgg>): { girlNorms: string[]; boyNorms: string[] } {
  const girlOnly: string[] = [];
  const boyOnly: string[] = [];
  const both: string[] = [];
  for (const [n, rowAgg] of aggMap) {
    const buck = nameGenderFromAgg(n, rowAgg);
    if (buck.girl && buck.boy) both.push(n);
    else if (buck.girl && !buck.boy) girlOnly.push(n);
    else if (!buck.girl && buck.boy) boyOnly.push(n);
  }
  const girlNorms = [...girlOnly];
  const boyNorms = [...boyOnly];
  const sortedBoth = [...new Set(both)].sort((a, b) => a.localeCompare(b));
  for (const n of sortedBoth) {
    if (girlNorms.length <= boyNorms.length) girlNorms.push(n);
    else boyNorms.push(n);
  }
  return { girlNorms, boyNorms };
}

/** Today’s calendar date string in a given IANA zone (aligned with processBusiness localDate) */
function localYmdInTimeZone(now: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const yyyy = get("year");
  const mm = get("month").padStart(2, "0");
  const dd = get("day").padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const o = error as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof o.message === "string" && o.message.trim()) parts.push(o.message.trim());
    if (typeof o.details === "string" && o.details.trim()) parts.push(o.details.trim());
    if (typeof o.hint === "string" && o.hint.trim()) parts.push(`(${o.hint.trim()})`);
    if (typeof o.code === "string" && o.code.trim()) parts.push(`[${o.code.trim()}]`);
    if (parts.length) return parts.join(" ");
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown error";
    }
  }
  return String(error);
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeTokenForRegex(token: string) {
  return String(token || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceMergeTokens(content: string, tokens: string[], value: unknown) {
  return tokens.reduce(
    (output, token) =>
      output.replace(new RegExp(escapeTokenForRegex(token), "g"), String(value ?? "")),
    String(content || ""),
  );
}

/** Distinct minor first names for merge tags (multiple waivers same first name → list once). */
function formatUniqueMinorFirstNames(minors: { first: string }[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const m of minors) {
    const raw = String(m.first || "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(raw);
  }
  return parts.join(", ");
}

function personalizeHtml(
  html: string,
  contact: Record<string, unknown>,
  extras: Record<string, unknown>,
) {
  const firstName = String(contact?.first_name || "");
  const lastName = String(contact?.last_name || "");
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  let output = String(html || "");
  /* Longer / double-brace tokens must run before `{FirstName}` or `{{FirstName}}` becomes `{Steve}` */
  output = replaceMergeTokens(output, ["{{First Name}}", "{{FirstName}}", "{FirstName}"], firstName);
  output = replaceMergeTokens(output, ["{{Last Name}}", "{{LastName}}", "{LastName}"], lastName);
  output = replaceMergeTokens(output, ["{{Full Name}}", "{{FullName}}", "{FullName}"], fullName);
  output = replaceMergeTokens(output, ["{{GirlNameOfDay}}", "{{Girl Name Of Day}}"], extras.girl_display_name ?? "");
  output = replaceMergeTokens(output, ["{{BoyNameOfDay}}", "{{Boy Name Of Day}}"], extras.boy_display_name ?? "");
  output = replaceMergeTokens(
    output,
    ["{{WinnerMinorFirstName}}", "{{Winner Minor First Name}}"],
    extras.minor_first_name ?? "",
  );
  output = replaceMergeTokens(output, ["{{NameOfDayDate}}", "{{Local Date}}"], extras.local_date ?? "");
  return output;
}

function htmlToText(html: string) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(s: string): string {
  return String(s || "").trim().toLowerCase();
}

function displayFromNorm(norm: string, samples: string[]): string {
  const map = new Map(samples.map((x) => [normalizeName(x), x.trim()]));
  return map.get(norm) || (norm.charAt(0).toUpperCase() + norm.slice(1));
}

function ageYears(dob: string | null, ref: Date): number | null {
  if (!dob) return null;
  const d = new Date(dob + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  let age = ref.getFullYear() - d.getUTCFullYear();
  const m = ref.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && ref.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

function quintileFromRank(rankIndex: number, totalDistinct: number): number {
  if (totalDistinct <= 1) return 2;
  const q = Math.floor((rankIndex / totalDistinct) * 5);
  return Math.min(4, Math.max(0, q));
}

function weightedPick<T>(items: T[], weights: number[]): T | null {
  let sum = 0;
  for (const w of weights) sum += Math.max(0.001, w);
  let r = Math.random() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0.001, weights[i] ?? 0);
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1] ?? null;
}

function resolveProfile(
  dow: number,
  profilesRaw: Record<string, ScoringProfile>,
  dowMap: DowMap,
): ScoringProfile {
  const profileId = dowMap[String(dow)] || dowMap[String(dow) as keyof DowMap] ||
    DEFAULT_PROFILE_ID;
  const merged = profilesRaw[profileId] || profilesRaw[DEFAULT_PROFILE_ID] || {};
  const base = defaultProfile();
  return {
    ...base,
    ...merged,
    popularity_quintile_points: merged.popularity_quintile_points ||
      base.popularity_quintile_points,
    visit_points: { ...base.visit_points, ...merged.visit_points },
    same_waiver_duplicate_points: {
      ...base.same_waiver_duplicate_points,
      ...merged.same_waiver_duplicate_points,
    },
    preschool_points: { ...base.preschool_points, ...merged.preschool_points },
  };
}

/** Dashboard “refresh” uses the logged-in user’s JWT + business membership */
async function authorizeUserForBusiness(
  req: Request,
  businessId: string,
  supabaseService: SupabaseClient,
): Promise<Response | null> {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);
  const token = auth.slice(7).trim();
  if (!token || token === SUPABASE_SERVICE_ROLE_KEY) return jsonResponse({ error: "Unauthorized" }, 401);
  if (!SUPABASE_ANON_KEY) return jsonResponse({ error: "Server misconfigured" }, 500);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData, error: ue } = await userClient.auth.getUser();
  if (ue || !userData?.user?.id) return jsonResponse({ error: "Unauthorized" }, 401);
  const uid = userData.user.id;

  const { data: bu } = await supabaseService.from("business_users").select("user_id").eq(
    "business_id",
    businessId,
  ).eq("user_id", uid).maybeSingle();
  if (bu) return null;

  const { data: ur } = await supabaseService.from("user_roles").select("id").eq("business_id", businessId).eq(
    "user_id",
    uid,
  ).eq("active", true).maybeSingle();
  if (ur) return null;

  return jsonResponse({ error: "Forbidden" }, 403);
}

/** Calendar days between last pick date (exclusive end) and targetLocalDate; used for cooldown vs the day being generated */
function calendarDaysAfterPick(lastPickYmd: string, targetLocalDate: string): number {
  const a = new Date(lastPickYmd + "T12:00:00Z").getTime();
  const b = new Date(targetLocalDate + "T12:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}

/** Fallback only — sequential per-name lookups (slow; avoid by applying migration RPC). */
async function loadCooldownCalendarDaysOneNorm(
  supabase: SupabaseClient,
  businessId: string,
  normalized: string,
  targetLocalDate: string,
): Promise<number> {
  const [{ data: dg }, { data: db }] = await Promise.all([
    supabase
      .from("mail_name_of_day_picks")
      .select("local_date")
      .eq("business_id", businessId)
      .eq("girl_normalized", normalized)
      .lt("local_date", targetLocalDate)
      .order("local_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("mail_name_of_day_picks")
      .select("local_date")
      .eq("business_id", businessId)
      .eq("boy_normalized", normalized)
      .lt("local_date", targetLocalDate)
      .order("local_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const cand = [dg?.local_date, db?.local_date].filter(Boolean).map(String);
  if (cand.length === 0) return 9999;
  const last = cand.reduce((a, b) => (a > b ? a : b));
  return calendarDaysAfterPick(last, targetLocalDate);
}

function isCooldownRpcUnavailable(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || "").toLowerCase();
  const details = String((err as { details?: string })?.details || "").toLowerCase();
  const hint = String((err as { hint?: string })?.hint || "").toLowerCase();
  const code = String((err as { code?: string })?.code || "");
  if (code === "42883" || code === "PGRST202") return true;
  const blob = `${msg} ${details} ${hint}`;
  return (
    blob.includes("mail_name_of_day_cooldown_last_dates") ||
    (blob.includes("could not find") && blob.includes("function")) ||
    blob.includes("does not exist")
  );
}

/**
 * Batched cooldown lookup via SQL RPC — per-name queries were O(n) HTTP round-trips and hit Edge
 * worker CPU limits (HTTP 546) for large minor pools.
 */
async function loadCooldownCalendarDaysMapBeforeTarget(
  supabase: SupabaseClient,
  businessId: string,
  norms: readonly string[],
  targetLocalDate: string,
): Promise<Map<string, number>> {
  const uniq = [...new Set(norms.map((n) => String(n || "").trim()).filter(Boolean))];
  const out = new Map<string, number>();
  if (uniq.length === 0) return out;

  const CHUNK = 500;
  try {
    for (let i = 0; i < uniq.length; i += CHUNK) {
      const chunk = uniq.slice(i, i + CHUNK);
      const { data, error } = await supabase.rpc("mail_name_of_day_cooldown_last_dates", {
        p_business_id: businessId,
        p_normalized: chunk,
        p_before: targetLocalDate,
      });
      if (error) throw error;
      for (const row of data || []) {
        const rec = row as { normalized?: string | null; last_local_date?: string | null };
        const norm = String(rec.normalized || "").trim();
        if (!norm) continue;
        const raw = rec.last_local_date;
        if (raw == null || raw === "") {
          out.set(norm, 9999);
        } else {
          const ymd = String(raw).slice(0, 10);
          out.set(norm, calendarDaysAfterPick(ymd, targetLocalDate));
        }
      }
    }
    return out;
  } catch (e) {
    if (!isCooldownRpcUnavailable(e)) throw e;
    console.warn(
      "[mail-name-of-day] mail_name_of_day_cooldown_last_dates RPC unavailable; using slow per-name cooldown fallback — apply migration 20260601120000_mail_name_of_day_cooldown_last_dates.sql",
    );
    /** Small parallel batches to reduce wall time vs strict sequential; still risky for huge pools. */
    const BATCH = 12;
    for (let i = 0; i < uniq.length; i += BATCH) {
      const slice = uniq.slice(i, i + BATCH);
      const cooled = await Promise.all(
        slice.map((norm) =>
          loadCooldownCalendarDaysOneNorm(supabase, businessId, norm, targetLocalDate)
        ),
      );
      slice.forEach((norm, j) => out.set(norm, cooled[j]!));
    }
    return out;
  }
}

/**
 * Prefer names with cooldown > 1 day and not used on the previous calendar day (either column),
 * when alternatives exist.
 */
function preferEligibleWeights(
  norms: string[],
  weights: number[],
  cooldowns: number[],
  blockedPrevDay: Set<string>,
): { norms: string[]; weights: number[] } {
  const eligibleIdx = norms
    .map((norm, i) => {
      const cd = cooldowns[i]!;
      const ok = cd > 1 && !blockedPrevDay.has(norm);
      return ok ? i : -1;
    })
    .filter((i) => i >= 0);
  if (eligibleIdx.length === 0) return { norms, weights };
  return {
    norms: eligibleIdx.map((i) => norms[i]!),
    weights: eligibleIdx.map((i) => weights[i]!),
  };
}

/** PostgREST defaults to max_rows=1000 on RPC results — page until exhausted */
const MINOR_POOL_PAGE_SIZE = 1000;
/** Hard cap so a broken Range/offset on RPC cannot spin forever (ties up edge + UI). */
const MINOR_POOL_MAX_PAGES = 250;
const MARKETING_CONTACTS_PAGE_SIZE = 1000;

/** Legacy UI path only; automated pick generation uses inventory_snapshot (full DB). */
const UI_REFRESH_MINOR_POOL_MAX_PAGES = 6;
/** UI “add next day”: search today .. today+N for the first date that still needs an auto pick. */
const UI_ONE_DAY_LOOKAHEAD = 90;


/** One RPC per branch avoids a single giant UNION hitting statement_timeout (57014). */
const MINOR_POOL_BRANCHES = ["modern", "legacy_minors", "legacy_info", "legacy_notes"] as const;

type MinorPoolBranch = (typeof MINOR_POOL_BRANCHES)[number];

function minorRowDedupeKey(r: MinorRow): string {
  return `${r.participant_id ?? ""}|${r.waiver_id ?? ""}|${r.minor_first ?? ""}`;
}

/** Paginate one branch; keep sequential pages (PostgREST range). */
async function loadMinorPoolBranch(
  supabase: SupabaseClient,
  businessId: string,
  branch: MinorPoolBranch,
  maxPages: number,
): Promise<MinorRow[]> {
  const rows: MinorRow[] = [];
  let prevFirstKey: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const from = page * MINOR_POOL_PAGE_SIZE;
    const { data, error } = await supabase
      .rpc("mail_name_of_day_minor_pool_branch", {
        p_business_id: businessId,
        p_branch: branch,
      })
      .range(from, from + MINOR_POOL_PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data || []) as MinorRow[];
    if (batch.length === 0) break;
    const firstKey = minorRowDedupeKey(batch[0]!);
    if (page > 0 && firstKey === prevFirstKey) {
      console.warn(
        `[mail-name-of-day] minor pool branch=${branch}: page repeated (Range likely ignored on RPC POST); stopping pagination`,
      );
      break;
    }
    prevFirstKey = firstKey;
    rows.push(...batch);
    if (batch.length < MINOR_POOL_PAGE_SIZE) break;
  }
  return rows;
}

/**
 * Load all four sources in parallel — sequential branches were exceeding the edge gateway timeout (504)
 * on large tenants (too many round-trips in one request).
 */
async function loadMinorPool(
  supabase: SupabaseClient,
  businessId: string,
  poolOpts?: { maxPagesPerBranch?: number },
): Promise<MinorRow[]> {
  const maxPages = Math.min(
    MINOR_POOL_MAX_PAGES,
    Math.max(1, poolOpts?.maxPagesPerBranch ?? MINOR_POOL_MAX_PAGES),
  );
  const branchSets = await Promise.all(
    MINOR_POOL_BRANCHES.map((branch) => loadMinorPoolBranch(supabase, businessId, branch, maxPages)),
  );
  const all = branchSets.flat();

  const seen = new Set<string>();
  const deduped: MinorRow[] = [];
  for (const r of all) {
    const k = minorRowDedupeKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(r);
  }
  return deduped;
}

const SEND_MATCH_BRANCHES = ["modern", "legacy_minors", "legacy_info", "legacy_notes"] as const;

/**
 * Email winners only: same name-filtered RPCs as the Mail preview — NOT the full minor pool.
 * Avoids scanning tens of thousands of rows on every cron tick / force-queue.
 */
async function loadMatchingMinorsForSendRpc(
  supabase: SupabaseClient,
  businessId: string,
  girlNorm: string,
  boyNorm: string,
): Promise<MinorRow[]> {
  const gn = String(girlNorm || "").trim();
  const bn = String(boyNorm || "").trim();
  const chunks = await Promise.all(
    SEND_MATCH_BRANCHES.map((branch) =>
      supabase.rpc("mail_name_of_day_minor_pool_for_preview_branch", {
        p_business_id: businessId,
        p_girl_norm: gn,
        p_boy_norm: bn,
        p_branch: branch,
      })
    ),
  );
  const out: MinorRow[] = [];
  const seen = new Set<string>();
  for (const c of chunks) {
    if (c.error) throw c.error;
    for (const raw of (c.data || []) as Record<string, unknown>[]) {
      const row: MinorRow = {
        participant_id: String(raw.participant_id ?? ""),
        waiver_id: String(raw.waiver_id ?? ""),
        minor_first: String(raw.minor_first ?? ""),
        minor_dob: raw.minor_dob != null ? String(raw.minor_dob).slice(0, 10) : null,
        guardian_email: String(raw.guardian_email ?? ""),
        signed_at: raw.signed_at != null ? String(raw.signed_at) : null,
        gender_hint: raw.gender_hint != null ? String(raw.gender_hint) : null,
      };
      const k = minorRowDedupeKey(row);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(row);
    }
  }
  return out;
}

async function enqueueNameOfDaySendsFromRows(input: {
  supabase: SupabaseClient;
  businessId: string;
  /** IANA zone from `businesses.timezone` (falls back to America/Toronto at call sites). */
  businessTimeZone: string;
  localDate: string;
  now: Date;
  girlNorm: string;
  boyNorm: string;
  girlDisplay: string;
  boyDisplay: string;
  winnerRows: MinorRow[];
  forceQueue?: boolean;
  legacyHint: Record<string, unknown>;
  /** Included so the API shape stays compatible with the heavy path */
  pregenForwardDays: number;
  pregenInserted: number;
  pregen_reason_counts: Record<string, number>;
  minor_pool_summary: Record<string, unknown>;
  sendPipeline: string;
}): Promise<Record<string, unknown>> {
  const {
    supabase,
    businessId,
    businessTimeZone,
    localDate,
    now,
    girlNorm,
    boyNorm,
    girlDisplay,
    boyDisplay,
    winnerRows,
    forceQueue,
    legacyHint,
    pregenForwardDays,
    pregenInserted,
    pregen_reason_counts,
    minor_pool_summary,
    sendPipeline,
  } = input;

  const winners = new Map<
    string,
    {
      email: string;
      minors: { first: string; slot: "girl" | "boy" }[];
    }
  >();

  for (const r of winnerRows) {
    const fn = normalizeName(r.minor_first);
    let slot: "girl" | "boy" | null = null;
    if (fn === girlNorm) slot = "girl";
    else if (fn === boyNorm) slot = "boy";
    if (!slot) continue;
    const email = normalizeEmail(r.guardian_email);
    if (!email) continue;
    let entry = winners.get(email);
    if (!entry) {
      entry = { email, minors: [] };
      winners.set(email, entry);
    }
    entry.minors.push({ first: r.minor_first.trim(), slot });
  }

  const { data: automations, error: autoErr } = await supabase
    .from("mail_automations")
    .select(`
        *,
        campaign:mail_campaigns!inner(id,business_id,name,subject_line,content_html,status)
      `)
    .eq("business_id", businessId)
    .eq("automation_type", "custom")
    .eq("is_enabled", true)
    .neq("status", "archived");

  if (autoErr) throw autoErr;

  const nodAutomations = (automations || []).filter((a) => {
    const c = a.criteria && typeof a.criteria === "object"
      ? (a.criteria as Record<string, unknown>)
      : {};
    return String(c.source || "") === "name_of_day";
  });

  if (nodAutomations.length === 0) {
    return {
      business_id: businessId,
      skipped: "no_name_of_day_automation",
      send_pipeline: sendPipeline,
      pregen_forward_days: pregenForwardDays,
      minor_pool_summary,
      pregen_inserted: pregenInserted,
      pregen_reason_counts,
    };
  }

  let queued = 0;
  const errors: string[] = [];
  let skipped_no_marketing_contact = 0;
  let skipped_duplicate_delivery = 0;

  const winnerEntries = [...winners.entries()];
  const totalSendIterations = nodAutomations.length * winnerEntries.length;
  const staggerSlots = buildStaggeredSendSlots(totalSendIterations, localDate, businessTimeZone, {
    start_hour: NAME_OF_DAY_LOCAL_SEND_START_HOUR,
    end_hour: NAME_OF_DAY_LOCAL_SEND_END_HOUR,
    minute_offset: 0,
  });
  let sendIteration = 0;

  for (const automation of nodAutomations) {
    const campaign = automation.campaign as Record<string, unknown>;
    const campaignId = String(campaign.id || "");
    const subjectTpl = String(campaign.subject_line || "");
    const htmlTpl = String(campaign.content_html || "");

    for (const [_email, win] of winnerEntries) {
      const slot = staggerSlots[sendIteration];
      sendIteration += 1;
      const scheduledFor = clampScheduledForNotBeforeNow(
        slot?.scheduled_for ?? now.toISOString(),
        now,
      );

      const { data: contacts } = await supabase
        .from("mail_contacts")
        .select("id,email,first_name,last_name,subscribed,consent_method,consent_timestamp")
        .eq("business_id", businessId)
        .ilike("email", win.email)
        .eq("subscribed", true)
        .not("consent_method", "is", null)
        .not("consent_timestamp", "is", null)
        .limit(1);

      const contact = contacts?.[0];
      if (!contact?.id) {
        skipped_no_marketing_contact += 1;
        continue;
      }

      const deliveryKey = `name-of-day:${localDate}:${contact.id}`;
      const minorFirst = formatUniqueMinorFirstNames(win.minors);

      const context = {
        source: "name_of_day",
        bypass_marketing_frequency_cap: true,
        girl_display_name: girlDisplay,
        boy_display_name: boyDisplay,
        minor_first_name: minorFirst,
        local_date: localDate,
        winning_minors: win.minors,
      };

      const personalizedHtml = personalizeHtml(htmlTpl, contact as Record<string, unknown>, context);
      const personalizedSubject = personalizeHtml(subjectTpl, contact as Record<string, unknown>, context);

      const runPayload = {
        business_id: businessId,
        automation_id: String(automation.id),
        campaign_id: campaignId,
        contact_id: String(contact.id),
        email_address: win.email,
        automation_type: "custom",
        delivery_key: deliveryKey,
        trigger_date: localDate,
        event_date: localDate,
        context,
        status: "queued",
        queued_at: now.toISOString(),
        updated_at: now.toISOString(),
      };

      const { data: runRow, error: runErr } = await supabase
        .from("mail_automation_runs")
        .insert(runPayload)
        .select("id")
        .single();

      if (runErr) {
        if (String((runErr as { code?: string }).code) === "23505") {
          skipped_duplicate_delivery += 1;
          continue;
        }
        errors.push(runErr.message);
        continue;
      }

      const queuePayload = {
        campaign_id: campaignId,
        contact_id: String(contact.id),
        email_address: win.email,
        status: "queued",
        priority: 4,
        scheduled_for: scheduledFor,
        business_id: businessId,
        personalized_content: personalizedHtml,
        automation_id: String(automation.id),
        automation_run_id: String(runRow!.id),
      };

      const { error: qErr } = await supabase.from("mail_sending_queue").insert(queuePayload);
      if (qErr) {
        errors.push(qErr.message);
        await supabase
          .from("mail_automation_runs")
          .update({
            status: "failed",
            last_error: qErr.message,
            updated_at: new Date().toISOString(),
          })
          .eq("id", String(runRow!.id));
        continue;
      }

      queued += 1;
    }
  }

  return {
    business_id: businessId,
    local_date: localDate,
    girl: girlDisplay,
    boy: boyDisplay,
    send_pipeline: sendPipeline,
    winner_rows_loaded: winnerRows.length,
    pregen_forward_days: pregenForwardDays,
    pregen_results_summary: pregenInserted,
    pregen_reason_counts,
    minor_pool_summary,
    winners: winners.size,
    queued,
    skipped_no_marketing_contact,
    skipped_duplicate_delivery,
    nod_automation_ids: nodAutomations.map((a) => String((a as { id?: string }).id || "")).filter(Boolean),
    errors: errors.length ? errors : undefined,
    ...(forceQueue ? { force_queue: true as const } : {}),
    ...legacyHint,
  };
}

async function loadVisitedParticipantIds(
  supabase: SupabaseClient,
  businessId: string,
  sinceIso: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("waiver_participant_check_ins")
    .select("waiver_participant_id")
    .eq("business_id", businessId)
    .gte("checked_in_at", sinceIso)
    .not("waiver_participant_id", "is", null);

  if (error) throw error;
  const set = new Set<string>();
  for (const r of data || []) {
    const id = r.waiver_participant_id as string | null;
    if (id) set.add(id);
  }
  return set;
}

/** Exclude minors outside max_child_age_for_automations or missing DOB (cannot verify age). */
function filterMinorRowsByMaxAge(rows: MinorRow[], maxAge: number, ref: Date): MinorRow[] {
  const cap = Math.min(25, Math.max(0, Math.floor(Number(maxAge)) || 12));
  return rows.filter((r) => {
    const a = ageYears(r.minor_dob, ref);
    if (a === null) return false;
    return a >= 0 && a <= cap;
  });
}

/** Same eligibility as enqueueNameOfDaySendsFromRows contact lookup (marketing consent on file). */
async function loadMarketingEligibleContactsByEmail(
  supabase: SupabaseClient,
  businessId: string,
): Promise<Map<string, { first_name: string | null; last_name: string | null }>> {
  const map = new Map<string, { first_name: string | null; last_name: string | null }>();
  for (let from = 0; ; from += MARKETING_CONTACTS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("mail_contacts")
      .select("email, first_name, last_name")
      .eq("business_id", businessId)
      .eq("subscribed", true)
      .not("consent_method", "is", null)
      .not("consent_timestamp", "is", null)
      .range(from, from + MARKETING_CONTACTS_PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data || [];
    for (const r of batch) {
      const e = normalizeEmail(String((r as { email?: string }).email ?? ""));
      if (!e) continue;
      map.set(e, {
        first_name: (r as { first_name?: string | null }).first_name ?? null,
        last_name: (r as { last_name?: string | null }).last_name ?? null,
      });
    }
    if (batch.length < MARKETING_CONTACTS_PAGE_SIZE) break;
  }
  return map;
}

function filterMinorRowsByMarketingContacts(
  rows: MinorRow[],
  contactsByEmail: Map<string, unknown>,
): MinorRow[] {
  return rows.filter((r) => contactsByEmail.has(normalizeEmail(r.guardian_email)));
}

async function loadManualClassifications(
  supabase: SupabaseClient,
  businessId: string,
): Promise<Map<string, { girl: boolean; boy: boolean }>> {
  const { data, error } = await supabase
    .from("mail_name_of_day_name_classifications")
    .select("normalized_name, girl_eligible, boy_eligible")
    .eq("business_id", businessId);
  if (error) throw error;
  const m = new Map<string, { girl: boolean; boy: boolean }>();
  for (const row of data || []) {
    const n = normalizeName(String(row.normalized_name || ""));
    if (!n) continue;
    m.set(n, {
      girl: Boolean(row.girl_eligible),
      boy: Boolean(row.boy_eligible),
    });
  }
  return m;
}

/**
 * Manual buckets: only names classified for girl and/or boy AND present in the current (aged) pool.
 * Same normalized name may appear in both lists (unisex); pickPairWithBlocker still enforces girl !== boy per day.
 */
function buildManualGenderPools(
  agg: Map<string, NameAgg>,
  classMap: Map<string, { girl: boolean; boy: boolean }>,
): { girlNorms: string[]; boyNorms: string[] } {
  const girlNorms: string[] = [];
  const boyNorms: string[] = [];
  for (const norm of agg.keys()) {
    const c = classMap.get(norm);
    if (!c) continue;
    if (c.girl) girlNorms.push(norm);
    if (c.boy) boyNorms.push(norm);
  }
  girlNorms.sort((a, b) => a.localeCompare(b));
  boyNorms.sort((a, b) => a.localeCompare(b));
  return { girlNorms, boyNorms };
}

async function maybeSendManualPoolEmptyAlert(input: {
  supabase: SupabaseClient;
  supabaseUrl: string;
  serviceKey: string;
  businessId: string;
  localDateYmd: string;
  alertEmail: string;
  businessName: string;
  lastAlertSentOn: string | null | undefined;
}): Promise<void> {
  const {
    supabase,
    supabaseUrl,
    serviceKey,
    businessId,
    localDateYmd,
    alertEmail,
    businessName,
    lastAlertSentOn,
  } = input;
  const to = String(alertEmail || "").trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return;

  const { data: freshAlert } = await supabase
    .from("mail_settings")
    .select("name_of_day_last_pool_alert_sent_on")
    .eq("business_id", businessId)
    .maybeSingle();
  const sentOn = freshAlert?.name_of_day_last_pool_alert_sent_on ?? lastAlertSentOn;
  if (sentOn && String(sentOn) === localDateYmd) return;

  const html =
    `<div style="font-family:system-ui,sans-serif;max-width:560px;line-height:1.5;color:#0f172a">` +
    `<p><strong>Name of the Day — action needed</strong></p>` +
    `<p>Manual girl/boy buckets for <strong>${escapeHtml(businessName)}</strong> cannot fill both slots ` +
    `(missing classified names in the current minor pool under max age, or no valid pair).</p>` +
    `<p>Open <strong>Mail → Automations → Name of the Day</strong> and assign names to Girl / Boy (or both for unisex), then save.</p>` +
    `<p style="color:#64748b;font-size:13px">Local date: ${escapeHtml(localDateYmd)}</p>` +
    `</div>`;

  const mailRes = await fetch(`${supabaseUrl}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      businessId,
      campaignId: crypto.randomUUID(),
      emailType: "transactional",
      to,
      fromEmail: "noreply@tavarios.ca",
      fromName: "Tavari",
      subject: `Name of the Day: assign buckets — ${businessName}`,
      html,
      text:
        `Manual Name-of-Day buckets need attention for ${businessName}. Open Mail → Automations → Name of the Day. (${localDateYmd})`,
    }),
  });
  const mailJson = await mailRes.json().catch(() => null);
  if (!mailRes.ok || mailJson?.ok !== true) {
    console.warn("[mail-name-of-day] pool alert mail-send failed", mailJson?.error || mailRes.status);
    return;
  }
  await supabase
    .from("mail_settings")
    .update({ name_of_day_last_pool_alert_sent_on: localDateYmd })
    .eq("business_id", businessId);
}

function aggregateNames(rows: MinorRow[]): Map<string, NameAgg> {
  const map = new Map<string, NameAgg>();
  for (const r of rows) {
    const norm = normalizeName(r.minor_first);
    if (!norm) continue;
    let agg = map.get(norm);
    if (!agg) {
      agg = {
        norm,
        displays: [],
        waiverIds: new Set(),
        participantIds: [],
        countsPerWaiver: new Map(),
        genderHintF: 0,
        genderHintM: 0,
      };
      map.set(norm, agg);
    }
    agg.displays.push(r.minor_first);
    agg.waiverIds.add(r.waiver_id);
    agg.participantIds.push(r.participant_id);
    agg.countsPerWaiver.set(
      r.waiver_id,
      (agg.countsPerWaiver.get(r.waiver_id) || 0) + 1,
    );
    const gh = String(r.gender_hint || "").toLowerCase();
    if (gh === "f") agg.genderHintF += 1;
    else if (gh === "m") agg.genderHintM += 1;
  }
  return map;
}

/** Score with per-participant DOB for preschool weekday boost */
function scoreNameDetailed(
  _norm: string,
  agg: NameAgg,
  profile: ScoringProfile,
  popularityRank: number,
  totalNames: number,
  visited: Set<string>,
  cooldownDays: number,
  refDate: Date,
  dow: number,
  rowsByParticipant: Map<string, MinorRow>,
): number {
  const pq = profile.popularity_quintile_points || [-1, 0, 0, 1, 2];
  const quintile = quintileFromRank(popularityRank, totalNames);
  let score = pq[quintile] ?? 0;

  const vp = profile.visit_points || { visited_30d: 0, not_visited: 0 };
  let anyVisit = false;
  if (agg.participantIds.length > 0) {
    for (const pid of agg.participantIds) {
      if (visited.has(pid)) {
        anyVisit = true;
        break;
      }
    }
  }
  score += anyVisit ? vp.visited_30d : vp.not_visited;

  const dup = profile.same_waiver_duplicate_points ||
    { single_minor: 0, multiple_minors_same_name: 0 };
  let multiSameWaiver = false;
  if (agg.inventoryEligibleCount != null && agg.inventoryWaiverDistinctCount != null) {
    multiSameWaiver = agg.inventoryEligibleCount > agg.inventoryWaiverDistinctCount;
  } else {
    for (const c of agg.countsPerWaiver.values()) {
      if (c >= 2) multiSameWaiver = true;
    }
  }
  score += multiSameWaiver ? dup.multiple_minors_same_name : dup.single_minor;

  const maxPre = profile.preschool_max_age ?? 5;
  const pp = profile.preschool_points || { in_range: 0, out_of_range: 0 };
  if (dow >= 1 && dow <= 5 && agg.participantIds.length > 0) {
    let preschoolHit = false;
    for (const pid of agg.participantIds) {
      const row = rowsByParticipant.get(pid);
      const a = ageYears(row?.minor_dob ?? null, refDate);
      if (a !== null && a <= maxPre) {
        preschoolHit = true;
        break;
      }
    }
    score += preschoolHit ? pp.in_range : pp.out_of_range;
  }

  const effectiveCd = cooldownDays > 200 ? 101 : cooldownDays;
  const customTiers = profile.cooldown_tiers;
  score += customTiers && customTiers.length > 0
    ? cooldownPointsFromTiers(effectiveCd, customTiers)
    : cooldownPoints(effectiveCd);

  const nn = normalizeName(_norm);
  if (!CANONICAL_NAME_SET.has(nn)) {
    score -= 8;
  } else {
    score += 0.75;
  }

  return score;
}

function pickPairWithBlocker(args: {
  girlCandidates: string[];
  boyCandidates: string[];
  girlWeights: number[];
  boyWeights: number[];
  agg: Map<string, NameAgg>;
}): { girl: string; boy: string } | null {
  const { girlCandidates, boyCandidates, girlWeights, boyWeights, agg } = args;

  function waiverOverlap(gNorm: string, bNorm: string): boolean {
    const waiversG = new Set<string>();
    const waiversB = new Set<string>();
    const ag = agg.get(normalizeName(gNorm));
    const ab = agg.get(normalizeName(bNorm));
    if (ag) ag.waiverIds.forEach((id) => waiversG.add(id));
    if (ab) ab.waiverIds.forEach((id) => waiversB.add(id));
    for (const id of waiversG) {
      if (waiversB.has(id)) return true;
    }
    return false;
  }

  for (let attempt = 0; attempt < 80; attempt++) {
    const g = weightedPick(girlCandidates, girlWeights);
    const b = weightedPick(boyCandidates, boyWeights);
    if (!g || !b || normalizeName(g) === normalizeName(b)) continue;

    if (!waiverOverlap(g, b)) return { girl: g, boy: b };
  }

  /** Small pools often share one waiver — still ship two different names for the promo */
  for (const g of girlCandidates) {
    for (const b of boyCandidates) {
      if (normalizeName(g) === normalizeName(b)) continue;
      return { girl: g, boy: b };
    }
  }
  return null;
}

const PREGEN_FORWARD_DAYS = 21;

/**
 * How many minutes *before* the configured local send time we still run the heavy
 * minor-pool + calendar pregen path so `mail_name_of_day_picks` exists **before** send.
 * Without this, the first attempt to create today's row happens only after send time;
 * a timeout or failure there leaves no pick and no emails for the day.
 */
const NAME_OF_DAY_PREGEN_RAMP_BEFORE_SEND_MINUTES = 3 * 60;

/** First calendar day (local) that still needs an auto row, or null if we should skip to the next day. */
function dayNeedsAutoPregen(
  row:
    | { pick_source?: string | null; girl_normalized?: string | null; boy_normalized?: string | null }
    | undefined,
  hasPickSourceColumn: boolean,
): boolean {
  if (!row) return true;
  if (hasPickSourceColumn && String(row.pick_source || "") === "user_edited") return false;
  const g = String(row.girl_normalized ?? "").trim();
  const b = String(row.boy_normalized ?? "").trim();
  return !(g.length > 0 && b.length > 0);
}

function summarizePregenReasons(pregenResults: Record<string, unknown>[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const x of pregenResults) {
    if ((x as { inserted?: boolean }).inserted === true) {
      counts.inserted = (counts.inserted || 0) + 1;
      continue;
    }
    const reason = String((x as { reason?: string }).reason || "unknown");
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function addCalendarDays(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Aligns with existing processBusiness weekday logic */
function localDateDow(localYmd: string): number {
  return new Date(`${localYmd}T12:00:00`).getDay();
}

function scoringRefDate(localYmd: string): Date {
  return new Date(`${localYmd}T12:00:00`);
}

/** Production DBs without migration 20260430120000 lack pick_source / updated_at on picks */
type MailNodPicksColumnSupport = {
  pickSource: boolean;
  updatedAt: boolean;
};

function isPostgrestMissingColumnError(err: unknown, columnName: string): boolean {
  const m = String((err as { message?: string })?.message || "");
  return m.includes(`'${columnName}'`) && m.includes("schema cache");
}

async function detectMailNodPicksColumnSupport(
  supabase: SupabaseClient,
): Promise<MailNodPicksColumnSupport> {
  let pickSource = true;
  let updatedAt = true;

  const pickProbe = await supabase.from("mail_name_of_day_picks").select("pick_source").limit(1);
  if (pickProbe.error && isPostgrestMissingColumnError(pickProbe.error, "pick_source")) {
    pickSource = false;
  }

  const updProbe = await supabase.from("mail_name_of_day_picks").select("updated_at").limit(1);
  if (updProbe.error && isPostgrestMissingColumnError(updProbe.error, "updated_at")) {
    updatedAt = false;
  }

  return { pickSource, updatedAt };
}

async function tryInsertAutoPickForDate(
  supabase: SupabaseClient,
  input: {
    businessId: string;
    targetLocalDate: string;
    agg: Map<string, NameAgg>;
    girlNorms: string[];
    boyNorms: string[];
    rankIndex: Map<string, number>;
    totalDistinct: number;
    visited: Set<string>;
    rowsByParticipant: Map<string, MinorRow>;
    profilesRaw: Record<string, ScoringProfile>;
    dowMap: DowMap;
    realNow: Date;
    picksCols: MailNodPicksColumnSupport;
  },
): Promise<{ inserted: boolean; reason?: string }> {
  const selectExisting = input.picksCols.pickSource
    ? "id, pick_source, girl_normalized, boy_normalized"
    : "id, girl_normalized, boy_normalized";

  const { data: existing } = await supabase
    .from("mail_name_of_day_picks")
    .select(selectExisting)
    .eq("business_id", input.businessId)
    .eq("local_date", input.targetLocalDate)
    .maybeSingle();

  const src = input.picksCols.pickSource
    ? ((existing?.pick_source as string | undefined) ?? "auto")
    : "auto";
  if (input.picksCols.pickSource && src === "user_edited") {
    return { inserted: false, reason: "user_edited" };
  }
  const hasCompleteAuto = Boolean(
    existing &&
      src === "auto" &&
      String(existing.girl_normalized || "").trim() !== "" &&
      String(existing.boy_normalized || "").trim() !== "",
  );
  if (hasCompleteAuto) {
    return { inserted: false, reason: "already_auto" };
  }

  const prevYmd = addCalendarDays(input.targetLocalDate, -1);
  const { data: prevPick } = await supabase
    .from("mail_name_of_day_picks")
    .select("girl_normalized, boy_normalized")
    .eq("business_id", input.businessId)
    .eq("local_date", prevYmd)
    .maybeSingle();
  const blockedPrevDay = new Set<string>();
  if (prevPick?.girl_normalized) blockedPrevDay.add(normalizeName(String(prevPick.girl_normalized)));
  if (prevPick?.boy_normalized) blockedPrevDay.add(normalizeName(String(prevPick.boy_normalized)));

  const dow = localDateDow(input.targetLocalDate);
  const profile = resolveProfile(dow, input.profilesRaw, input.dowMap);
  const refDate = scoringRefDate(input.targetLocalDate);
  const agg = input.agg;

  const cooldownMap = await loadCooldownCalendarDaysMapBeforeTarget(
    supabase,
    input.businessId,
    [...new Set([...input.girlNorms, ...input.boyNorms])],
    input.targetLocalDate,
  );

  function weightsAndCooldowns(norms: string[]): { weights: number[]; cooldowns: number[] } {
    const weights: number[] = [];
    const cooldowns: number[] = [];
    for (const norm of norms) {
      const a = agg.get(norm)!;
      const rank = input.rankIndex.get(norm) ?? 0;
      const cd = cooldownMap.get(norm) ?? 9999;
      cooldowns.push(cd);
      const w = scoreNameDetailed(
        norm,
        a,
        profile,
        rank,
        input.totalDistinct,
        input.visited,
        cd,
        refDate,
        dow,
        input.rowsByParticipant,
      );
      let wt = Math.max(0.001, 10 + w);
      if (blockedPrevDay.has(norm)) wt = 0.00001;
      if (cd <= 1) wt = 0.00001;
      else if (cd <= 3) wt *= 0.08;
      else if (cd <= 7) wt *= 0.35;
      weights.push(wt);
    }
    return { weights, cooldowns };
  }

  const girlWC = weightsAndCooldowns(input.girlNorms);
  const boyWC = weightsAndCooldowns(input.boyNorms);

  const girlPref = preferEligibleWeights(input.girlNorms, girlWC.weights, girlWC.cooldowns, blockedPrevDay);
  const boyPref = preferEligibleWeights(input.boyNorms, boyWC.weights, boyWC.cooldowns, blockedPrevDay);

  const picked = pickPairWithBlocker({
    girlCandidates: girlPref.norms,
    boyCandidates: boyPref.norms,
    girlWeights: girlPref.weights,
    boyWeights: boyPref.weights,
    agg,
  });
  if (!picked) {
    return { inserted: false, reason: "empty_gender_pool_or_single_name" };
  }

  const girlNorm = normalizeName(picked.girl);
  const boyNorm = normalizeName(picked.boy);
  const gAgg = agg.get(girlNorm)!;
  const bAgg = agg.get(boyNorm)!;

  const rowPayload: Record<string, unknown> = {
    business_id: input.businessId,
    local_date: input.targetLocalDate,
    girl_display_name: displayFromNorm(girlNorm, gAgg.displays),
    boy_display_name: displayFromNorm(boyNorm, bAgg.displays),
    girl_normalized: girlNorm,
    boy_normalized: boyNorm,
    meta: { profile_id: profile.id || DEFAULT_PROFILE_ID, dow },
  };
  if (input.picksCols.pickSource) {
    rowPayload.pick_source = "auto";
  }
  if (input.picksCols.updatedAt) {
    rowPayload.updated_at = input.realNow.toISOString();
  }

  if (existing?.id && !hasCompleteAuto) {
    const { error: upErr } = await supabase
      .from("mail_name_of_day_picks")
      .update(rowPayload)
      .eq("id", existing.id);
    if (upErr) {
      console.error("[mail-name-of-day] update pick failed", upErr);
      return { inserted: false, reason: getErrorMessage(upErr) };
    }
    return { inserted: true };
  }

  const { error } = await supabase.from("mail_name_of_day_picks").insert(rowPayload);

  if (error) {
    console.error("[mail-name-of-day] insert pick failed", error);
    return { inserted: false, reason: getErrorMessage(error) };
  }
  return { inserted: true };
}

function aggregateNamesFromInventory(
  namesRaw: Record<string, unknown>[],
): Map<string, NameAgg> {
  const map = new Map<string, NameAgg>();
  for (const row of namesRaw) {
    const norm = normalizeName(String(row.normalized_name ?? ""));
    if (!norm) continue;
    const sampleRpc = String(row.sample_display ?? "").trim();
    map.set(norm, {
      norm,
      displays: sampleRpc ? [displayFromNorm(norm, [sampleRpc])] : [],
      waiverIds: new Set(),
      participantIds: [],
      countsPerWaiver: new Map(),
      genderHintF: 0,
      genderHintM: 0,
      inventoryEligibleCount: Number(row.eligible_minor_count ?? 0),
      inventoryWaiverDistinctCount: Number(row.waiver_distinct_count ?? 0),
    });
  }
  return map;
}

async function loadPickContextFromInventory(
  supabase: SupabaseClient,
  businessId: string,
): Promise<{
  agg: Map<string, NameAgg>;
  girlNorms: string[];
  boyNorms: string[];
  rankIndex: Map<string, number>;
  totalDistinct: number;
  visited: Set<string>;
  rowsByParticipant: Map<string, MinorRow>;
  minor_pool_summary: Record<string, unknown>;
  useManualBuckets: boolean;
  mailSettingsRow: Record<string, unknown> | null;
}> {
  const { data: mailSettingsRow, error: mailSettingsErr } = await supabase
    .from("mail_settings")
    .select(
      "max_child_age_for_automations, name_of_day_use_manual_buckets, name_of_day_alert_email, name_of_day_last_pool_alert_sent_on",
    )
    .eq("business_id", businessId)
    .maybeSingle();
  if (mailSettingsErr) throw mailSettingsErr;

  const maxChildAgeApplied = Number(mailSettingsRow?.max_child_age_for_automations ?? 12);
  const { data: snapRaw, error: rpcErr } = await supabase.rpc("mail_name_of_day_inventory_snapshot", {
    p_business_id: businessId,
    p_max_age: Math.floor(maxChildAgeApplied),
  });
  if (rpcErr) throw rpcErr;

  const snap = snapRaw as Record<string, unknown> | null;
  const namesRaw = Array.isArray(snap?.names)
    ? snap!.names as Record<string, unknown>[]
    : [];

  const agg = aggregateNamesFromInventory(namesRaw);
  const sortedByFreq = [...agg.entries()].sort((a, b) => {
    const ca = a[1].inventoryEligibleCount ?? a[1].participantIds.length;
    const cb = b[1].inventoryEligibleCount ?? b[1].participantIds.length;
    if (cb !== ca) return cb - ca;
    return a[0].localeCompare(b[0]);
  });
  const totalDistinct = sortedByFreq.length;
  const rankIndex = new Map<string, number>();
  sortedByFreq.forEach(([norm], idx) => rankIndex.set(norm, idx));

  const useManualBuckets = Boolean(mailSettingsRow?.name_of_day_use_manual_buckets);
  let girlNorms: string[];
  let boyNorms: string[];
  if (useManualBuckets) {
    const classMap = await loadManualClassifications(supabase, businessId);
    const pools = buildManualGenderPools(agg, classMap);
    girlNorms = pools.girlNorms;
    boyNorms = pools.boyNorms;
  } else {
    const pools = buildBalancedGenderPools(agg);
    girlNorms = pools.girlNorms;
    boyNorms = pools.boyNorms;
  }

  const minor_pool_summary = {
    pick_pipeline: "inventory_snapshot",
    distinct_eligible_names: totalDistinct,
    pool_rows_before_age_filter: Number(snap?.pool_rows_before_age_filter ?? 0),
    pool_rows_after_age_filter: Number(snap?.pool_rows_after_age_filter ?? 0),
    pool_rows_after_marketing_filter: Number(snap?.pool_rows_after_marketing_filter ?? 0),
    pool_rows_union_raw: snap?.pool_rows_union_raw != null ? Number(snap.pool_rows_union_raw) : undefined,
    marketing_eligible_contacts: Number(snap?.marketing_eligible_contacts ?? 0),
    max_child_age_for_automations: maxChildAgeApplied,
    name_of_day_use_manual_buckets: useManualBuckets,
  };

  return {
    agg,
    girlNorms,
    boyNorms,
    rankIndex,
    totalDistinct,
    visited: new Set<string>(),
    rowsByParticipant: new Map<string, MinorRow>(),
    minor_pool_summary,
    useManualBuckets,
    mailSettingsRow: mailSettingsRow as Record<string, unknown> | null,
  };
}

async function processBusiness(
  supabase: SupabaseClient,
  businessId: string,
  timeZone: string,
  now: Date,
  opts?: { refreshAutoPicks?: boolean; uiFastRefresh?: boolean; forceQueue?: boolean },
): Promise<Record<string, unknown>> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const yyyy = get("year");
  const mm = get("month").padStart(2, "0");
  const dd = get("day").padStart(2, "0");
  const localDate = `${yyyy}-${mm}-${dd}`;

  const { data: nodSettings } = await supabase
    .from("mail_name_of_day_settings")
    .select("send_hour, send_minute, profiles, dow_profile_ids")
    .eq("business_id", businessId)
    .maybeSingle();

  const sendHour = Number(nodSettings?.send_hour ?? 6);
  const sendMinute = Number(nodSettings?.send_minute ?? 0);

  const profilesRaw = (nodSettings?.profiles || {}) as Record<string, ScoringProfile>;
  const dowMap = (nodSettings?.dow_profile_ids || {}) as DowMap;
  if (!profilesRaw[DEFAULT_PROFILE_ID]) {
    profilesRaw[DEFAULT_PROFILE_ID] = defaultProfile();
  }

  /**
   * Allow the first cron tick at or after the configured local send time.
   * Idempotency is handled by delivery keys (`name-of-day:<localDate>:<contactId>`),
   * so later ticks for the same day skip duplicates instead of missing the send entirely.
   *
   * Also allow a **pregen ramp** window before send so calendar rows exist even if the
   * first post-send-time run is slow or fails.
   */
  const currentLocalMinutes = hour * 60 + minute;
  const configuredLocalMinutes = sendHour * 60 + sendMinute;
  const atOrAfterSendTime = currentLocalMinutes >= configuredLocalMinutes;
  const minutesBeforeSend = configuredLocalMinutes - currentLocalMinutes;
  const inPregenRamp =
    minutesBeforeSend > 0 && minutesBeforeSend <= NAME_OF_DAY_PREGEN_RAMP_BEFORE_SEND_MINUTES;
  const runAllowed =
    Boolean(opts?.refreshAutoPicks) ||
    Boolean(opts?.forceQueue) ||
    atOrAfterSendTime ||
    inPregenRamp;

  if (!runAllowed) {
    return {
      business_id: businessId,
      skipped: "outside_send_window",
      local_date: localDate,
      local_time: `${hour}:${String(minute).padStart(2, "0")}`,
      configured_send: `${sendHour}:${String(sendMinute).padStart(2, "0")}`,
      fast_exit: true,
    };
  }

  const pregenOnlyThisTick =
    Boolean(inPregenRamp) && !atOrAfterSendTime && !opts?.forceQueue && !opts?.refreshAutoPicks;

  if (pregenOnlyThisTick) {
    const { data: rampPick, error: rampPickErr } = await supabase
      .from("mail_name_of_day_picks")
      .select("girl_normalized, boy_normalized")
      .eq("business_id", businessId)
      .eq("local_date", localDate)
      .maybeSingle();
    if (rampPickErr) throw rampPickErr;
    if (rampPick?.girl_normalized && rampPick?.boy_normalized) {
      return {
        business_id: businessId,
        skipped: "pregen_ramp_pick_already_ready",
        local_date: localDate,
        local_time: `${hour}:${String(minute).padStart(2, "0")}`,
        configured_send: `${sendHour}:${String(sendMinute).padStart(2, "0")}`,
        minutes_before_send: minutesBeforeSend,
        fast_exit: true,
      };
    }
  }

  /**
   * When today’s girl/boy pick already exists, enqueue mail using name-filtered RPCs only
   * (same family as Mail preview). Skips full-pool scan + pregen — stable under large tenants.
   * Forward calendar pregen still runs when this path cannot run (pick missing → heavy path below).
   */
  if (!opts?.refreshAutoPicks && (opts?.forceQueue || atOrAfterSendTime)) {
    const { data: pickFast, error: pickFastErr } = await supabase
      .from("mail_name_of_day_picks")
      .select("girl_normalized, boy_normalized, girl_display_name, boy_display_name")
      .eq("business_id", businessId)
      .eq("local_date", localDate)
      .maybeSingle();
    if (pickFastErr) throw pickFastErr;
    if (pickFast?.girl_normalized && pickFast?.boy_normalized) {
      const gNorm = String(pickFast.girl_normalized);
      const bNorm = String(pickFast.boy_normalized);
      const gDisp = String(pickFast.girl_display_name || "").trim() ||
        gNorm.charAt(0).toUpperCase() + gNorm.slice(1);
      const bDisp = String(pickFast.boy_display_name || "").trim() ||
        bNorm.charAt(0).toUpperCase() + bNorm.slice(1);
      const targetedRows = await loadMatchingMinorsForSendRpc(supabase, businessId, gNorm, bNorm);
      const picksColsFast = await detectMailNodPicksColumnSupport(supabase);
      const schemaLegacyFast = !picksColsFast.pickSource || !picksColsFast.updatedAt;
      const legacyHintFast = schemaLegacyFast
        ? {
          mail_nod_picks_columns: picksColsFast,
          mail_nod_migration_hint:
            "Apply supabase/migrations/20260430120000_name_of_day_pick_source.sql for pick_source + updated_at",
        }
        : {};
      return await enqueueNameOfDaySendsFromRows({
        supabase,
        businessId,
        businessTimeZone: timeZone,
        localDate,
        now,
        girlNorm: gNorm,
        boyNorm: bNorm,
        girlDisplay: gDisp,
        boyDisplay: bDisp,
        winnerRows: targetedRows,
        forceQueue: opts?.forceQueue,
        legacyHint: legacyHintFast,
        pregenForwardDays: 0,
        pregenInserted: 0,
        pregen_reason_counts: {},
        minor_pool_summary: {
          total_rows: 0,
          modern_waiver_participants: 0,
          legacy_waivers_sourced: 0,
          note: "send_used_name_filtered_rpc",
        },
        sendPipeline: "targeted_name_match",
      });
    }
  }

  const pickContext = await loadPickContextFromInventory(supabase, businessId);
  const {
    agg,
    girlNorms,
    boyNorms,
    rankIndex,
    totalDistinct,
    visited,
    rowsByParticipant,
    minor_pool_summary,
  } = pickContext;
  const mailSettingsRow = pickContext.mailSettingsRow;
  const useManualBuckets = pickContext.useManualBuckets;

  if (totalDistinct === 0) {
    return {
      business_id: businessId,
      skipped: "no_minors_in_pool",
      minor_pool_summary,
    };
  }

  if (girlNorms.length === 0 || boyNorms.length === 0) {
    const alertEmail = mailSettingsRow?.name_of_day_alert_email;
    if (useManualBuckets && alertEmail && String(alertEmail).trim()) {
      const { data: bizRow } = await supabase.from("businesses").select("name").eq("id", businessId).maybeSingle();
      await maybeSendManualPoolEmptyAlert({
        supabase,
        supabaseUrl: SUPABASE_URL,
        serviceKey: SUPABASE_SERVICE_ROLE_KEY,
        businessId,
        localDateYmd: localDate,
        alertEmail: String(alertEmail),
        businessName: String(bizRow?.name || "Business"),
        lastAlertSentOn: mailSettingsRow?.name_of_day_last_pool_alert_sent_on,
      });
    }
    return {
      business_id: businessId,
      skipped: "empty_gender_pool",
      minor_pool_summary,
      use_manual_buckets: useManualBuckets,
    };
  }

  let businessNameForAlert: string | null = null;
  async function maybeAlertPickFailure(reason: string | undefined) {
    if (!useManualBuckets || reason !== "empty_gender_pool_or_single_name") return;
    const email = mailSettingsRow?.name_of_day_alert_email;
    if (!email || !String(email).trim()) return;
    if (!businessNameForAlert) {
      const { data: br } = await supabase.from("businesses").select("name").eq("id", businessId).maybeSingle();
      businessNameForAlert = String(br?.name || "Business");
    }
    await maybeSendManualPoolEmptyAlert({
      supabase,
      supabaseUrl: SUPABASE_URL,
      serviceKey: SUPABASE_SERVICE_ROLE_KEY,
      businessId,
      localDateYmd: localDate,
      alertEmail: String(email),
      businessName: businessNameForAlert,
      lastAlertSentOn: mailSettingsRow?.name_of_day_last_pool_alert_sent_on,
    });
  }

  /**
   * Full “wipe and rebuild” (non-UI or legacy caller only). UI fast path does one day at a time and
   * does not delete future rows.
   */
  if (opts?.refreshAutoPicks && !opts?.uiFastRefresh) {
    const todayLocal = localYmdInTimeZone(now, timeZone);
    const { error: delErr } = await supabase
      .from("mail_name_of_day_picks")
      .delete()
      .eq("business_id", businessId)
      .gte("local_date", todayLocal)
      .or("pick_source.eq.auto,pick_source.is.null");
    if (delErr) throw delErr;
  }

  const picksCols = await detectMailNodPicksColumnSupport(supabase);
  const schemaLegacy = !picksCols.pickSource || !picksCols.updatedAt;
  const legacyHint = schemaLegacy
    ? {
      mail_nod_picks_columns: picksCols,
      mail_nod_migration_hint:
        "Apply supabase/migrations/20260430120000_name_of_day_pick_source.sql for pick_source + updated_at",
    }
    : {};

  /**
   * Mail UI button: one request = one calendar day — first open slot from today forward (skip days that
   * already have auto picks or user-edited rows).
   */
  if (opts?.refreshAutoPicks && opts?.uiFastRefresh) {
    const todayLocal = localYmdInTimeZone(now, timeZone);
    const endSearch = addCalendarDays(todayLocal, UI_ONE_DAY_LOOKAHEAD);
    const selectCols = picksCols.pickSource
      ? "local_date, pick_source, girl_normalized, boy_normalized"
      : "local_date, girl_normalized, boy_normalized";
    const { data: existingInRange, error: rangeErr } = await supabase
      .from("mail_name_of_day_picks")
      .select(selectCols)
      .eq("business_id", businessId)
      .gte("local_date", todayLocal)
      .lte("local_date", endSearch);
    if (rangeErr) throw rangeErr;
    const byDate = new Map<
      string,
      { pick_source?: string | null; girl_normalized?: string | null; boy_normalized?: string | null }
    >();
    for (const r of existingInRange || []) {
      const ld = String((r as { local_date: string }).local_date);
      byDate.set(ld, r as { pick_source?: string | null; girl_normalized?: string | null; boy_normalized?: string | null });
    }

    let targetDate: string | null = null;
    for (let i = 0; i <= UI_ONE_DAY_LOOKAHEAD; i++) {
      const d = addCalendarDays(todayLocal, i);
      const row = byDate.get(d);
      if (dayNeedsAutoPregen(row, picksCols.pickSource)) {
        targetDate = d;
        break;
      }
    }

    if (!targetDate) {
      return {
        business_id: businessId,
        refresh_auto_picks: true,
        incremental_one_day: true,
        skipped: "no_open_day_in_lookahead",
        one_day_lookahead: UI_ONE_DAY_LOOKAHEAD,
        minor_pool_summary,
        pick_pipeline: "inventory_snapshot",
        ...legacyHint,
      };
    }

    const r = await tryInsertAutoPickForDate(supabase, {
      businessId,
      targetLocalDate: targetDate,
      agg,
      girlNorms,
      boyNorms,
      rankIndex,
      totalDistinct,
      visited,
      rowsByParticipant,
      profilesRaw,
      dowMap,
      realNow: now,
      picksCols,
    });
    await maybeAlertPickFailure(r.reason);
    const pregenResultsOne = [{ date: targetDate, ...r }];
    return {
      business_id: businessId,
      refresh_auto_picks: true,
      incremental_one_day: true,
      target_local_date: targetDate,
      local_date: localDate,
      local_time: `${hour}:${minute}`,
      pregen_inserted: r.inserted ? 1 : 0,
      pregen_reason_counts: summarizePregenReasons(pregenResultsOne),
      pregen_results: pregenResultsOne,
        minor_pool_summary,
        pick_pipeline: "inventory_snapshot",
        one_day_lookahead: UI_ONE_DAY_LOOKAHEAD,
      ...legacyHint,
    };
  }

  const isCronTick = !opts?.refreshAutoPicks && !opts?.forceQueue;
  const pregenForwardDays = isCronTick ? 0 : PREGEN_FORWARD_DAYS;

  const pregenResults: Record<string, unknown>[] = [];
  if (isCronTick) {
    const todaySelectCols = picksCols.pickSource
      ? "local_date, pick_source, girl_normalized, boy_normalized"
      : "local_date, girl_normalized, boy_normalized";
    const { data: todayRow, error: todayRowErr } = await supabase
      .from("mail_name_of_day_picks")
      .select(todaySelectCols)
      .eq("business_id", businessId)
      .eq("local_date", localDate)
      .maybeSingle();
    if (todayRowErr) throw todayRowErr;
    if (dayNeedsAutoPregen(
      todayRow as { pick_source?: string | null; girl_normalized?: string | null; boy_normalized?: string | null } | null,
      picksCols.pickSource,
    )) {
      const r = await tryInsertAutoPickForDate(supabase, {
        businessId,
        targetLocalDate: localDate,
        agg,
        girlNorms,
        boyNorms,
        rankIndex,
        totalDistinct,
        visited,
        rowsByParticipant,
        profilesRaw,
        dowMap,
        realNow: now,
        picksCols,
      });
      await maybeAlertPickFailure(r.reason);
      pregenResults.push({ date: localDate, ...r });
    }
  } else {
    for (let i = 0; i <= pregenForwardDays; i++) {
      const targetDate = addCalendarDays(localDate, i);
      const r = await tryInsertAutoPickForDate(supabase, {
        businessId,
        targetLocalDate: targetDate,
        agg,
        girlNorms,
        boyNorms,
        rankIndex,
        totalDistinct,
        visited,
        rowsByParticipant,
        profilesRaw,
        dowMap,
        realNow: now,
        picksCols,
      });
      await maybeAlertPickFailure(r.reason);
      pregenResults.push({ date: targetDate, ...r });
    }
  }

  const pregenInserted = pregenResults.filter((x) => (x as { inserted?: boolean }).inserted === true).length;
  const pregen_reason_counts = summarizePregenReasons(pregenResults);

  /** Manual dashboard refresh (full wipe + pregen): only when refreshAutoPicks without uiFastRefresh. */
  if (opts?.refreshAutoPicks) {
    return {
      business_id: businessId,
      refresh_auto_picks: true,
      local_date: localDate,
      local_time: `${hour}:${minute}`,
      pregen_forward_days: pregenForwardDays,
      pregen_inserted: pregenInserted,
      pregen_reason_counts,
      minor_pool_summary,
      ...legacyHint,
    };
  }

  const { data: todayPick, error: pickReadErr } = await supabase
    .from("mail_name_of_day_picks")
    .select("girl_normalized, boy_normalized, girl_display_name, boy_display_name")
    .eq("business_id", businessId)
    .eq("local_date", localDate)
    .maybeSingle();

  if (pickReadErr) throw pickReadErr;
  if (!todayPick?.girl_normalized || !todayPick?.boy_normalized) {
    return {
      business_id: businessId,
      local_date: localDate,
      skipped: "today_pick_missing_after_pregen",
      pregen_sample: pregenResults.slice(0, 5),
      pregen_reason_counts,
      minor_pool_summary,
      ...legacyHint,
    };
  }

  if (!opts?.forceQueue && !atOrAfterSendTime && !opts?.refreshAutoPicks) {
    return {
      business_id: businessId,
      local_date: localDate,
      skipped: "pregen_only_waiting_for_send_window",
      pregen_inserted: pregenInserted,
      pregen_reason_counts,
      minor_pool_summary,
      minutes_before_send: minutesBeforeSend,
      ...legacyHint,
    };
  }

  const girlNorm = String(todayPick.girl_normalized);
  const boyNorm = String(todayPick.boy_normalized);
  const girlDisplay = String(
    todayPick.girl_display_name || displayFromNorm(girlNorm, agg.get(girlNorm)?.displays || []),
  );
  const boyDisplay = String(
    todayPick.boy_display_name || displayFromNorm(boyNorm, agg.get(boyNorm)?.displays || []),
  );

  const winnerRows = await loadMatchingMinorsForSendRpc(supabase, businessId, girlNorm, boyNorm);

  return await enqueueNameOfDaySendsFromRows({
    supabase,
    businessId,
    businessTimeZone: timeZone,
    localDate,
    now,
    girlNorm,
    boyNorm,
    girlDisplay,
    boyDisplay,
    winnerRows,
    forceQueue: opts?.forceQueue,
    legacyHint,
    pregenForwardDays,
    pregenInserted,
    pregen_reason_counts,
    minor_pool_summary,
    sendPipeline: "targeted_name_match",
  });
}

async function runNameInventory(
  supabase: SupabaseClient,
  businessId: string,
): Promise<Record<string, unknown>> {
  const { data: mailSettingsRow, error: mailSettingsErr } = await supabase
    .from("mail_settings")
    .select(
      "max_child_age_for_automations, name_of_day_use_manual_buckets, name_inventory_last_refreshed_at",
    )
    .eq("business_id", businessId)
    .maybeSingle();
  if (mailSettingsErr) throw mailSettingsErr;

  const maxAge = Number(mailSettingsRow?.max_child_age_for_automations ?? 12);

  const { data: snapRaw, error: rpcErr } = await supabase.rpc("mail_name_of_day_inventory_snapshot", {
    p_business_id: businessId,
    p_max_age: Math.floor(maxAge),
  });
  if (rpcErr) throw rpcErr;

  const snap = snapRaw as Record<string, unknown> | null;
  const namesRaw = Array.isArray(snap?.names)
    ? snap!.names as Record<string, unknown>[]
    : [];

  const classMap = await loadManualClassifications(supabase, businessId);

  const inventory = namesRaw.map((row) => {
    const normalized_name = normalizeName(String(row.normalized_name ?? ""));
    const c = classMap.get(normalized_name);
    const sampleRpc = String(row.sample_display ?? "").trim();
    return {
      normalized_name,
      sample_display: displayFromNorm(normalized_name, sampleRpc ? [sampleRpc] : []),
      eligible_minor_count: Number(row.eligible_minor_count ?? 0),
      waiver_distinct_count: Number(row.waiver_distinct_count ?? 0),
      girl_eligible: c?.girl ?? false,
      boy_eligible: c?.boy ?? false,
      classified: Boolean(c && (c.girl || c.boy)),
    };
  });

  const refreshedAt = new Date().toISOString();
  await supabase
    .from("mail_settings")
    .update({ name_inventory_last_refreshed_at: refreshedAt })
    .eq("business_id", businessId);

  return {
    ok: true,
    max_child_age_for_automations: maxAge,
    marketing_eligible_contacts: Number(snap?.marketing_eligible_contacts ?? 0),
    name_of_day_use_manual_buckets: Boolean(mailSettingsRow?.name_of_day_use_manual_buckets),
    pool_rows_before_age_filter: Number(snap?.pool_rows_before_age_filter ?? 0),
    pool_rows_after_age_filter: Number(snap?.pool_rows_after_age_filter ?? 0),
    pool_rows_after_marketing_filter: Number(snap?.pool_rows_after_marketing_filter ?? 0),
    pool_rows_union_raw: snap?.pool_rows_union_raw != null ? Number(snap.pool_rows_union_raw) : undefined,
    name_inventory_last_refreshed_at: refreshedAt,
    previous_name_inventory_last_refreshed_at: mailSettingsRow?.name_inventory_last_refreshed_at ?? null,
    inventory,
  };
}

async function runNameInventoryRecipients(
  supabase: SupabaseClient,
  businessId: string,
  rawNorm: string,
): Promise<Record<string, unknown>> {
  const norm = normalizeName(rawNorm);
  if (!norm) {
    return { ok: true, normalized_name: "", recipients: [], recipient_count: 0 };
  }

  const { data: mailSettingsRow, error: mailSettingsErr } = await supabase
    .from("mail_settings")
    .select("max_child_age_for_automations")
    .eq("business_id", businessId)
    .maybeSingle();
  if (mailSettingsErr) throw mailSettingsErr;

  const maxAge = Number(mailSettingsRow?.max_child_age_for_automations ?? 12);

  const { data: recJson, error: rpcErr } = await supabase.rpc(
    "mail_name_of_day_inventory_recipients_for_name",
    {
      p_business_id: businessId,
      p_max_age: Math.floor(maxAge),
      p_normalized_name: norm,
    },
  );
  if (rpcErr) throw rpcErr;

  const rawList = Array.isArray(recJson) ? recJson : [];

  const recipients = rawList.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      email: String(row.email ?? ""),
      contact_first_name: row.contact_first_name ?? null,
      contact_last_name: row.contact_last_name ?? null,
      minors: Array.isArray(row.minors) ? row.minors : [],
    };
  });

  return {
    ok: true,
    normalized_name: norm,
    recipient_count: recipients.length,
    recipients,
  };
}

function normalizeEmail(e: string) {
  return String(e || "").trim().toLowerCase();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let body: {
    businessId?: string;
    refreshAutoPicks?: boolean;
    forceQueue?: boolean;
    action?: string;
    normalizedName?: string;
  } = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  const singleBusiness = String(body.businessId || "").trim();
  const refreshAutoPicks = Boolean(body.refreshAutoPicks);
  const forceQueue = Boolean(body.forceQueue);
  const action = String(body.action || "").trim();

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const authHeader = req.headers.get("Authorization") || "";
    const isServiceRole = authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
    const cronHeader = req.headers.get("x-name-of-day-secret") || "";
    let secretOk = Boolean(NAME_OF_DAY_CRON_SECRET && cronHeader === NAME_OF_DAY_CRON_SECRET);
    if (!secretOk && cronHeader) {
      const { data: secretRow } = await supabase
        .from("system_runtime_secrets")
        .select("secret_value")
        .eq("key_name", "mail_name_of_day_cron_secret")
        .maybeSingle();
      secretOk = Boolean(secretRow?.secret_value && String(secretRow.secret_value) === cronHeader);
    }

    if (action === "inventory_recipients") {
      const normalizedName = String(body.normalizedName || "").trim();
      if (!singleBusiness) {
        return jsonResponse({ error: "businessId required for inventory_recipients" }, 400);
      }
      if (!normalizedName) {
        return jsonResponse({ error: "normalizedName required" }, 400);
      }
      if (!isServiceRole && !secretOk) {
        const userGate = await authorizeUserForBusiness(req, singleBusiness, supabase);
        if (userGate) return userGate;
      }
      try {
        const payload = await runNameInventoryRecipients(supabase, singleBusiness, normalizedName);
        return jsonResponse(payload);
      } catch (e) {
        return jsonResponse({ error: getErrorMessage(e) }, 500);
      }
    }

    if (action === "inventory") {
      if (!singleBusiness) {
        return jsonResponse({ error: "businessId required for inventory" }, 400);
      }
      if (!isServiceRole && !secretOk) {
        const userGate = await authorizeUserForBusiness(req, singleBusiness, supabase);
        if (userGate) return userGate;
      }
      try {
        const payload = await runNameInventory(supabase, singleBusiness);
        return jsonResponse(payload);
      } catch (e) {
        return jsonResponse({ error: getErrorMessage(e) }, 500);
      }
    }

    if (!isServiceRole && !secretOk) {
      if (!singleBusiness) {
        return jsonResponse({ error: "businessId required for this caller" }, 400);
      }
      const userGate = await authorizeUserForBusiness(req, singleBusiness, supabase);
      if (userGate) return userGate;
    }

    let bizList: { id: string; timezone?: string | null }[] = [];

    if (singleBusiness) {
      const { data: row, error: rowErr } = await supabase
        .from("businesses")
        .select("id,timezone")
        .eq("id", singleBusiness)
        .maybeSingle();
      if (rowErr) throw rowErr;
      if (!row?.id) return jsonResponse({ error: "business_not_found" }, 404);
      bizList = [{ id: row.id, timezone: row.timezone }];
    } else {
      const { data: automationsRows, error: autoQErr } = await supabase
        .from("mail_automations")
        .select("business_id")
        .eq("automation_type", "custom")
        .eq("is_enabled", true)
        .neq("status", "archived");
      if (autoQErr) throw autoQErr;
      const fromAutos = ((automationsRows || []) as { business_id?: string }[])
        .map((x) => String(x.business_id || ""))
        .filter(Boolean);

      const { data: settingsBiz, error: setErr } = await supabase
        .from("mail_name_of_day_settings")
        .select("business_id");
      if (setErr) throw setErr;
      const fromSettings = ((settingsBiz || []) as { business_id?: string }[])
        .map((x) => String(x.business_id || ""))
        .filter(Boolean);

      const { data: allCustomAutos, error: allAutoErr } = await supabase
        .from("mail_automations")
        .select("business_id, criteria")
        .eq("automation_type", "custom")
        .neq("status", "archived");
      if (allAutoErr) throw allAutoErr;
      const fromNodCriteria = ((allCustomAutos || []) as { business_id?: string; criteria?: unknown }[])
        .filter((row) =>
          String((row.criteria && typeof row.criteria === "object"
            ? (row.criteria as Record<string, unknown>).source
            : "") || "") === "name_of_day"
        )
        .map((x) => String(x.business_id || ""))
        .filter(Boolean);

      const ids = [...new Set([...fromAutos, ...fromSettings, ...fromNodCriteria])];
      if (ids.length === 0) {
        return jsonResponse({ processed: [], message: "no_candidate_businesses" });
      }
      const { data: bz, error: bzErr } = await supabase.from("businesses").select("id,timezone").in("id", ids);
      if (bzErr) throw bzErr;
      bizList = (bz || []).map((b) => ({
        id: String(b.id),
        timezone: b.timezone,
      }));
    }

    /**
     * Pick businesses that should receive daily pick pregeneration.
     * Include disabled name-of-day automations so calendar picks populate while the toggle is off.
     * Sending email still requires is_enabled + active campaign inside processBusiness.
     */
    const withNod: typeof bizList = [];
    for (const b of bizList) {
      const { data: autos } = await supabase
        .from("mail_automations")
        .select("id, criteria")
        .eq("business_id", b.id)
        .eq("automation_type", "custom")
        .neq("status", "archived");
      const hasAutomation = (autos || []).some((a) =>
        String((a.criteria as Record<string, unknown>)?.source || "") === "name_of_day"
      );
      const { data: settingsRow } = await supabase
        .from("mail_name_of_day_settings")
        .select("business_id")
        .eq("business_id", b.id)
        .maybeSingle();
      const hasSettings = !!settingsRow?.business_id;
      if (hasAutomation || hasSettings) withNod.push(b);
    }

    const businessesToRun = singleBusiness ? bizList : withNod;

    if (refreshAutoPicks && forceQueue) {
      return jsonResponse({ error: "Use refreshAutoPicks or forceQueue, not both" }, 400);
    }

    /**
     * Dashboard: bypass local send-hour/minute gate and enqueue today’s Name-of-Day emails now (same logic as cron send path).
     */
    if (forceQueue) {
      if (!singleBusiness) {
        return jsonResponse({ error: "businessId required for forceQueue" }, 400);
      }
      if (businessesToRun.length === 0) {
        return jsonResponse({ error: "business_not_found" }, 404);
      }
      const b = businessesToRun[0]!;
      const tz = String(b.timezone || "America/Toronto");
      try {
        const result = await processBusiness(supabase, b.id, tz, new Date(), { forceQueue: true });
        return jsonResponse({ ok: true, results: [result] });
      } catch (e) {
        return jsonResponse({ error: getErrorMessage(e) }, 500);
      }
    }

    /**
     * UI “Regenerate calendar picks”: run synchronously with a capped minor-pool load so the gateway
     * returns 200 with real rows (Edge background tasks were unreliable — requests ended before work finished).
     */
    if (refreshAutoPicks && singleBusiness && businessesToRun.length > 0) {
      const b = businessesToRun[0]!;
      const tz = String(b.timezone || "America/Toronto");
      try {
        const result = await processBusiness(supabase, b.id, tz, new Date(), {
          refreshAutoPicks: true,
          uiFastRefresh: true,
        });
        return jsonResponse({ ok: true, results: [result] });
      } catch (e) {
        return jsonResponse({ error: getErrorMessage(e) }, 500);
      }
    }

    const now = new Date();
    const results: Record<string, unknown>[] = [];
    for (const b of businessesToRun) {
      try {
        const tz = String(b.timezone || "America/Toronto");
        /** Dashboard refresh with `businessId` returns above; cron batch never passes `refreshAutoPicks`. */
        results.push(await processBusiness(supabase, b.id, tz, now, undefined));
      } catch (e) {
        results.push({ business_id: b.id, error: getErrorMessage(e) });
      }
    }

    return jsonResponse({ ok: true, results });
  } catch (e) {
    return jsonResponse({ error: getErrorMessage(e) }, 500);
  }
});
