import { AlertIcon, CheckCircleIcon, HourglassIcon, PendingCircleIcon } from './Icons'
import { QUEST_STATUS_LABEL, type QuestStatus } from './questStatus'

const ICONS = {
  'not-completed': PendingCircleIcon,
  completed: CheckCircleIcon,
  checking: HourglassIcon,
  error: AlertIcon,
} satisfies Record<QuestStatus, unknown>

/** Durum renkle birlikte simge ve metinle de belirtilir. */
export function QuestStatusBadge({ status }: { status: QuestStatus }) {
  const StatusIcon = ICONS[status]
  return (
    <span className={`quest-status quest-status--${status}`}>
      <StatusIcon />
      <span>
        <span className="visually-hidden">Görev durumu: </span>
        {QUEST_STATUS_LABEL[status]}
      </span>
    </span>
  )
}
