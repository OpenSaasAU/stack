# OpenSaaS Theming System

The OpenSaaS admin UI now includes a powerful theming system that makes it easy to customize the look and feel of your admin interface.

## Features

- 🎨 **Three Built-in Preset Themes**: Modern (default), Classic, and Neon
- 🌙 **Automatic Dark Mode**: All themes support dark mode based on system preferences
- ⚡ **Gradient Accents**: Modern neon gradients and visual effects
- 🎯 **Easy Customization**: Override specific colors while keeping the rest of the theme
- 🔧 **Type-Safe Configuration**: Full TypeScript support for all theme options

## Quick Start

### Using a Preset Theme

The easiest way to theme your admin UI is to use one of the built-in presets:

```typescript
// opensaas.config.ts
export default config({
  ui: {
    basePath: '/admin',
    theme: {
      preset: 'modern', // Options: "modern" | "classic" | "neon"
    },
  },
})
```

### Theme Presets

#### Modern (Default)

- **Primary Color**: Neon Cyan (`hsl(190, 95%, 55%)`)
- **Accent Color**: Neon Purple (`hsl(280, 85%, 65%)`)
- **Style**: Clean, contemporary design with gradient accents
- **Best For**: SaaS products, modern web apps

#### Classic

- **Primary Color**: Classic Blue (`hsl(221.2, 83.2%, 53.3%)`)
- **Accent Color**: Subtle Gray (`hsl(210, 40%, 96.1%)`)
- **Style**: Traditional, professional appearance
- **Best For**: Enterprise applications, conservative designs

#### Neon

- **Primary Color**: Hot Pink (`hsl(330, 100%, 50%)`)
- **Accent Color**: Bright Green (`hsl(155, 100%, 50%)`)
- **Style**: Bold, vibrant with high contrast
- **Best For**: Creative tools, gaming interfaces, Gen-Z focused apps

## Customization

### Override Specific Colors

You can use a preset theme but override specific colors:

```typescript
export default config({
  ui: {
    theme: {
      preset: 'modern',
      colors: {
        primary: '280 100% 50%', // Custom magenta primary color
        accent: '160 90% 55%', // Custom teal accent
      },
    },
  },
})
```

### Full Custom Theme

Create a completely custom theme:

```typescript
export default config({
  ui: {
    theme: {
      colors: {
        background: '0 0% 100%',
        foreground: '240 10% 5%',
        primary: '280 100% 50%',
        primaryForeground: '0 0% 100%',
        accent: '160 90% 55%',
        accentForeground: '240 10% 5%',
        // ... other colors
      },
      darkColors: {
        background: '240 10% 5%',
        foreground: '0 0% 98%',
        primary: '280 100% 60%',
        primaryForeground: '240 10% 5%',
        // ... other dark mode colors
      },
      radius: 0.5, // Border radius in rem
    },
  },
})
```

## Color Format

All colors use HSL (Hue, Saturation, Lightness) format **without** the `hsl()` wrapper:

```typescript
// ✅ Correct
primary: '190 95% 55%'

// ❌ Wrong
primary: 'hsl(190, 95%, 55%)'
primary: '#00bcd4'
```

This format allows Tailwind CSS to generate proper opacity variants automatically.

## Available Color Variables

### Essential Colors

- `background` - Main page background
- `foreground` - Main text color
- `primary` - Primary brand color (buttons, links, active states)
- `primaryForeground` - Text color on primary background
- `accent` - Secondary accent color
- `accentForeground` - Text color on accent background

### UI Elements

- `card` - Card background
- `cardForeground` - Text on cards
- `border` - Border color
- `input` - Input field border
- `ring` - Focus ring color
- `muted` - Muted/disabled backgrounds
- `mutedForeground` - Muted text

### Special

- `gradientFrom` - Start color for gradients
- `gradientTo` - End color for gradients

## Dark Mode

All themes automatically support dark mode based on the user's system preference. You can specify different colors for dark mode:

```typescript
theme: {
  preset: "modern",
  colors: {
    primary: "190 95% 55%", // Light mode cyan
  },
  darkColors: {
    primary: "190 100% 70%", // Darker mode - brighter cyan for contrast
  },
}
```

## Border Radius

Customize the roundness of UI elements:

```typescript
theme: {
  preset: "modern",
  radius: 1.0, // More rounded (default: 0.75)
}
```

## Examples

### SaaS Product Theme

```typescript
ui: {
  theme: {
    preset: "modern",
    colors: {
      primary: "210 100% 50%", // Bright blue
      accent: "170 90% 50%",   // Teal
    },
  },
}
```

### Gaming Platform Theme

```typescript
ui: {
  theme: {
    preset: "neon",
    colors: {
      primary: "270 100% 50%", // Purple
      accent: "30 100% 50%",   // Orange
    },
    radius: 0.25, // Sharp corners for edgy look
  },
}
```

### Enterprise Theme

```typescript
ui: {
  theme: {
    preset: "classic",
    radius: 0.5,
  },
}
```

## Programmatic Access

You can also access theme utilities programmatically:

```typescript
import { generateThemeCSS, presetThemes } from '@opensaas/ui'

// Generate CSS for a theme
const css = generateThemeCSS({
  preset: 'modern',
  colors: { primary: '280 100% 50%' },
})

// Access preset definitions
const modernTheme = presetThemes.modern
```

## Visual Components

The theming system automatically applies to:

- ✅ Navigation sidebar with gradient header and active states
- ✅ Dashboard cards with hover effects and gradient accents
- ✅ Buttons with multiple variants
- ✅ Form inputs and fields
- ✅ Tables and list views
- ✅ Modals and dialogs
- ✅ Loading states and skeletons

## Tips

1. **Start with a preset**: Choose the closest preset to your desired look
2. **Override sparingly**: Only customize colors that need to change
3. **Test dark mode**: Always check how your theme looks in dark mode
4. **Use gradients**: The `gradientFrom` and `gradientTo` colors create beautiful effects
5. **Maintain contrast**: Ensure text is readable on all backgrounds

## TypeScript Support

All theme configuration is fully typed:

```typescript
import type { ThemeConfig, ThemePreset, ThemeColors } from '@opensaas/core'

const myTheme: ThemeConfig = {
  preset: 'modern', // Autocomplete works!
  colors: {
    primary: '280 100% 50%',
    // TypeScript will warn about invalid properties
  },
}
```
