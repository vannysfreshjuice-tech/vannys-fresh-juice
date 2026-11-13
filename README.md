# Vanny's Fresh Juice - business app

An app for Vanny's Fresh Juice that covers the whole business: buying fruit, making juice, the fridge, selling, deliveries, money and staff. Started 12 Nov 2026 from the lessons of MANSOL Finance and Bake Away.

**Stage now (12 Nov 2026): live at https://vannysfreshjuice-tech.github.io/vannys-fresh-juice/**. Cloud records (Firebase project `vanny-s-fresh-juice`) with a sign-in and PIN per person are built and tested on the local emulators; the published app moves to them with the next deploy. The rules for working on it are in `CLAUDE.md`; the user manual is `docs/user-manual.md` (shown in the app at Help).

## Work on the app

```bash
npm install
npm run dev      # http://localhost:5191 (records in this browser only)
npm run check    # type check
npm test         # money, stock and saving rules (tests/)
npm run build    # production build into dist/
npm run icons    # remake the icons from assets/business-card.jpg
```

In the Claude app: `preview_start` name `vannys-dev`.

## The prototype (the look agreed first)

- Kept in `public/prototype/`; served at `/prototype/` by the app's build, or alone with `preview_start` name `vannys-prototype` (http://localhost:5190).
- Live at https://vannysfreshjuice-tech.github.io/vannys-fresh-juice/prototype/ (the app itself is at the site's main address, published by the GitHub Actions workflow on every push to main).
- Screenshots: `screenshots/`.

## The parts of the app (as in the prototype; the app follows it)

| Part | What it does |
|---|---|
| **Home** | Today's sales and money in (cash vs mobile money), litres made, bottles in the fridge, what customers owe, and a "needs attention" list: fruit running low, juice near its best-before, bottles to reorder, orders not yet made, fridge too warm. Today's production plan, the week's sales and today's best sellers. |
| **Sell** | Counter sales on a phone, single-fruit juices and juice cocktails in two groups: tap flavour and size, take payment (Cash, MTN MoMo, Airtel Money, on credit), change worked out, receipt to send on WhatsApp. Bottles come off the oldest batch first. Works in the prototype (it is the one screen that changes stock live). |
| **Orders and deliveries** | Orders from shops, schools, offices, canteens and events. Steps: To make, Ready, Out for delivery, Delivered. Deposits and payments, balances, rider, delivery note on WhatsApp, empty bottles held by each customer. |
| **Reminders** | Make the juice for a pre-order the day before, deliver, collect a balance, buy fruit, pay wages, read the fridge. Made automatically when an order is saved, or by hand (+ > Reminder, or Remind me on an order). Each reaches the phone as an app notification, a phone-calendar entry with an alarm (a real .ics file, works on iPhone and Android, no server needed), or a WhatsApp message to the person. Each person sees their own. |
| **Production** | Batches (B-0001...): flavour, litres, bottles filled by size, who made it, best-before date, hygiene checklist, cost of the batch and cost per litre. "What to make for tomorrow" from the orders and what is in the fridge. New batch works out the fruit, sugar and bottles needed and warns when stock is short. |
| **Recipes and prices** | 5 single-fruit juices and 7 juice cocktails (Tropical Sunrise, Mango Passion, Pineapple Ginger Zing, Watermelon Mint Cooler, Orange Carrot Glow, Beetroot Power, Green Fresh). Each recipe per 10 litres, cost per litre from the latest fruit prices, and for each bottle size: cost, price, profit and margin. **New cocktail** tries a mix and shows its cost and margin as you type. |
| **Stock** | Juice in the fridge (by flavour and size, and by batch with days left), fruit and ingredients, bottles and packaging with reorder levels, fridge temperature readings, empty bottles out with customers. Write off spoiled juice. |
| **Buying and suppliers** | Purchases of fruit, sugar and packaging, what is owed to each supplier, fruit quality, and the price of mangoes week by week (season tracking). |
| **Customers** | Shops, schools, offices, events, canteens: orders, balance, empty bottles, statement on WhatsApp. |
| **Expenses** | Running costs only (rent, power, water, gas, transport, repairs, cleaning, dues), by group, with an optional photo of the receipt. |
| **Staff and wages** | Attendance Mon to Sat, daily and monthly pay, advances, wages due. Each person gets their own PIN and sees only their part. |
| **Reports** | Profit for a period (sales - fruit and bottles used - expenses - wages - spoiled juice), profit by flavour, how customers paid, where sales came from. PDF and Excel. |
| **Help (user manual)** | Shows `prototype/user-manual.md` (the one copy of the manual) with a contents list. Every change the user can see updates the manual and its "What's new" in the same change. |
| **Settings** | Business details from the card (+256 785 965536, +256 751 349633), sizes and prices, premium flavours, bottle deposit, people and access, days each flavour keeps, fridge range, backup. |

## Questions for Vanessa before we build

1. Bottle sizes and prices actually sold? Are some flavours priced higher (the prototype treats orange as premium)?
2. Real recipes: how much fruit, sugar and water makes 10 litres of each flavour? How many days does each keep in the fridge?
3. Who will use it: just Vanessa, or also staff (production, counter, rider)? Should staff see money and profit?
4. Phones: iPhone or Android? (Decides how it is installed.)
5. Sell at a counter, deliver to shops, events, or all three? Credit customers?
6. Returnable bottles with a deposit, or one-way bottles?
7. Mobile money: MTN, Airtel, both? A merchant code to print on receipts?
8. Daily or monthly workers, paid weekly or monthly, advances?
9. Which juice cocktails does Vanessa actually sell, and what goes into each?
10. Who needs reminders, and how: phone notification, calendar, WhatsApp?
11. Anything the paper books track today that is missing here?

## Note on phone notifications

Calendar reminders and WhatsApp messages need no server. Notifications sent by the app at a set time when the app is closed need a small server job (for example Firebase Cloud Functions with Cloud Messaging, which needs Firebase's pay-as-you-go plan and a card; light use stays within the free allowance). On iPhone they also need the app on the Home Screen (iOS 16.4 or later).

## When we build it (after the prototype is agreed)

Same base as Bake Away: React + TypeScript + Vite + Tailwind, installable phone app (PWA), Firebase sign-in behind a server-checked PIN, records in Firestore with an offline copy, GitHub Pages. Same rules: figures worked out from records, never stored; every save through one place; whole-shilling amounts; local dates; backups that hold everything; plain words; tested at phone and laptop size before handing over. Credentials (GitHub, Google / Firebase account for the business) still to come.
