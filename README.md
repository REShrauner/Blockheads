# Blockheads

The Blockheads Quilting Bee's calendar and pattern/project repository: hand-coded HTML/CSS/JS, Supabase backend, hosted on GitHub Pages - same setup as Recipe Box and Guild Auction.

## What it does

- **Calendar** - meeting dates with that day's focus lesson/project. Clicking a meeting that's linked to a project jumps straight to that project's materials and instructions.
- **Projects** - an icon-based menu of quilting projects. Each one opens to its own file list (PDFs, Word docs, text files, photos) that members can view or download.
- **Members** - a superuser account (you) and up to a small handful of admins manage meetings, projects, and files, and approve or deny incoming membership requests. General members get read-only access once approved.
- **Request access** - anyone can ask to join from the sign-in screen; they pick their own password on the request form, and it becomes their real login the moment an admin approves them. There's no separate invite-email step.

## One-time setup

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com), sign in (or create a free account), and click **New project**.
2. Give it a name (e.g. "blockheads") and a database password (save this somewhere - it's your project's master password, not something the app needs day to day).
3. Wait a minute or two for it to finish setting up.

### 2. Create the tables and security rules

1. In your new project, open **SQL Editor** in the left sidebar, then **New query**.
2. Open `supabase/schema.sql` from this folder, copy all of it, paste it into the query editor, and click **Run**.
3. You should see "Success. No rows returned" - that means the `profiles`, `membership_requests`, `projects`, and `calendar_events` tables and their security rules were created.

### 3. Create the storage bucket for project files

1. In the left sidebar, go to **Storage**, then **New bucket**.
2. Name it exactly `project-files` and leave it **Private** (not public) - access is controlled by the same security rules as everything else, not by the bucket being public.
3. Back in **SQL Editor > New query**, run the two storage policy statements at the bottom of `supabase/schema.sql` (the ones starting `create policy ... on storage.objects`) if they didn't already run as part of Step 2.

### 4. Deploy the account-approval Edge Function

This is the one piece that needs the Supabase command-line tool rather than just the dashboard, because it's what's allowed to actually create and delete logins.

1. Install the Supabase CLI if you don't already have it (see [supabase.com/docs/guides/cli](https://supabase.com/docs/guides/cli)).
2. From this folder, run:
   ```
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   supabase functions deploy create-user --no-verify-jwt
   ```
   Your project ref is the part of your project URL before `.supabase.co`.
3. In the dashboard, go to **Project Settings > Edge Functions**, open `create-user`, and add one secret: `SUPABASE_SERVICE_ROLE_KEY` set to your project's `service_role` key (found on the **API** settings page). This is the one key that's never safe to put in client-side code - it only lives here, server-side.

### 5. Create your own superuser account

Since there's no one to approve the very first user, create yourself directly:

1. In the left sidebar, go to **Authentication > Users**, then **Add user**. Enter your email and a password, and check **Auto Confirm User** if it's offered.
2. Go to **Table Editor > profiles**, and add a row: `id` = the user id you just created (copy it from the Authentication > Users list), `email` = your email, `display_name` = your name, `role` = `superuser`.
3. That's your login. Everyone else joins through **Request access**; once approved, you can turn any member into an admin from the Members page (**Make admin**), and back again (**Make member**).

### 6. Get your project's API keys

1. Go to **Project Settings > API**.
2. You'll need the **Project URL** and the **anon public** key (not the `service_role` one - that one only ever goes in the Edge Function secret from Step 4, never in client-side code).

### 7. Point the app at your project

1. In the `js` folder, copy `config.example.js` to a new file named `config.js`.
2. Open `config.js` and paste in your Project URL and anon key from Step 6.
3. Unlike a typical app's config, this one gets committed to git along with everything else - see the comment at the top of `config.js` for why that's safe here.

### 8. Try it locally (optional but recommended)

Double-click `index.html` to open it in your browser and sign in with the account from Step 5, just to confirm everything's wired up before you publish it.

### 9. Publish with GitHub Pages

1. Create a new repository on GitHub (e.g. "Blockheads").
2. Using GitHub Desktop, add this folder as that repository and publish/push it.
3. On GitHub.com, go to the repo's **Settings > Pages**, and set it to deploy from your main branch.
4. After a minute, your app will be live at `https://<your-username>.github.io/<repo-name>/`.

## Project structure

```
index.html                             the whole app's markup
css/styles.css                         styling (supports light/dark automatically)
js/config.example.js                   template for your own config.js
js/supabaseClient.js                   sets up the shared Supabase connection
js/app.js                              shared state, navigation, data loading
js/calendar.js                         calendar rendering, month nav, add/edit meeting
js/projects.js                         project grid, file list, upload/download/delete
js/admin.js                            pending requests, member directory, make admin/member
js/auth.js                             sign-in, sign-out, request-access form
supabase/schema.sql                    tables + row-level security rules + storage policies
supabase/functions/create-user/        the Edge Function behind approve / remove
test/                                  a Playwright UI test suite against a mocked backend
```

## Testing

`test/run.js` drives the app end-to-end (superuser, admin, and member roles; account requests; approve/deny; file upload/download/delete) against `test/mock-supabase.js`, a stand-in for the real Supabase client - no live project needed. Useful if you ever want to check a change before deploying it:

```
npm install -g playwright
node test/run.js
```
