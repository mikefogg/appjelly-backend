/**
 * Twitter Growth Rules
 * These rules are ALWAYS included in AI prompts to ensure generated content
 * follows best practices for Twitter/X algorithm performance
 */

export const TWITTER_GROWTH_RULES = `
# Twitter Growth Rules - ALWAYS Follow These

## Core Algorithm Rules
- **Never start a post with "@"** — replies or mentions at the start limit reach
- **First line = hook** — The first 1-2 lines decide if people expand; never waste them
- **No links in the main tweet** — Links kill reach; put them in replies or use an image CTA
- **Avoid hashtags** — One max, or none. They leak traffic away
- **Use line breaks** — Never create walls of text. Break up your content visually
- **Don't use weak threads** — Avoid threads under 5 tweets unless each one is strong

## Style & Readability Rules
- **Write like you talk** — Conversational > corporate
- **Use short sentences** — 1 idea per line. No fluff
- **Avoid jargon** — Unless your audience uses it. Simpler = wider reach
- **AVOID EMOJIS** — Only use them where EXTREMELY relevant. Most tweets should have ZERO emojis. Never use them decoratively
- **Every tweet should add value** — Value, emotion, or identity. No filler content
- **Don't hedge** — Avoid "maybe," "might," "could" — they weaken engagement
- **Make bold claims** — Then prove them. Confidence performs
- **Shape tweets visually** — Stagger short/long lines for rhythm and skimmability

## Content Mix Rules
- **Show wins AND process** — Not just outcomes. People love the "in-progress" journey
- **Ask easy-to-answer questions** — One-line replies = more comments
- **Use visuals powerfully** — Screenshots, charts, or visuals sparingly but with impact

## Conversion & Growth Rules
- **Don't ask for engagement directly** — "Retweet this" feels needy; frame it as value
- **Use "Follow for…" naturally** — Occasionally but authentically
- **End with a clean takeaway** — Or a subtle CTA. Keep people in your loop

## Format Guidelines
- Use line breaks for readability
- Keep paragraphs to 2-3 lines max
- Use bullets (•) or numbers for lists
- Create visual hierarchy with spacing
- Write for skimmers — most people scroll fast

## What to Avoid
- Don't start with boring openings like "I think" or "Just wanted to share"
- Don't use corporate speak or buzzwords
- Don't write walls of text without breaks
- Don't use multiple hashtags
- Don't ask "What do you think?" at the end (it's lazy engagement bait)

## CRITICAL: Never Sound Like AI
**Banned AI phrases (NEVER use these):**
- "Picture this:", "Here's the thing:", "Let's dive in", "Let's unpack"
- "Stay tuned", "Stay keen", "Eyes on the prize"
- "In today's world", "At the end of the day"
- Any phrase ending in "folks", "friends", or "y'all" (unless it's genuinely their voice)
- "Buckle up", "Strap in", "Hold on tight"
- "Game changer", "Next level", "Cutting edge"

**Banned writing patterns:**
- Metaphors like "legal tango", "wild ride", "roller coaster"
- Buzzwords like "ecosystem", "landscape", "dynamics", "paradigm"
- Generic observations without a specific take
- Describing something happening without saying what YOU think
- Ending with vague statements like "Time will tell" or "We'll see how this plays out"

**Write like a REAL person:**
- Have an actual opinion, not just commentary
- Be specific, not general
- Skip the setup, get to the point
- Sound like you'd say it out loud to a friend
- If it sounds like a LinkedIn post, rewrite it
- NEVER use numbered lists with bold headings (e.g. "1. **Point One**:") - that's LinkedIn, not Twitter
- NEVER write like you're teaching a course or giving a presentation
- Write raw thoughts, not polished articles
`;

export default TWITTER_GROWTH_RULES;
