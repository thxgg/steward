import { toast } from 'vue-sonner'

export function useToast() {
  function showError(message: string, description?: string) {
    toast.error(message, {
      description,
      duration: 5000
    })
  }

  function showSuccess(message: string, description?: string) {
    toast.success(message, {
      description,
      duration: 3000
    })
  }

  function showInfo(message: string, description?: string) {
    toast.info(message, {
      description,
      duration: 3000
    })
  }

  return {
    showError,
    showSuccess,
    showInfo,
    toast
  }
}
