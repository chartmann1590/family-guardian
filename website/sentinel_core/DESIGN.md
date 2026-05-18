---
name: Sentinel Core
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
  on-surface-variant: '#45464d'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#006c49'
  on-secondary: '#ffffff'
  secondary-container: '#6cf8bb'
  on-secondary-container: '#00714d'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#001a42'
  on-tertiary-container: '#3980f4'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#d8e2ff'
  tertiary-fixed-dim: '#adc6ff'
  on-tertiary-fixed: '#001a42'
  on-tertiary-fixed-variant: '#004395'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
  status-number:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '700'
    lineHeight: '1'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 32px
  sidebar-width: 320px
  status-pill-gap: 8px
---

## Brand & Style

The design system is engineered for a self-hosted family safety environment where reliability and clarity are paramount. The aesthetic follows a **Modern Corporate** approach with a focus on high-utility and high-trust interactions. 

The target audience consists of family administrators who require immediate situational awareness and dependable data visualization. The UI evokes a sense of "watchful calm"—it is unobtrusive when everything is fine, but authoritative and clear during alerts. 

Design principles include:
- **Glanceability:** Information-dense layouts that can be parsed in seconds.
- **Precision:** Clean lines and geometric alignment to reflect technical accuracy.
- **Accessibility:** High-contrast ratios and clear status signaling for users of all ages.

## Colors

The palette is anchored by **Deep Navy (#0F172A)**, used for primary structural elements and typography to establish a foundation of stability. **Emerald Green (#10B981)** serves as the "Safe" or "Active" signal, reserved for positive status indicators, active connections, and primary action buttons related to safety.

**Neutral Grays** are utilized for secondary UI chrome and borders to ensure the map content remains the focal point. A secondary **Blue (#3B82F6)** is included for information-heavy components like history logs or technical settings, while standard Semantic Red and Amber are used for alerts and low-battery warnings.

## Typography

The design system utilizes **Inter** exclusively to ensure maximum legibility across dense data displays and mobile interfaces. The typographic hierarchy prioritizes "Status Numbers" (like battery percentage or speed) by using slightly heavier weights and tighter tracking.

For mobile-first views, headlines are scaled down to preserve screen real estate for map components. All labels use a semi-bold weight to ensure they remain readable even when overlaid on complex map backgrounds or satellite imagery.

## Layout & Spacing

This design system uses a **Fluid Map-Centric** layout. The map acts as the base layer, with UI components floating as "islands" or docked in a side panel.

- **Desktop:** Features a fixed-width left sidebar (320px) for member lists and detailed logs, while the map fills the remaining viewport.
- **Mobile:** Uses a bottom-sheet pattern for member details, allowing the map to occupy the top 60% of the screen.
- **Grid:** A 4px baseline grid ensures tight, mathematical alignment of status icons and data points. Internal card padding is strictly 16px to maintain a professional, airy feel without wasting space.

## Elevation & Depth

To maintain high contrast and clarity over shifting map colors, the system uses **Ambient Shadows** and **Tonal Layers**.

1.  **Level 0 (Base):** The map layer.
2.  **Level 1 (Floating Elements):** Cards and status pills use a soft, diffused shadow (`0 4px 12px rgba(15, 23, 42, 0.08)`) to lift them off the map.
3.  **Level 2 (Modals/Overlays):** Critical alerts or menus use a more pronounced shadow (`0 12px 24px rgba(15, 23, 42, 0.15)`) to demand attention.

No background blurs are used in high-contrast mode; instead, solid white or deep navy backgrounds are preferred for maximum legibility of text against the map.

## Shapes

The shape language is **Rounded (8px-12px)**. 
- **Standard Cards:** 8px (`rounded-md`).
- **Interactive Buttons/Inputs:** 8px (`rounded-md`).
- **Status Pills & Member Avatars:** Circular or `rounded-full` to distinguish "living entities" (people) from "static containers" (settings/logs).
- **Bottom Sheets:** 16px top-only rounding for a modern mobile feel.

## Components

### Status Indicators
Small, high-contrast badges used for Battery, Speed, and Connectivity. They must use the Semantic color palette (Green for >20%, Amber for 10-20%, Red for <10%).

### Map Markers
A "pin" shape with a circular avatar center. Use a 2px Emerald Green border to indicate the user is currently "Active/Moving" and a Gray border for "Inactive/Stationary."

### Navigation Cards
Compact cards floating on the map. They should contain a primary title (Member Name), a secondary label (Address/Location), and a horizontal row of status pills.

### Primary Buttons
Solid Deep Navy for administrative actions. Solid Emerald Green for "SOS" or "Check-In" actions. 

### Input Fields
Outlined style with a 1px border (#E2E8F0). On focus, the border transitions to Deep Navy with a soft 2px glow.

### Lists
Clean, borderless list items with a subtle divider (#F1F5F9). Use high-contrast icons to denote different event types (e.g., "Left School," "Arrived Home").