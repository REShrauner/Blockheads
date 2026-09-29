// Blockheads - create-user Edge Function
//
// Same pattern as the Guild Auction app's create-user function: this runs
// with the service-role key (never exposed to the browser) so it can create
// and delete real logins, something the client-side anon key can never do.
// Deploy with `--no-verify-jwt` (same as Auction App) since the caller may
// be approving a brand-new person who has no session yet in some flows -
// this function does its OWN authorization check below instead, by reading
// the caller's access token out of the request body and looking up their
// role, which is one step more than Auction App's version does.
//
// Deploy: supabase functions deploy create-user --no-verify-jwt
// Secrets it needs (Supabase sets SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// automatically for every Edge Function - nothing to configure by hand):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { action, callerToken } = body as { action?: string; callerToken?: string };

  if (!callerToken) {
    return json({ error: "Missing callerToken - you must be signed in to do this" }, 401);
  }

  // Who is calling, and what role do they actually have (looked up
  // server-side with the service key, never trusting anything the client
  // claims about itself)?
  const { data: callerAuth, error: callerAuthError } = await admin.auth.getUser(callerToken);
  if (callerAuthError || !callerAuth?.user) {
    return json({ error: "Your session has expired - sign in again and retry" }, 401);
  }
  const { data: callerProfile, error: callerProfileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", callerAuth.user.id)
    .single();
  if (callerProfileError || !callerProfile) {
    return json({ error: "Could not verify your account" }, 403);
  }
  const callerRole = callerProfile.role as string;
  if (callerRole !== "admin" && callerRole !== "superuser") {
    return json({ error: "Only an admin or the superuser can do this" }, 403);
  }

  // ---- Approve a pending membership request -------------------------------
  if (action === "approve") {
    const { requestId, role } = body as { requestId?: string; role?: string };
    if (!requestId) return json({ error: "Missing requestId" }, 400);

    const wantedRole = role === "admin" ? "admin" : "member";
    if (wantedRole === "admin" && callerRole !== "superuser") {
      return json({ error: "Only the superuser can approve someone as an admin" }, 403);
    }

    const { data: reqRow, error: reqError } = await admin
      .from("membership_requests")
      .select("*")
      .eq("id", requestId)
      .eq("status", "pending")
      .single();
    if (reqError || !reqRow) {
      return json({ error: "That request is no longer pending" }, 404);
    }
    if (!reqRow.password || String(reqRow.password).length < 8) {
      return json({ error: "That request has no valid password on file" }, 400);
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: reqRow.email,
      password: reqRow.password,
      email_confirm: true,
    });
    if (createError || !created?.user) {
      return json({ error: createError?.message || "Could not create the login" }, 500);
    }

    const { error: profileError } = await admin.from("profiles").insert({
      id: created.user.id,
      email: reqRow.email,
      display_name: reqRow.name,
      role: wantedRole,
    });
    if (profileError) {
      // Roll back the auth user so we don't leave an orphaned login with no profile
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: profileError.message }, 500);
    }

    // Delete the request outright rather than just marking it approved -
    // its password column holds their chosen password in plain text until
    // this point (same as the Guild Auction app's account_requests table),
    // so the fewer places and the less time that sits around, the better.
    await admin.from("membership_requests").delete().eq("id", requestId);

    return json({ ok: true, userId: created.user.id });
  }

  // ---- Create an admin directly (superuser only, no request needed) -------
  if (action === "createAdmin") {
    if (callerRole !== "superuser") {
      return json({ error: "Only the superuser can create an admin account" }, 403);
    }
    const { name, email, password } = body as { name?: string; email?: string; password?: string };
    if (!name || !email || !password || password.length < 8) {
      return json({ error: "Name, email, and an 8+ character password are all required" }, 400);
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created?.user) {
      return json({ error: createError?.message || "Could not create the login" }, 500);
    }

    const { error: profileError } = await admin.from("profiles").insert({
      id: created.user.id,
      email,
      display_name: name,
      role: "admin",
    });
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: profileError.message }, 500);
    }

    return json({ ok: true, userId: created.user.id });
  }

  // ---- Delete a member's login (removing their profile too, via cascade) --
  if (action === "delete") {
    const { userId } = body as { userId?: string };
    if (!userId) return json({ error: "Missing userId" }, 400);
    if (userId === callerAuth.user.id) {
      return json({ error: "You can't delete your own account this way" }, 400);
    }

    const { data: targetProfile } = await admin.from("profiles").select("role").eq("id", userId).single();
    if (targetProfile && targetProfile.role !== "member" && callerRole !== "superuser") {
      return json({ error: "Only the superuser can remove an admin or superuser account" }, 403);
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) return json({ error: deleteError.message }, 500);

    return json({ ok: true });
  }

  return json({ error: `Unknown action: ${String(action)}` }, 400);
});
