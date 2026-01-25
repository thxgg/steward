import { onMounted, onUnmounted } from 'vue'

export interface KeyboardShortcut {
  keys: string
  handler: () => void
  description?: string
}

/**
 * Check if the currently focused element is an input field
 * where keyboard shortcuts should be suppressed
 */
function isTypingInInput(): boolean {
  if (!import.meta.client) return false

  const activeElement = document.activeElement
  if (!activeElement) return false

  // Check for input, textarea, or contenteditable elements
  const tagName = activeElement.tagName.toLowerCase()
  if (tagName === 'input' || tagName === 'textarea') {
    return true
  }

  // Check for contenteditable
  if (activeElement.getAttribute('contenteditable') === 'true') {
    return true
  }

  // Check for role="textbox"
  if (activeElement.getAttribute('role') === 'textbox') {
    return true
  }

  return false
}

/**
 * Parse a key combo string into its components
 * e.g., 'Meta+Shift+a' -> { meta: true, ctrl: false, shift: true, alt: false, key: 'a' }
 */
function parseKeyCombo(combo: string): { meta: boolean; ctrl: boolean; shift: boolean; alt: boolean; key: string } {
  const parts = combo.toLowerCase().split('+')
  const key = parts.pop() || ''

  return {
    meta: parts.includes('meta'),
    ctrl: parts.includes('ctrl'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    key
  }
}

/**
 * Check if a keyboard event matches a key combo
 */
function eventMatchesCombo(event: KeyboardEvent, combo: ReturnType<typeof parseKeyCombo>): boolean {
  const eventKey = event.key.toLowerCase()

  // Handle special keys
  let keyMatches = eventKey === combo.key
  if (combo.key === '\\') {
    keyMatches = eventKey === '\\' || event.code === 'Backslash'
  }
  if (combo.key === '/') {
    keyMatches = eventKey === '/' || event.code === 'Slash'
  }
  if (combo.key === '.') {
    keyMatches = eventKey === '.' || event.code === 'Period'
  }
  if (combo.key === ',') {
    keyMatches = eventKey === ',' || event.code === 'Comma'
  }

  return (
    keyMatches &&
    event.metaKey === combo.meta &&
    event.ctrlKey === combo.ctrl &&
    event.shiftKey === combo.shift &&
    event.altKey === combo.alt
  )
}

interface RegisteredShortcut {
  combo: ReturnType<typeof parseKeyCombo>
  handler: () => void
  allowInInput: boolean
}

// Global registry of shortcuts
const shortcuts: RegisteredShortcut[] = []

let listenerAttached = false

function handleKeyDown(event: KeyboardEvent) {
  for (const shortcut of shortcuts) {
    if (eventMatchesCombo(event, shortcut.combo)) {
      // Skip if typing in input unless explicitly allowed
      if (!shortcut.allowInInput && isTypingInInput()) {
        continue
      }

      // Prevent browser default behavior
      event.preventDefault()
      event.stopPropagation()

      // Call the handler
      shortcut.handler()
      return
    }
  }
}

function ensureListener() {
  if (!import.meta.client || listenerAttached) return

  document.addEventListener('keydown', handleKeyDown, { capture: true })
  listenerAttached = true
}

/**
 * Composable for handling global keyboard shortcuts.
 * Prevents default browser behavior when shortcuts are triggered.
 *
 * Shortcuts are automatically suppressed when the user is typing in an input field.
 */
export function useKeyboard() {
  onMounted(() => {
    ensureListener()
  })

  /**
   * Register a keyboard shortcut that fires when the specified key combo is pressed.
   * The handler will NOT fire if the user is typing in an input field.
   * Browser default behavior is automatically prevented.
   *
   * @param keyCombo - Key combination string (e.g., 'Meta+k', 'Ctrl+Shift+a')
   * @param handler - Function to call when shortcut is triggered
   * @param options - Additional options
   */
  function onShortcut(
    keyCombo: string,
    handler: () => void,
    options?: { allowInInput?: boolean }
  ) {
    const combo = parseKeyCombo(keyCombo)

    const shortcut: RegisteredShortcut = {
      combo,
      handler,
      allowInInput: options?.allowInInput ?? false
    }

    shortcuts.push(shortcut)

    // Ensure listener is attached
    ensureListener()

    // Cleanup on unmount
    onUnmounted(() => {
      const index = shortcuts.indexOf(shortcut)
      if (index > -1) {
        shortcuts.splice(index, 1)
      }
    })
  }

  /**
   * Check if the user is currently focused on an input element
   */
  function isInputFocused(): boolean {
    return isTypingInInput()
  }

  return {
    onShortcut,
    isInputFocused
  }
}
