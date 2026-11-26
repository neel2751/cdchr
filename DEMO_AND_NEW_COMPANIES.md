# Demo companies, and creating companies for customers

## 1. The demo login (for showing customers)

One email runs four made-up companies, one per type of business. In the
sidebar you switch between them and each speaks its own language (sites /
branches / classes):

| Company | Type | Shows |
|---|---|---|
| Northgate Construction | Construction | 4 sites, ~26 site workers, daily assignments, CIS pay, managers per site |
| The Olive Table | Restaurant | 3 London branches, agency staff, branch managers |
| The Olive Table Manchester | Restaurant | the same owner's second company, on the same bill at the extra-company price |
| Bright Minds Tuition | Tuition | 4 classes, 30 students with guardians, school and year group, weekly enrolments |

Each has office staff and departments, two weeks of attendance up to **today**
(people in now, on a break, gone home), leave balances, approved/pending
requests, announcements, a package on Plan & Billing, and:

* **Weekly rota:** last week, this week and next, plus the shift types (see section 4).
* **Policies:** a library with published policies and who has read and acknowledged them.
* **Change requests:** staff asking HR to change their name, email or date of birth.
* **Reception desk:** a front-desk login and a visitor book (construction and
  tuition; a restaurant has no visitor log).
* **Expenses:** claims against each site, branch or class, with receipts.
* **Documents:** each office employee's contract, right-to-work check, ID and certificate.
* **Media management:** the documents and receipts, plus a small company library.
* **A leaver:** someone on Previous Office Staff.

The documents, policies and receipts are small sample PDFs marked "SAMPLE
DOCUMENT". They're stored in each demo company's own folder of your storage
bucket, so they open like real ones. Without storage set up, or with
`--no-files`, they're listed but won't open.

**They are view-only.** Anyone can look at everything; nothing can be added,
changed, clocked or paid. They are never billed and send no emails. The demo
login skips the two-factor setup, but only while every company it can reach
is a demo.

### Put it on the server

On the server, in the app's folder (the one with `.env` and `server.mjs`):

```bash
git pull                       # get scripts/seed-demo.mjs
node -v                        # needs 22 or newer (same as the app)

# 1. See what it would do — writes nothing
npm run demo:seed

# 2. Create it
npm run demo:seed -- --apply --email=demo@yourcompany.co.uk --password='Pick-A-Good-One-1'
```

It prints the sign-in email, the password, and each company's address. Use an
email that **only the demo uses**. The script refuses an email that belongs to
a real account, and an address a real company holds. Leave out `--password`
and it makes a random one and prints it once.

Then sign in at your normal login page with that email and password.

### Keep it fresh

The attendance is dated from the day you run it, so after a few days "today"
is empty. Before a demo, run the same `--apply` command again. It rebuilds the
sample data and keeps the same companies, addresses and login. To keep it
fresh every day, add a crontab line on the server:

```cron
0 5 * * * cd /path/to/app && npm run demo:seed -- --apply --email=demo@yourcompany.co.uk --password='Pick-A-Good-One-1' >> /tmp/demo-seed.log 2>&1
```

### Change or remove it

* **To change something by hand:** on Platform → the company → Access, turn
  **Demo company** off, make your changes, then turn it back on. (Or run with
  `--editable`.) Running `--apply` again throws hand changes away.
* **To remove everything:** `npm run demo:seed -- --remove`. That deletes the
  four companies, every record in them, and their sample files.

## 2. Creating a company from the platform console

Platform → **New company** now asks what the register page asks:

* **Company:** name, workspace address (checked as you type), type of
  business (sets the words and the modules), and an optional description.
* **Who runs it:**
  * **Someone new:** name, email, phone, and a password (optional).
    * Leave the password empty: they are emailed a link to choose their own.
      If the email can't be sent, they use "Forgot password".
    * Set one (or press **Generate**): give it to them. They must choose a
      new one the first time they sign in.
  * **Someone who already has a company:** type their email and press
    **Find**. You see their companies. They sign in with the same email and
    password as now, and switch company from the sidebar. Tick **Put it on
    the same bill** to make it the extra company on their account (cheaper
    package fee).
* **Start:** a free trial (any length; empty means the standard length from
  the Pricing page), or **Paying from today**. Then set the package on its
  Price tab.

### Another company for an existing customer

Open any company in Platform. **New company for this owner** at the top opens
the same form with that company's owner already filled in.

## 3. How to check it

1. Platform → **New company** → *Someone new*, with your own second email and
   no password. You get a "choose your password" email. Set it, sign in, and
   you are the super admin of that company, with the two-factor setup as
   normal.
2. On that company's page → **New company for this owner** → *Bill together*
   ticked → create. Sign in again as that person: the sidebar switcher lists
   both companies. Platform → Accounts shows them on one account, the second
   marked as the extra company.
3. Demo: sign in with the demo login. There's no two-factor prompt, you land
   in Northgate Construction, and a blue banner says it's a demo. Switch to
   each company. Try to add an employee or change the branding: it is refused.

## 4. Shift types (weekly rota categories)

The choices on the weekly rota used to be fixed words: "OFF", "OFFICE" and
"OFFICE/SITE" were wired into the screens. Now each one is a **shift type** with
a rule:

| Rule | On the rota |
|---|---|
| Working | start and end time |
| Working at a site / branch / class | times, and which one (in the company's own words) |
| Not working | no hours |

Each can also have usual hours, filled in when it's chosen.

* **New companies** get the usual set in their own words: *Office*,
  *Office / Site* (or *Office / Branch*, *Office / Class*) and *Off*. Their setup
  checklist has a "Check your shift types" step.
* **Existing companies** keep their categories. The old ones still behave as
  before, and a category they added themselves counts as "Working".
* **To change them:** Weekly Rota → **Shift types**. Add (e.g. *Teaching a
  class*, working at a class, 16:00–18:00), rename, change the rule, or remove.
  **Use the usual set** adds any of the standard three that are missing.
* **Rotas already saved don't change** when a shift type is renamed or
  removed. Each saved day keeps the name and rule it had.
