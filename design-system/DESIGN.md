# Design System Inspired by Notion

## 1. Visual Theme & Atmosphere

Notion's design system embodies a sophisticated, productivity-focused aesthetic that balances minimalist clarity with intelligent depth. The visual language is clean and purposeful, featuring a light, neutral foundation punctuated by vibrant accent colors that signal interactivity and status. The typography is precise and hierarchical, guiding users through complex workspaces with calm confidence. Dark navy backgrounds anchor hero sections and hero copywriting, creating dramatic contrast with clean white typography. The overall mood is professional yet approachable—designed for teams who demand both power and elegance in their workspace.

**Key Characteristics**
- Clean, minimal aesthetic with purposeful use of whitespace
- Rich accent color palette signaling different agent types and actions
- High contrast between light and dark zones for visual hierarchy
- Precise, readable typography with careful weight progression
- Soft, subtle shadows creating depth without distraction
- Colorful circular agent badges with rounded, friendly design
- Strategic use of deep navy and cream backgrounds to anchor experiences

## 2. Color Palette & Roles

### Primary
- **Primary Blue** (`#62AEF0`): Primary interactive elements, links, call-to-action buttons, and primary UI accents; used most frequently across the system
- **Deep Blue** (`#0075DE`): Higher-emphasis primary actions and stronger interactive states
- **Navy Accent** (`#097FE8`): Secondary interactive elements and visual emphasis

### Accent Colors
- **Purple** (`#9849E8`): Agent type badge—task routing and custom agents
- **Teal** (`#27918D`): Agent type badge—reporting agents and data visualization
- **Orange** (`#FF6D00`): Agent type badge—Q&A agents and knowledge systems
- **Brown** (`#9C7054`): Supporting accent color for secondary visual hierarchy

### Interactive
- **Primary CTA** (`#62AEF0`): Main button actions like "Get Notion free," primary form submissions
- **Secondary Interactive** (`#0075DE`): Alternative CTAs like "Request a demo," secondary form actions
- **Ghost Interactive** (`#FFFFFF`): Transparent buttons and ghost states on dark backgrounds

### Neutral Scale
- **Black** (`#000000`): Primary text, headings, and high-contrast UI elements (used 485 times)
- **Dark Gray** (`#78736F`): Secondary text, captions, and de-emphasized content
- **Light Gray** (`#F6F5F4`): Background fill for cards, sections, and secondary surfaces (used 357 times)
- **White** (`#FFFFFF`): Primary background, card surfaces, and contrast layers

### Surface & Borders
- **Cream Background** (`#F6F5F4`): Default page and card backgrounds for content sections
- **Off-White** (`#F2F9FF`): Light tinted surface for blue-themed content areas
- **Warm Cream** (`#FCF8F5`): Subtle warm-tinted surface option
- **Light Peach** (`#FFF5ED`): Warm accent surface for promotional or highlighted content
- **Pale Pink** (`#FEF3F1`): Soft surface variant for status or alternative content zones

### Semantic / Status
- **Error** (`#F64932`): Error states, destructive actions, and validation failures
- **Warning** (`#FFB110`): Warning messages, caution indicators, and attention flags

## 3. Typography Rules

### Font Family
**Primary:** NotionInter, Inter, system-ui, -apple-system, sans-serif
**Secondary:** NotionInter, system-ui, sans-serif

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|------|--------|-------------|----------------|-------|
| Display 1 / H1 | NotionInter | 64px | 700 | 64px | 0px | Hero headlines and major section titles |
| Display 2 / H2 | NotionInter | 48px | 700 | 56px | 0px | Large section headings |
| Heading 1 / H3 | NotionInter | 32px | 700 | 40px | 0px | Primary content headings |
| Heading 2 / H4 | NotionInter | 24px | 700 | 32px | 0px | Secondary content headings and card titles |
| Heading 3 / H5 | NotionInter | 18px | 600 | 28px | 0px | Tertiary headings and emphasis text |
| Subheading | NotionInter | 16px | 600 | 24px | 0px | Subheadings and label text |
| Body | NotionInter | 16px | 400 | 24px | 0px | Primary body text and descriptions |
| Body Small | NotionInter | 14px | 400 | 20px | 0px | Secondary body text and metadata |
| Button | NotionInter | 16px | 500 | 24px | 0px | Interactive button labels |
| Caption | NotionInter | 12px | 500 | 16px | 0px | Captions, hints, and secondary labels |
| Code | NotionInter | 14px | 400 | 20px | 0px | Monospace code snippets and terminal text |

### Principles
- Hierarchy uses weight progression (400, 500, 600, 700) rather than radical size changes
- Line height is always tighter than leading (24px line on 16px body creates compact, readable blocks)
- All headings use 700 weight for maximum visual impact and scanning
- Body text remains at 400 weight for optimal readability
- Captions and metadata use 12–14px to de-emphasize without losing clarity
- Letter spacing remains 0px across all sizes for tightness and sophistication

## 4. Component Stylings

### Buttons

#### Primary Button
- **Background:** `#62AEF0`
- **Text Color:** `#FFFFFF`
- **Padding:** `12px 24px`
- **Border Radius:** `8px`
- **Border:** `0px solid transparent`
- **Font Size:** `16px`
- **Font Weight:** `500`
- **Line Height:** `24px`
- **Height:** `auto` (min 44px)
- **Hover State:** Background `#0075DE`, text `#FFFFFF`
- **Active State:** Background `#097FE8`, text `#FFFFFF`
- **Disabled State:** Background `#F6F5F4`, text `#78736F`

#### Secondary Button
- **Background:** `#FFFFFF`
- **Text Color:** `#000000`
- **Padding:** `12px 24px`
- **Border Radius:** `8px`
- **Border:** `1px solid #78736F`
- **Font Size:** `16px`
- **Font Weight:** `500`
- **Line Height:** `24px`
- **Height:** `auto` (min 44px)
- **Hover State:** Background `#F6F5F4`, text `#000000`
- **Active State:** Background `#78736F`, text `#FFFFFF`

#### Ghost Button
- **Background:** `rgba(255, 255, 255, 0)`
- **Text Color:** `#F6F5F4`
- **Padding:** `12px 24px`
- **Border Radius:** `8px`
- **Border:** `1px solid #F6F5F4`
- **Font Size:** `16px`
- **Font Weight:** `500`
- **Line Height:** `24px`
- **Height:** `auto` (min 44px)
- **Hover State:** Background `rgba(246, 245, 244, 0.1)`, text `#FFFFFF`
- **Active State:** Background `rgba(246, 245, 244, 0.2)`, text `#FFFFFF`

#### Icon Button
- **Background:** `rgba(0, 0, 0, 0)`
- **Text Color:** `#000000`
- **Padding:** `11px`
- **Border Radius:** `8px`
- **Border:** `0px solid transparent`
- **Font Size:** `16px`
- **Font Weight:** `400`
- **Line Height:** `24px`
- **Height:** `44px`
- **Width:** `44px`
- **Hover State:** Background `#F6F5F4`, text `#000000`

### Cards & Containers

#### Standard Card
- **Background:** `#FFFFFF`
- **Border Radius:** `12px`
- **Border:** `0px solid transparent`
- **Padding:** `24px`
- **Box Shadow:** `rgba(0, 0, 0, 0.01) 0px 0.667px 3.502px 0px, rgba(0, 0, 0, 0.016) 0px 2.933px 7.252px 0px, rgba(0, 0, 0, 0.02) 0px 7.2px 14.462px 0px, rgba(0, 0, 0, 0.024) 0px 13.867px 28.348px 0px, rgba(0, 0, 0, 0.03) 0px 23.333px 52.123px 0px, rgba(0, 0, 0, 0.04) 0px 36px 89px 0px`
- **Text Color:** `#000000`

#### Subtle Card
- **Background:** `#F6F5F4`
- **Border Radius:** `8px`
- **Border:** `0px solid transparent`
- **Padding:** `16px`
- **Box Shadow:** `none`
- **Text Color:** `#000000`

#### Feature Card
- **Background:** `#F2F9FF`
- **Border Radius:** `8px`
- **Border:** `1px solid #62AEF0`
- **Padding:** `20px`
- **Box Shadow:** `none`
- **Text Color:** `#000000`

### Inputs & Forms

#### Text Input
- **Background:** `#FFFFFF`
- **Border:** `1px solid #78736F`
- **Border Radius:** `8px`
- **Padding:** `12px 16px`
- **Font Size:** `16px`
- **Font Weight:** `400`
- **Line Height:** `24px`
- **Text Color:** `#000000`
- **Placeholder Color:** `rgba(0, 0, 0, 0.4)`
- **Height:** `44px`
- **Focus State:** Border `1px solid #62AEF0`, box-shadow `0px 0px 0px 3px rgba(98, 174, 240, 0.1)`
- **Error State:** Border `1px solid #F64932`
- **Disabled State:** Background `#F6F5F4`, text `#78736F`

#### Textarea
- **Background:** `#FFFFFF`
- **Border:** `1px solid #78736F`
- **Border Radius:** `8px`
- **Padding:** `12px 16px`
- **Font Size:** `14px`
- **Font Weight:** `400`
- **Line Height:** `20px`
- **Text Color:** `#000000`
- **Min Height:** `120px`
- **Focus State:** Border `1px solid #62AEF0`, box-shadow `0px 0px 0px 3px rgba(98, 174, 240, 0.1)`

#### Checkbox
- **Size:** `20px × 20px`
- **Background (Unchecked):** `#FFFFFF`
- **Border:** `2px solid #78736F`
- **Border Radius:** `4px`
- **Background (Checked):** `#62AEF0`
- **Checkmark Color:** `#FFFFFF`
- **Checkmark Weight:** `2px`

### Navigation

#### Top Navigation Bar
- **Background:** `rgba(0, 0, 0, 0)` (transparent on dark backgrounds) or `#FFFFFF` (on light backgrounds)
- **Height:** `64px`
- **Padding:** `0px 32px`
- **Border Bottom:** `1px solid rgba(0, 0, 0, 0.1)`
- **Box Shadow:** `rgba(0, 0, 0, 0.1) 0px 1px 0px 0px`
- **Text Color:** `rgba(0, 0, 0, 0.9)` or `#F6F5F4` (on dark)

#### Navigation Link
- **Padding:** `8px 16px`
- **Border Radius:** `8px`
- **Font Size:** `16px`
- **Font Weight:** `400`
- **Line Height:** `24px`
- **Text Color:** `rgba(0, 0, 0, 0.95)`
- **Hover State:** Background `#F6F5F4`, text `#000000`
- **Active State:** Background `#62AEF0`, text `#FFFFFF`

#### Dropdown Menu
- **Background:** `#FFFFFF`
- **Border Radius:** `8px`
- **Padding:** `8px 0px`
- **Border:** `0px solid transparent`
- **Box Shadow:** `rgba(0, 0, 0, 0.01) 0px 0.175px 1.041px 0px, rgba(0, 0, 0, 0.02) 0px 0.8px 2.925px 0px, rgba(0, 0, 0, 0.027) 0px 2.025px 7.847px 0px, rgba(0, 0, 0, 0.04) 0px 4px 18px 0px`

#### Dropdown Menu Item
- **Padding:** `8px 16px`
- **Font Size:** `14px`
- **Font Weight:** `400`
- **Line Height:** `20px`
- **Text Color:** `#000000`
- **Hover State:** Background `#F6F5F4`, text `#000000`

### Badges

#### Status Badge (Default)
- **Background:** `#F6F5F4`
- **Text Color:** `#000000`
- **Padding:** `4px 12px`
- **Border Radius:** `1000px`
- **Font Size:** `12px`
- **Font Weight:** `500`
- **Line Height:** `16px`
- **Border:** `0px solid transparent`

#### Status Badge (Blue)
- **Background:** `#F2F9FF`
- **Text Color:** `#0075DE`
- **Padding:** `4px 12px`
- **Border Radius:** `1000px`
- **Font Size:** `12px`
- **Font Weight:** `500`
- **Line Height:** `16px`

#### Status Badge (Purple - Task Routing)
- **Background:** `rgba(152, 73, 232, 0.15)`
- **Text Color:** `#9849E8`
- **Padding:** `4px 12px`
- **Border Radius:** `1000px`
- **Font Size:** `12px`
- **Font Weight:** `500`
- **Line Height:** `16px`

#### Status Badge (Teal - Reporting)
- **Background:** `rgba(39, 145, 141, 0.15)`
- **Text Color:** `#27918D`
- **Padding:** `4px 12px`
- **Border Radius:** `1000px`
- **Font Size:** `12px`
- **Font Weight:** `500`
- **Line Height:** `16px`

#### Status Badge (Orange - Q&A)
- **Background:** `rgba(255, 109, 0, 0.15)`
- **Text Color:** `#FF6D00`
- **Padding:** `4px 12px`
- **Border Radius:** `1000px`
- **Font Size:** `12px`
- **Font Weight:** `500`
- **Line Height:** `16px`

#### Status Badge (Error)
- **Background:** `rgba(246, 73, 50, 0.15)`
- **Text Color:** `#F64932`
- **Padding:** `4px 12px`
- **Border Radius:** `1000px`
- **Font Size:** `12px`
- **Font Weight:** `500`
- **Line Height:** `16px`

#### Status Badge (Warning)
- **Background:** `rgba(255, 177, 16, 0.15)`
- **Text Color:** `#FFB110`
- **Padding:** `4px 12px`
- **Border Radius:** `1000px`
- **Font Size:** `12px`
- **Font Weight:** `500`
- **Line Height:** `16px`

### Tabs

#### Tab Bar
- **Background:** `#FFFFFF`
- **Padding:** `0px`
- **Border Bottom:** `1px solid #F6F5F4`
- **Height:** `48px`

#### Tab Item (Inactive)
- **Padding:** `12px 16px`
- **Font Size:** `14px`
- **Font Weight:** `500`
- **Line Height:** `20px`
- **Text Color:** `#78736F`
- **Border Bottom:** `0px solid transparent`
- **Hover State:** Text `#000000`, border `1px solid #F6F5F4`

#### Tab Item (Active)
- **Padding:** `12px 16px`
- **Font Size:** `14px`
- **Font Weight:** `600`
- **Line Height:** `20px`
- **Text Color:** `#000000`
- **Border Bottom:** `2px solid #62AEF0`

## 5. Layout Principles

### Spacing System

**Base Unit:** `4px`

**Spacing Scale:**
- `4px` — Extra tight gaps, icon spacing, minimal separators
- `8px` — Tight spacing, component internal gaps
- `12px` — Small padding, list item gaps
- `16px` — Standard padding, component spacing
- `20px` — Medium gaps between content sections
- `24px` — Standard section padding, card internal spacing
- `28px` — Large gaps, content block separation
- `32px` — Extra-large padding, hero sections
- `36px` — Spacious padding, prominent sections
- `40px` — Large vertical gaps, major section breaks
- `56px` — Extra-large spacing, modular content zones
- `60px` — Heroic spacing, page-level separation

**Usage Context:**
- Padding: `16px` to `32px` for components
- Margins: `20px` to `40px` for section separation
- Gap (flexbox): `8px` to `16px` for items in rows/columns
- Icon to text: `8px` gap

### Grid & Container

**Max Width:** `1440px` (full bleed at breakpoint)

**Columns:** 12-column grid with `16px` gutters

**Container Padding:**
- Desktop: `32px` left/right
- Tablet: `24px` left/right
- Mobile: `16px` left/right

**Section Patterns:**
- Full-width hero sections with centered content container inside
- Content sections with max-width `1200px`, centered, with `32px` vertical padding
- Two-column layouts split at `50%` or `60/40` depending on hierarchy
- Three-column card grids with `24px` gap

### Whitespace Philosophy

Notion's design embraces generous whitespace to create clarity and breathing room. Content sections are separated by at least `40px` of vertical space, with critical sections receiving `60px` or more. Horizontal whitespace uses symmetric padding to create visual balance. Cards and containers maintain internal padding of at least `24px` to prevent cramping. This approach reduces cognitive load and draws focus to primary content.

### Border Radius Scale

- `0px` — Hard edges for no rounding (legacy/minimal UI elements)
- `4px` — Minimal rounding for buttons and tight components
- `8px` — Standard rounding for buttons, inputs, and general components
- `12px` — Prominent rounding for cards and larger containers
- `50%` — Perfect circles for avatars and icon buttons
- `1000px` — Pill-shaped buttons and badge containers

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| None | No shadow | Flat surfaces, backgrounds, disabled states |
| Subtle | `rgba(0, 0, 0, 0.01) 0px 0.667px 3.502px 0px, rgba(0, 0, 0, 0.016) 0px 2.933px 7.252px 0px, rgba(0, 0, 0, 0.02) 0px 7.2px 14.462px 0px, rgba(0, 0, 0, 0.024) 0px 13.867px 28.348px 0px, rgba(0, 0, 0, 0.03) 0px 23.333px 52.123px 0px, rgba(0, 0, 0, 0.04) 0px 36px 89px 0px` | Modal dialogs, floating cards, lightboxes |
| Dropdown | `rgba(0, 0, 0, 0.01) 0px 0.175px 1.041px 0px, rgba(0, 0, 0, 0.02) 0px 0.8px 2.925px 0px, rgba(0, 0, 0, 0.027) 0px 2.025px 7.847px 0px, rgba(0, 0, 0, 0.04) 0px 4px 18px 0px` | Dropdown menus, popovers, contextual floating UI |
| Navigation | `rgba(0, 0, 0, 0.1) 0px 1px 0px 0px` | Top navigation bars, persistent headers |

Notion's shadow philosophy uses subtle, multi-layer shadows that create real depth without heaviness. Shadows increase progressively with elevation, creating a clear spatial hierarchy. The darkest shadows are reserved for modals and critical floating elements, while navigation and persistent UI use minimal definition. All shadows use very low opacity (1–4%) to maintain the clean, minimal aesthetic.

## 7. Do's and Don'ts

### Do
- Use `#62AEF0` for all primary CTAs and interactive elements that drive user action
- Maintain consistent `16px` padding for most interactive components to ensure 44px minimum touch targets
- Apply `8px` border radius to buttons and inputs—this is the standard rounding across the system
- Use `#000000` text on light backgrounds and `#F6F5F4` text on dark backgrounds for maximum contrast
- Stack sections with at least `40px` vertical spacing to create visual breathing room
- Use the full shadow elevation pyramid—subtle for cards, dropdown for menus, nothing for flat surfaces
- Color agent badges with accent colors: purple for task routing, teal for reporting, orange for Q&A
- Apply NotionInter at `700` weight for all headings to maintain visual hierarchy
- Use the 12-column grid with `16px` gutters as the foundation for all layouts
- Test all interactive states (hover, active, disabled, focus) for consistency

### Don't
- Mix primary buttons with secondary buttons in the same action group—use one primary CTA per section
- Use shadows on elements that should feel flat or de-emphasized (inputs, disabled states)
- Apply border radius larger than `12px` except for pill-shaped badges and circular avatars
- Combine multiple accent colors in a single UI component—pick one color per semantic role
- Use text smaller than `12px` except in rare edge cases like code snippets
- Ignore the 44px minimum touch target size for mobile interactive elements
- Layer more than three depth levels in a single view (focus on no shadow, subtle, dropdown)
- Use `#F64932` (error red) for non-critical states or warnings—reserve it for destructive actions only
- Override the typography hierarchy table—maintain strict adherence to the sizing and weight system
- Apply padding smaller than `8px` to interactive components (buttons, inputs, links)

## 8. Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile | 320px – 639px | Single column layout, `16px` padding, stacked navigation, `32px` section spacing |
| Tablet | 640px – 1023px | Two-column layout option, `24px` padding, horizontal navigation, `40px` section spacing |
| Desktop | 1024px – 1439px | Full multi-column grid, `32px` padding, expanded navigation, `60px` section spacing |
| Large Desktop | 1440px+ | Max-width container `1440px` centered, full feature set |

### Touch Targets

- **Minimum Size:** `44px × 44px` for all interactive elements (buttons, links, icon buttons)
- **Comfortable Size:** `48px × 48px` for primary actions and frequently tapped elements
- **Recommended Spacing:** `16px` minimum between adjacent touch targets
- **Icon Buttons:** `44px` with `8px` internal padding, icon size `24px`
- **Checkbox/Radio:** `20px` base size, `16px` internal padding for touch area

### Collapsing Strategy

**Mobile (320px – 639px):**
- Stack all multi-column layouts to single column
- Reduce padding from `32px` to `16px` on sides
- Collapse horizontal navigation into hamburger menu
- Stack card grids to single column with `16px` gap
- Reduce heading sizes by one step (H1 becomes 48px, H2 becomes 32px)
- Expand button width to full container minus padding

**Tablet (640px – 1023px):**
- Support two-column layouts and 2-column card grids
- Maintain `24px` padding on sides
- Show horizontal navigation with condensed spacing
- Reduce gap between cards from `24px` to `16px`
- Keep typography sizes near desktop standards

**Desktop (1024px+):**
- Full grid layouts, 3+ column card grids with `24px` gap
- Maintain `32px` side padding within container
- Full-width navigation with all items visible
- Expand card sizes and content width
- Use full typography scale

## 9. Agent Prompt Guide

### Quick Color Reference

- **Primary CTA:** Primary Blue (`#62AEF0`) — Use for main action buttons, primary links, interactive highlights
- **Secondary CTA:** Deep Blue (`#0075DE`) — Use for alternative actions and secondary emphasis
- **Background (Light):** Off-White (`#FFFFFF`) — Card and surface backgrounds
- **Background (Neutral):** Cream (`#F6F5F4`) — Default page background and subtle containers
- **Heading Text:** Black (`#000000`) — All heading and primary text
- **Body Text:** Black (`#000000`) — Body copy and standard text
- **Secondary Text:** Dark Gray (`#78736F`) — Metadata, captions, and de-emphasized content
- **Task Routing Agent:** Purple (`#9849E8`) — Badge and accent color for task routing features
- **Reporting Agent:** Teal (`#27918D`) — Badge and accent color for reporting and data features
- **Q&A Agent:** Orange (`#FF6D00`) — Badge and accent color for knowledge and Q&A features
- **Error State:** Error Red (`#F64932`) — Validation errors and destructive actions
- **Warning State:** Warning Yellow (`#FFB110`) — Warning messages and caution indicators

### Iteration Guide

1. **All buttons must be 44px minimum height** with `12px` vertical and `24px` horizontal padding; use `#62AEF0` for primary and `#FFFFFF` with border for secondary.

2. **Typography must follow the hierarchy table exactly**—headings at 700 weight, body at 400, captions at 12px 500; never deviate from the specified sizes and weights.

3. **Spacing between sections is always 40px or 60px**—never use arbitrary spacing; use the 12-column grid with 16px gutters as the foundation for all layouts.

4. **Apply the full shadow pyramid: no shadow for flat elements, subtle shadow for cards/modals, dropdown shadow for menus**—never apply shadows to disabled or de-emphasized states.

5. **Border radius is 8px for buttons/inputs, 12px for cards, 1000px for badges**—only use other values (4px, 50%) in edge cases documented in the design system.

6. **All interactive elements need four states: default, hover, active, and disabled**—disabled must use `#F6F5F4` background with `#78736F` text.

7. **Text contrast must pass WCAG AA** (`#000000` on light, `#F6F5F4` on dark); never place light text on light backgrounds or dark text on dark backgrounds.

8. **Agent badges use semantic colors: purple for task routing, teal for reporting, orange for Q&A**—apply as background tint (15% opacity) with matching text color.

9. **Focus states for inputs and buttons must include a 3px blue shadow** (`0px 0px 0px 3px rgba(98, 174, 240, 0.1)`) for accessibility and visibility.

10. **Mobile-first responsive design: 44px minimum touch targets, 16px side padding, single-column stacked layouts, hamburger navigation on screens under 640px**; use the breakpoint table to guide responsive behavior.