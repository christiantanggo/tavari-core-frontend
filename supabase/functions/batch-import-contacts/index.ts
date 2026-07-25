import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = Deno.env.toObject();
const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

type Payload = {
  contacts: Array<{
    email: string;
    firstName?: string;
    lastName?: string;
    source?: string;
  }>;
};

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const payload = (await req.json()) as Payload;

    if (!payload.contacts || payload.contacts.length === 0) {
      return new Response("No contacts provided", { status: 400 });
    }

    const rows = payload.contacts.map((contact) => ({
      email: contact.email.toLowerCase().trim(),
      first_name: contact.firstName || null,
      last_name: contact.lastName || null,
      source: contact.source || "brevo-warmup",
      engagement_score: 5,
      engaged_recently: true,
      last_engaged_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));

    const { error } = await supabase.from("mail_contacts").upsert(rows, {
      onConflict: "email"
    });

    if (error) {
      console.error("Upsert error:", error);
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ ok: true, inserted: rows.length }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
});


