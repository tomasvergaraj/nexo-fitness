# Product

## Register

product

## Users

Gym staff and members, multitenant SaaS.

- **Owners / admins**: run the gym day to day, on desktop. Manage memberships, classes, POS, billing, promos, reports. Want speed, clarity, and trust in the numbers.
- **Reception / trainers**: front-desk check-in and class management, often mid-task with a queue at the counter. Need fast, glanceable, low-friction screens.
- **Members**: book classes, check in, track progress, pay, on their phone. Mobile-first; touch targets ≥44px, bottom nav, swipe, light animations.

Job to be done: manage a gym without friction (staff) and stay engaged with training (members).

## Product Purpose

NexoFitness is a multitenant gym-management platform: memberships, class scheduling and check-in, POS, SaaS billing, promos, referrals, reporting. Each tenant gets dynamic per-gym branding (`--gym-brand`) on member-facing storefront/app. Success = staff complete core tasks faster than their old tooling, and members self-serve booking/payment without support.

## Brand Personality

Confident, modern, energetic. Sporty but credible SaaS, not a toy. Motion has momentum and intent; accents are bold but disciplined. Voice is direct and specific (es-CL, Spanish neutral/chileno, no voseo). The product feels like it respects the operator's time.

## Anti-references

- **Generic SaaS template**: hero-metric cards, identical icon+heading+text card grids, gradient text, tiny tracked uppercase eyebrows above every section, numbered section markers.
- **Loud consumer fitness app**: neon everywhere, gamified noise, aggressive gradients, overstimulating motion.
- **Dated enterprise admin**: gray Bootstrap tables, cramped rows, flat hierarchy, 2014-era density.
- **Cluttered dashboards**: widget soup, no breathing room, information overload over a clear primary task per screen.

## Design Principles

1. **One primary task per screen.** The most common action is the loudest thing on the page; everything else recedes.
2. **Respect the operator's time.** Staff screens optimize for speed and glanceability under counter pressure, not decoration.
3. **Mobile-first for members.** Member surfaces are designed thumb-first; desktop is the adaptation, not the source.
4. **Tenant identity carries the color.** The per-gym `--gym-brand` does the branding work; structure and hierarchy stay consistent across tenants.
5. **Motion with intent.** Animation signals state and continuity, never fills silence. Always has a reduced-motion path.

## Accessibility & Inclusion

WCAG 2.1 AA. Body text ≥4.5:1, large text ≥3:1, placeholders held to body contrast (watch muted gray on tinted near-white and on `--gym-brand` tints). Every animation ships a `prefers-reduced-motion: reduce` alternative. Color is never the only signal (color-blind safe); pair with icon/label/shape.
