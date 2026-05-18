---
name: Family Guardian
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#434655'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#006c49'
  on-secondary: '#ffffff'
  secondary-container: '#6cf8bb'
  on-secondary-container: '#00714d'
  tertiary: '#943700'
  on-tertiary: '#ffffff'
  tertiary-container: '#bc4800'
  on-tertiary-container: '#ffede6'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffdbcd'
  tertiary-fixed-dim: '#ffb596'
  on-tertiary-fixed: '#360f00'
  on-tertiary-fixed-variant: '#7d2d00'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-bold:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  container-padding: 20px
  stack-gap-sm: 8px
  stack-gap-md: 16px
  stack-gap-lg: 24px
  gutter: 16px
---

## Brand & Style

The design system is centered on the core values of **protection, reliability, and warmth**. It serves a dual-audience: parents seeking peace of mind and children/teens who require a non-intrusive, friendly interface. 

The visual style is **Soft-Modern**, utilizing a refined evolution of the HIG (Human Interface Guidelines) philosophy. It prioritizes clarity and high legibility while softening the industrial edges typical of security software. The UI should evoke a sense of a "digital safety net"—unobtrusive but always present. Key characteristics include generous negative space, high-contrast action states, and organic, rounded UI elements that feel approachable rather than clinical.

## Colors

The color strategy is designed to communicate status instantly without creating unnecessary anxiety.

- **Primary (Trust Blue):** A deep, vibrant blue used for primary actions, active tracking states, and secure brand moments. It anchors the interface in professionalism.
- **Secondary (Safety Green):** Used for "Safe Zone" confirmations, successful check-ins, and battery-healthy statuses.
- **Accent (Alert Red):** Reserved strictly for SOS triggers, low battery warnings, and "Out of Bounds" notifications. 
- **Neutral (Slate):** A range of cool grays used for secondary text and borders to maintain a clean, breathable environment.
- **Background:** A "Paper White" (off-white) is used to reduce eye strain and provide a softer backdrop for the high-contrast primary elements.

## Typography

The design system utilizes **Inter** for its exceptional legibility and neutral, modern tone. The typographic scale is optimized for mobile-first consumption, where users often glance at information while on the move.

- **Headlines:** Use Bold weights with tight letter-spacing for a strong, authoritative presence.
- **Body Text:** Standardized at 16px for primary information to ensure accessibility for all age groups.
- **Labels:** Used for metadata (e.g., "Last updated 2m ago"). Capitalized labels use increased letter spacing for better scanning.
- **Success/Alert Messaging:** These should always utilize the medium or semi-bold weight to ensure the status is clear.

## Layout & Spacing

This design system follows a **4px base grid** with a fluid layout model optimized for mobile devices. 

- **Margins:** A standard side margin of 20px is used to provide a significant "safe zone," preventing the UI from feeling cramped.
- **Vertical Rhythm:** Components are stacked using 16px (Medium) or 24px (Large) gaps to maintain a clear visual hierarchy.
- **Card Padding:** All cards should utilize a minimum internal padding of 16px to ensure content does not touch the rounded edges.
- **Touch Targets:** No interactive element (button, link, toggle) should be smaller than 44x44px.

## Elevation & Depth

To reinforce the feeling of a "safe" and "tactile" space, this design system uses **Ambient Shadows** and **Tonal Layering**.

- **Level 0 (Surface):** The background color (`#F8FAFC`).
- **Level 1 (Cards):** White surfaces with a soft, diffused shadow (Offset: 0, 4px; Blur: 12px; Opacity: 6% Black). This is the default for member list items and map cards.
- **Level 2 (Active/Floating):** Higher elevation for floating action buttons (FAB) or active modal sheets (Offset: 0, 8px; Blur: 20px; Opacity: 10% Primary Color).
- **Interactions:** When a user presses a card, it should visually "sink" by reducing its shadow blur, providing tactile feedback.

## Shapes

The shape language is consistently **Rounded** to project friendliness and safety.

- **Standard Components:** Buttons, input fields, and small chips use a 0.5rem (8px) radius.
- **Containers:** Content cards and bottom sheets use a 1rem (16px) radius to create a soft, modern container.
- **Avatars:** Family member photos must always be perfectly circular (Pill-shaped) with a 2px Primary Color border when active/moving.
- **Icon Backgrounds:** Small utility icons should be housed in "Squircle" shapes rather than sharp squares.

## Components

- **Primary Buttons:** Solid Trust Blue with white text. High roundedness (1rem). Used for "Add Member" or "Send Check-in."
- **SOS Button:** A specific component with a subtle pulse animation, utilizing Alert Red and Level 2 elevation.
- **Member Cards:** Level 1 elevation cards featuring a left-aligned circular avatar, primary body text for the name, and secondary label text for location status.
- **Status Chips:** Small, pill-shaped indicators. "At Home" (Secondary Green tint), "Moving" (Primary Blue tint), or "Low Battery" (Accent Red tint).
- **Map Markers:** Teardrop shapes with a circular cutout for member photos. High-contrast white border to ensure visibility over complex map textures.
- **Input Fields:** Filled style with a light gray background and a 2px bottom border that turns Primary Blue on focus.
- **Bottom Sheets:** Used for detailed member information; should have a prominent "grabber" handle and 24px top-corner rounding.