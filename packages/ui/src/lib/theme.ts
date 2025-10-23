import type { ThemeColors, ThemeConfig, ThemePreset } from '@opensaas/core'

/**
 * Preset theme definitions
 */
export const presetThemes: Record<ThemePreset, { light: ThemeColors; dark: ThemeColors }> = {
  modern: {
    light: {
      background: '220 20% 97%',
      foreground: '220 30% 10%',
      card: '0 0% 100%',
      cardForeground: '220 30% 10%',
      popover: '0 0% 100%',
      popoverForeground: '220 30% 10%',
      primary: '190 95% 55%',
      primaryForeground: '220 30% 10%',
      secondary: '220 15% 94%',
      secondaryForeground: '220 30% 10%',
      muted: '220 15% 94%',
      mutedForeground: '220 15% 45%',
      accent: '280 85% 65%',
      accentForeground: '0 0% 100%',
      destructive: '0 84% 60%',
      destructiveForeground: '0 0% 100%',
      border: '220 15% 88%',
      input: '220 15% 88%',
      ring: '190 95% 55%',
      gradientFrom: '190 95% 55%',
      gradientTo: '280 85% 65%',
    },
    dark: {
      background: '220 25% 8%',
      foreground: '220 15% 95%',
      card: '220 20% 12%',
      cardForeground: '220 15% 95%',
      popover: '220 20% 12%',
      popoverForeground: '220 15% 95%',
      primary: '190 100% 60%',
      primaryForeground: '220 30% 10%',
      secondary: '220 20% 18%',
      secondaryForeground: '220 15% 95%',
      muted: '220 20% 18%',
      mutedForeground: '220 10% 55%',
      accent: '280 90% 70%',
      accentForeground: '220 30% 10%',
      destructive: '0 84% 65%',
      destructiveForeground: '0 0% 100%',
      border: '220 20% 22%',
      input: '220 20% 22%',
      ring: '190 100% 60%',
      gradientFrom: '190 100% 60%',
      gradientTo: '280 90% 70%',
    },
  },
  classic: {
    light: {
      background: '0 0% 100%',
      foreground: '222.2 84% 4.9%',
      card: '0 0% 100%',
      cardForeground: '222.2 84% 4.9%',
      popover: '0 0% 100%',
      popoverForeground: '222.2 84% 4.9%',
      primary: '221.2 83.2% 53.3%',
      primaryForeground: '210 40% 98%',
      secondary: '210 40% 96.1%',
      secondaryForeground: '222.2 47.4% 11.2%',
      muted: '210 40% 96.1%',
      mutedForeground: '215.4 16.3% 46.9%',
      accent: '210 40% 96.1%',
      accentForeground: '222.2 47.4% 11.2%',
      destructive: '0 84.2% 60.2%',
      destructiveForeground: '210 40% 98%',
      border: '214.3 31.8% 91.4%',
      input: '214.3 31.8% 91.4%',
      ring: '221.2 83.2% 53.3%',
      gradientFrom: '221.2 83.2% 53.3%',
      gradientTo: '221.2 83.2% 53.3%',
    },
    dark: {
      background: '222.2 84% 4.9%',
      foreground: '210 40% 98%',
      card: '222.2 84% 8%',
      cardForeground: '210 40% 98%',
      popover: '222.2 84% 8%',
      popoverForeground: '210 40% 98%',
      primary: '221.2 83.2% 53.3%',
      primaryForeground: '210 40% 98%',
      secondary: '217.2 32.6% 17.5%',
      secondaryForeground: '210 40% 98%',
      muted: '217.2 32.6% 17.5%',
      mutedForeground: '215 20.2% 65.1%',
      accent: '217.2 32.6% 17.5%',
      accentForeground: '210 40% 98%',
      destructive: '0 84.2% 60.2%',
      destructiveForeground: '210 40% 98%',
      border: '217.2 32.6% 17.5%',
      input: '217.2 32.6% 17.5%',
      ring: '221.2 83.2% 53.3%',
      gradientFrom: '221.2 83.2% 53.3%',
      gradientTo: '221.2 83.2% 53.3%',
    },
  },
  neon: {
    light: {
      background: '0 0% 100%',
      foreground: '240 10% 5%',
      card: '0 0% 100%',
      cardForeground: '240 10% 5%',
      popover: '0 0% 100%',
      popoverForeground: '240 10% 5%',
      primary: '330 100% 50%',
      primaryForeground: '0 0% 100%',
      secondary: '240 5% 96%',
      secondaryForeground: '240 10% 5%',
      muted: '240 5% 96%',
      mutedForeground: '240 5% 45%',
      accent: '155 100% 50%',
      accentForeground: '240 10% 5%',
      destructive: '0 100% 50%',
      destructiveForeground: '0 0% 100%',
      border: '240 5.9% 90%',
      input: '240 5.9% 90%',
      ring: '330 100% 50%',
      gradientFrom: '330 100% 50%',
      gradientTo: '155 100% 50%',
    },
    dark: {
      background: '240 10% 5%',
      foreground: '0 0% 98%',
      card: '240 10% 8%',
      cardForeground: '0 0% 98%',
      popover: '240 10% 8%',
      popoverForeground: '0 0% 98%',
      primary: '330 100% 60%',
      primaryForeground: '240 10% 5%',
      secondary: '240 5% 15%',
      secondaryForeground: '0 0% 98%',
      muted: '240 5% 15%',
      mutedForeground: '240 5% 60%',
      accent: '155 100% 60%',
      accentForeground: '240 10% 5%',
      destructive: '0 100% 60%',
      destructiveForeground: '0 0% 100%',
      border: '240 5% 20%',
      input: '240 5% 20%',
      ring: '330 100% 60%',
      gradientFrom: '330 100% 60%',
      gradientTo: '155 100% 60%',
    },
  },
}

/**
 * Generate CSS variables from theme configuration
 */
export function generateThemeCSS(config?: ThemeConfig): string {
  const preset = config?.preset || 'modern'
  const radius = config?.radius ?? 0.75

  // Get base colors from preset
  const baseLight = presetThemes[preset].light
  const baseDark = presetThemes[preset].dark

  // Merge with custom overrides
  const lightColors = { ...baseLight, ...config?.colors }
  const darkColors = { ...baseDark, ...config?.darkColors }

  // Convert colors to CSS variables
  const colorToCSSVar = (key: string, value: string) => {
    // Convert camelCase to kebab-case with --color- prefix
    const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase()
    return `  --color-${cssKey}: ${value};`
  }

  const lightVars = Object.entries(lightColors)
    .map(([key, value]) => colorToCSSVar(key, value as string))
    .join('\n')

  const darkVars = Object.entries(darkColors)
    .map(([key, value]) => colorToCSSVar(key, value as string))
    .join('\n')

  return `
:root {
${lightVars}
  --radius: ${radius}rem;
}

@media (prefers-color-scheme: dark) {
  :root {
${darkVars}
  }
}
`.trim()
}

/**
 * Get theme CSS as a style tag content
 */
export function getThemeStyleTag(config?: ThemeConfig): string {
  return `<style id="opensaas-theme">${generateThemeCSS(config)}</style>`
}
