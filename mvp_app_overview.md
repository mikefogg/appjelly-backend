# MVP App Overview

# 🧸 SnuggleBug Stories – Platform Overview

[Technical Overview](https://www.notion.so/Technical-Overview-1f95ec016e89805c9cbfd9a911c16508?pvs=21)

## 1. Overview

**SnuggleBug Stories** is a mobile app that uses AI to create personalized bedtime stories for children, based on their interests, photos, and daily activities. Parents can generate stories starring their children, add siblings, friends, pets, or family members, and even share these stories with other parents — who can reimagine the same adventure from their own child’s perspective.

Stories are beautifully written and optionally illustrated with **AI-generated images** that bring your child’s imagination to life. All stories are saved in automatically synced family libraries that grow with every shared tale.

---

## 2. 💸 Pricing

| Plan | Price | Notes |
| --- | --- | --- |
| Weekly | $1.99/week | Low-friction entry, but higher churn |
| Monthly | $5.99/month | Mid-tier recurring option |
| Yearly | $29.99/year | **Best value** with 3-day free trial |
- 🧪 **Trial**: 3-day free trial is offered with the Yearly plan.
- 📖 Free viewers can read shared stories fully, but must subscribe to create their own.
- 🌟 *In-app: “Best Value” badge will highlight the Yearly option.*

---

## 3. 📄 Page Explanations

- **Welcome** – Branded intro screen with a "Create Your Story" CTA.
- **Sample Story** – Shows an example story to preview the experience.
- **Your Kids** – Manage multiple kid profiles, each with photos and interests.
- **Kid Details** – Add a new child, upload up to 10 photos to train appearance/personality.
- **Additional Characters** – Add friends, family, pets for inclusion in stories.
- **Story Library** – Main hub showing saved stories and stories your children appear in.
- **Create Story** – Start the creation flow by entering a prompt and selecting characters.
- **Story Page 1** – View the first page for free, with a “Continue” CTA.
- **Paywall** – Triggered to unlock the full story and subscribe.*→ Soft-locked after page 1 to maximize conversion without sacrificing experience.*
- **Story Complete** – Full story view (text first, images load after).
- **Image Ready** – View fully illustrated version when images finish generating.
- **Invite Friend** – Share a story with another parent.
- **Shared Story View** – A parent can view a story starring someone else’s child.
- **Repersonalize** – Claim a character and regenerate the story for their own child.

---

## 4. 🧭 Page Flow

1. Welcome → “Create Your Story”
2. Sample Story
3. Your Kids
4. Kid Details (Add Ava, Ella, etc.)
5. Additional Characters (Josh, Grandma, etc.)
6. Story Library
7. Tap “Create Story”
8. Bottom Sheet:
    - Prompt + Length
    - Confirm Characters
    - Loading
9. View Story Page 1
10. Hit paywall → Subscribe
11. Full Story Text View
12. Image View (when ready)
13. Share Story
14. Others view & re-personalize

---

## 5. 🔗 Sharing & Permissions

SnuggleBug Stories is built around a trusted, privacy-preserving network of families who can share and co-create stories involving their kids, relatives, and friends — **without ever exposing sensitive personal information**.

> SnuggleBug trusts parents to build small, private networks of co-creators.
> 

---

### 🧾 What Can Be Shared?

| Data | Shared? | Notes |
| --- | --- | --- |
| Name | ✅ Yes | Always shared when a child appears in a story |
| Nickname | ❌ No | Local-only, never used in stories or shared |
| Photos | ✅ View-only (linked families only) | Only shown when a child is a claimed character, in-story |
| Interests / Personality | ❌ No | Private to the owning parent |
| Story Appearance | ✅ Yes | Stories sync across trusted families |
| Profile Edit Access | ❌ No | Only the original parent can edit a child’s profile |

> Claiming a character does not notify the original parent — it's a silent link.
> 

---

### 🔄 Story Sharing Flow

1. A parent creates a story starring their child and includes other characters (friends, family).
2. They share a read-only link (or QR) with other parents (e.g., in a group chat).
3. Recipients can:
    - View the full story for free
    - Tap to view the story from another character’s perspective
    - Set up their own child if not yet claimed
4. Upon claiming a character:
    - The new parent is auto-linked to **all other claimed families in the story**
    - Future stories sync automatically between them

---

### 👨‍👩‍👧 Trusted Families

**Trusted Families** are account-to-account links that allow:

- Automatic syncing of shared stories
- Access to each other's **claimed kids by name only**
- Use of each other's kids in future stories (with no manual re-entry)

**How Families Become Linked:**

- A parent claims a child via a shared story → auto-link to all other claimed families in that story
- A parent shares a **link or QR code** explicitly to connect families

**How to Unlink:**

- Parents can manage and remove Trusted Family connections at any time from Settings

---

### 📚 Auto-Synced Libraries

Each parent sees two story libraries:

| Library | Contains |
| --- | --- |
| **My Stories** | Stories where their own child is the main character |
| **Stories I'm In** | Stories where their child appears as a side character (from linked families) |

> You’ll never lose a story — everything is backed up and shared instantly between trusted families.
> 

---

### 🏷️ Character Nicknames

To manage similar names (e.g., multiple Joshes), parents can assign **private nicknames**.

- **Examples**:
    - “Josh (Soccer)”
    - “Josh (Cousin)”
- Used only in your app for selection and disambiguation
- **Never shown to others**
- **Never used in story generation**
- The actual `name` field is always what appears in the story

---

### 🧠 Local Characters vs. Linked Characters

| State | Editable by You | Re-usable by You | Has Images | Syncs Stories |
| --- | --- | --- | --- | --- |
| Placeholder (local) | ✅ Yes | ✅ Yes | ✅ Yours (if uploaded) | ❌ No |
| Claimed (unlinked) | ❌ No | ❌ No | ❌ No | ❌ No |
| Linked (claimed) | ❌ No | ✅ Yes | ✅ From owner | ✅ Yes |

> When a character you've created is later claimed by their real parent and linked, your version is automatically replaced with theirs.
> 
> 
> Your nickname remains visible only to you, but their name and photo take over for display and generation.
> 

---

## 6. ✨ Story Creation Flow

### Bottom Sheet Structure (3 screens):

1. **Prompt + Length**
    - Enter optional prompt
    - Select length: Short / Medium / Long
    - Tap “Next”
2. **Confirm Characters**
    - Characters inferred from prompt
    - Auto-link any known profiles (e.g., “Josh” if already linked)
    - Add/remove others (e.g., Grandma, Max the dog)
    - Assign optional types or relationships
3. **Loading Screen**
    - While generating page 1
    - Show animation or avatar carousel
    - Ends on Page 1 screen

---

### 🤖 Smart Behaviors

- Inference API: Detects names in prompt and matches to known characters
- Placeholders are used for new characters (e.g. “Otto”)
- Once a character is claimed (e.g. Otto’s mom signs up), future stories sync automatically
- If a name matches multiple characters (e.g. two Joshes), you’ll be prompted to choose

---

## 7. 💡 Bonus Notes

- Characters can be **kids, adults, pets, or imaginary** — not limited to children
- All stories are **view-only in-app** — no downloads
- Parents can manage permissions and linked families in Settings
- “Stories I’m In” auto-populates from all Trusted Families