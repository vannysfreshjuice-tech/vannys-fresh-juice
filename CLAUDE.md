# Vanny's Fresh Juice app

Business app for **Vanny's Fresh Juice** (a juice maker in Kampala; the owner is Vanny), built by Denis Mwanje (MDM) with Claude Code from 12 Nov 2026. It covers the whole business: buying fruit and packaging, making juice in batches, the fridge, counter sales, orders and deliveries, reminders, customers, expenses, staff and wages, reports. Phone first (iPhone or Android not yet known), also works on a laptop.

Built from the lessons of MANSOL Finance (`D:\COMPANY-MANSOL\My kamoney Application`) and Bake Away (`D:\COMPANY-MANSOL\Bake away`, read its CLAUDE.md). The look-and-feel prototype that came first is kept in `public/prototype/` (served at `/prototype/`); the app itself is the Vite project at the root.

## Rules that must not be broken

1. **Figures are worked out, never stored.** Bottles in the fridge, stock on hand, cost per litre, paid, balance, pay status, wages due, profit: all come from the pure functions in `src/lib/juice.ts`, `src/lib/staff.ts` and `src/lib/reports.ts`, computed once in `src/data/DataContext.tsx`. Never add a stored `onHand`, `left`, `paid`, `balance` or `status` field.
2. **Every save goes through `src/data/actions.ts`.** New record = whole (`set`); edit = only its form's fields (`patch`). Things that belong together are one `store.commit([...])`: a sale with its payment, an order with its deposit and reminders, a delete with its payments.
3. **Bottles leave the fridge only in actions, oldest best-before first** (`takeFromFridge`): a counter sale records each line's `batchId`; an order takes its bottles when marked Ready (stored as `packed`), and gives them back when moved to To make or Cancelled. A batch with bottles gone cannot be deleted.
4. **Amounts cleaned once** in the action (`cleanAmount`, `cleanQty`), read with `num()`. Payments above the balance, blank or negative amounts are refused with a plain message.
5. **Forms cannot save twice** (`useSaver`), dates are local `YYYY-MM-DD` (`todayYmd()`, never `toISOString()`), settings store only changed fields (`withDefaults` fills the rest in memory), a failed load is not "no records" (`ready`, `LoadNotice`).
6. **A backup holds every collection** (from `COLLECTIONS` in `src/lib/types.ts`); a new collection goes into `COLLECTIONS` and `Records` and the backup covers it. `tests/saving.test.ts` proves the round trip.
7. **Records others point to are hidden, not deleted** (customers with orders, items in recipes, juices with batches).
8. **Phone first:** 44px touch targets, 16px field text, bottom sheets, no hover-only controls, no `alert()`/`confirm()`. Windows open through `useSheets().open({ t: ... })`; going to another page closes them.
9. **Plain words**, one name for one thing: Sale, Order, Batch, Purchase, Payment, Balance, Write off, Reminder.
10. **Who sees what** is defined once in `src/lib/nav.ts` (`PAGES[].roles`). Roles: owner, production, sales, rider. Until the cloud step, the person is chosen on the device (`WhoSheet`, `vannys.v1.me` in localStorage): that is a convenience, not security.
11. **No secrets in the repo.** The repo is public (GitHub Pages on a free account).
12. **Prove before handing over:** `npm run check`, `npm test`, `npm run build`, then the affected pages in the built-in browser at phone size (375 x 812) and laptop size, figures checked by hand.
13. **Keep the manual current:** `docs/user-manual.md` is the one copy, shown at Help (`src/pages/Manual.tsx`). Every change the user can see updates its chapter, "What's new" and "Last updated" in the same change.

## Facts

- **Stack:** React 19, TypeScript 7 strict, Vite 8, Tailwind 4, React Router 7 (HashRouter), lucide-react, vite-plugin-pwa (prompt to update), Vitest. Same as Bake Away.
- **Records:** for now `src/data/localStore.ts` (localStorage, keys `vannys.v1.<collection>`). The cloud store comes next (see Open work).
- **Collections:** products (juices and cocktails: kind single | cocktail, recipe per 10 L, water, keepsDays, premium), items (stock: kind fruit | packaging), suppliers, purchases (one item each), counts (stock corrections), batches (used, filled by size, bestBefore), sales (counter, lines with batchId, method or 'On credit'), orders (stages To make, Ready, Out for delivery, Delivered, Cancelled; packed, deliveredOn), payments (kind order | sale | purchase), customers, writeOffs, expenses, staff (role, payKind day | month | none), attendance (id `date_staffId`), wages (wage | advance), reminders (date, time, staffId, orderId, repeat, ways calendar | whatsapp, done), readings (fridge temperatures), settings (`main`: sizes with price, premiumPrice, packCost, bottleItemId; perBottle items such as caps and labels; methods, expense groups, fridges, fridgeMax, hygiene checks, bottle deposit).
- **Numbers:** batches B-0001, sales S-0001, orders VJ-0001 (`nextNumber`).
- **Figures:** stock = bought - batch use (recipe lines, plus one bottle of the size's `bottleItemId` and one of each `perBottle` item per bottle filled) + counts. Batch cost uses the **average** purchase cost; recipe cards use the **last** price paid ("today's prices"). Bottle cost = cost per litre x litres + packCost. Report: sold = counter sales by date + orders by `deliveredOn`; profit = sales + delivery fees - cost of bottles sold - expenses - wages and advances - spoiled.
- **Reminders** (Denis, 12 Nov 2026): phone calendar (.ics with a 15-minute alarm, `src/lib/reminders.ts`) and WhatsApp (wa.me link). Saving an order offers ready-ticked reminders (make the day before 06:00, deliver 07:00, collect balance). **Notifications sent by the app are a future addition: do not build them until Denis says so** (he will explain them to Vanny first; they need a server job, e.g. Firebase Cloud Functions + Cloud Messaging on the pay-as-you-go plan).
- **Starter set:** Home and Recipes offer "Add the usual juices, fruit and bottles" (5 single, 7 cocktails, 19 stock items, bottle links) in `actions.addStarterSet()`; never added without the owner asking.
- **Dev test hook:** on `npm run dev` only, `window.__vannys` exposes `{ actions, now }` for test scripts in the browser pane. Never in the published app (`import.meta.env.DEV`). Test records made in the dev server's localStorage are removed when testing ends (Denis, 12 Nov 2026: "remove the test values"); it was left empty.
- **Theme:** orange `#EF8410` accent from the logo, mango yellow, leaf green, straw purple, cream page `#FFF8EE`. Icons made by `npm run icons` from `assets/business-card.jpg`.
- **Preview:** `preview_start` name `vannys-dev` (port 5191; defined in the MANSOL Finance folder's `.claude/launch.json`); the old prototype server is `vannys-prototype` (5190).

## Hosting

- GitHub account **vannysfreshjuice-tech** (Denis signs in, in the Claude browser pane). Repo `vannysfreshjuice-tech/vannys-fresh-juice` (public). This folder's git config: user vannysfreshjuice-tech, email `355815170+vannysfreshjuice-tech@users.noreply.github.com`, credential username set locally. If a push asks to sign in, use Git Credential Manager's **Sign in with a code** at github.com/login/device in the pane.
- **Live (12 Nov 2026): the app** at https://vannysfreshjuice-tech.github.io/vannys-fresh-juice/, published by `.github/workflows/deploy.yml` (Pages source = GitHub Actions; every push to main is type-checked, tested and built, then published). The prototype stays at `/prototype/`. The published app keeps records on each device until the cloud step. Ask Denis before each deploy.

## Open work

1. **Cloud and PIN sign-in (Denis chose "PIN, records shared", 12 Nov 2026):** Firebase Auth + Firestore like Bake Away, set up once together with Denis in the browser pane on the business's Google account. Unlike Bake Away there is **one sign-in per person** (owner, production, sales, rider), each PIN being that person's server-checked password, and `firestore.rules` must give everyone the shared business records (e.g. `businesses/vannys/{collection}`) with the role checked for sensitive pages; the role should come from the server (custom claims or a `members/{uid}` record writable only by the owner), not from the device. Never a browser-only PIN with cloud records.
2. Owner's real details (README questions): real juices, cocktails, recipes, sizes and prices; iPhone or Android; returnable bottles.
3. Ideas not built: empty-bottle balance per customer (sales record `emptiesBack` already), printed receipts, product photos, PDF report file (print to PDF works now).
