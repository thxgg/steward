import { useMagicKeys, whenever } from '@vueuse/core'

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
 * Composable for handling global keyboard shortcuts.
 * Uses @vueuse/core's useMagicKeys for key detection.
 *
 * Shortcuts are automatically suppressed when the user is typing in an input field.
 */
export function useKeyboard() {
  const keys = useMagicKeys()

  /**
   * Register a keyboard shortcut that fires when the specified key combo is pressed.
   * The handler will NOT fire if the user is typing in an input field.
   *
   * @param keyCombo - Key combination string (e.g., 'cmd+k', 'ctrl+shift+t')
   * @param handler - Function to call when shortcut is triggered
   * @param options - Additional options
   */
  function onShortcut(
    keyCombo: string,
    handler: () => void,
    options?: { allowInInput?: boolean }
  ) {
    const keyRef = keys[keyCombo]

    if (!keyRef) {
      console.warn(`[useKeyboard] Unknown key combination: ${keyCombo}`)
      return
    }

    whenever(keyRef, () => {
      // Skip if typing in input unless explicitly allowed
      if (!options?.allowInInput && isTypingInInput()) {
        return
      }
      handler()
    })
  }

  /**
   * Check if the user is currently focused on an input element
   */
  function isInputFocused(): boolean {
    return isTypingInInput()
  }

  return {
    keys,
    onShortcut,
    isInputFocused
  }
}
