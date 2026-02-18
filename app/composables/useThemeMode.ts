type ThemeMode = 'light' | 'dark' | 'system'

const THEME_MODE_CYCLE: ThemeMode[] = ['light', 'dark', 'system']

function normalizeThemeMode(value: unknown): ThemeMode {
  if (value === 'dark' || value === 'system') {
    return value
  }

  return 'light'
}

export function useThemeMode() {
  const colorMode = useColorMode()

  const themeMode = computed<ThemeMode>(() => normalizeThemeMode(colorMode.preference))

  const resolvedTheme = computed<'light' | 'dark'>(() => {
    return colorMode.value === 'dark' ? 'dark' : 'light'
  })

  function setThemeMode(mode: ThemeMode) {
    colorMode.preference = mode
  }

  function cycleThemeMode() {
    const currentIndex = THEME_MODE_CYCLE.indexOf(themeMode.value)
    const nextIndex = (currentIndex + 1) % THEME_MODE_CYCLE.length
    setThemeMode(THEME_MODE_CYCLE[nextIndex]!)
  }

  return {
    themeMode,
    resolvedTheme,
    setThemeMode,
    cycleThemeMode
  }
}
