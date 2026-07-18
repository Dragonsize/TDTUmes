# TDTU Messenger

Real-time classroom chat using Node.js, Express, WebSockets, and Supabase PostgreSQL.

## Run

```bash
npm install
DATABASE_URL='postgresql://...' npm start
```

Render environment variables:

```text
DATABASE_URL=<Supabase Postgres connection URI>
RESUME_TOKEN_SECRET=<random stable secret>
```

Generate secret once:

```bash
openssl rand -base64 32
```

Keep both values server-side. Do not put them in browser code or Git. `RESUME_TOKEN_SECRET` must stay unchanged across deploys, or users need to login again after restart.

## Supabase schema

New database only:

```bash
supabase db push
```

Or run `supabase/migrations/001_initial_schema_image_uploads_and_admin.sql` in Supabase SQL Editor. It creates accounts, active/archive chat tables, image metadata, and test admin account.

## Test admin

```text
Username: test1
Password: test1
```

Known public credential. Test deployment only. Anyone knowing it can use admin commands.

## Images

- PNG, JPEG, GIF, WebP only
- Maximum 5 MiB
- Image files save temporarily under Render `public/uploads/`
- Images auto-delete after 30 days
- Deploy/restart can remove image files earlier; message/caption remains and shows expired state
- `/remove <id>` deletes image file and clears image link. Message/caption stays.

## Commands

```text
/tdtu
/rainbow
/note [text]
/profile
/whois <user>
/dm <user> <message>
/users
/ping
/cls
/?
```

Admin only:

```text
/theme <default|purple|blue|red>
/title <text>
/db
/remove <image message id>
/archive
```

## Verify

```bash
npm test
node --check server.js
```
