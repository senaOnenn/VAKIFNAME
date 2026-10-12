import { API_BASE_URL, type ApiError } from '../api/client'
import { AlertIcon } from './Icons'

function describe(error: ApiError): string {
  switch (error.kind) {
    case 'network':
      return 'Sunucuya ulaşılamadı. Backend kapalı olabilir ya da internet bağlantınızda sorun olabilir.'
    case 'timeout':
      return 'Sunucu zamanında yanıt vermedi. Lütfen biraz sonra tekrar deneyin.'
    case 'invalid-response':
      return 'Sunucudan beklenmeyen bir yanıt geldi.'
    case 'http':
      return error.message
  }
}

interface Props {
  title: string
  error: ApiError
  onRetry?: () => void
}

export function ApiErrorMessage({ title, error, onRetry }: Props) {
  return (
    <div className="notice notice--error" role="alert">
      <AlertIcon className="notice__icon" />
      <div>
        <p className="notice__title">{title}</p>
        <p>{describe(error)}</p>
        {error.kind === 'network' && <p className="notice__meta">API adresi: {API_BASE_URL}</p>}
        {onRetry && (
          <button type="button" className="button button--secondary" onClick={onRetry}>
            Tekrar dene
          </button>
        )}
      </div>
    </div>
  )
}
