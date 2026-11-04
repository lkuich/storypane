import { Check, Clock3, FileText } from 'lucide-react'
import type { PublicationStatus as Status } from '@storypane/core'

export function PublicationStatus({ status,localeName }: { status:Status;localeName?:string }) {
  const Icon=status === 'published' ? Check : status === 'changed' ? Clock3 : FileText
  return <span className={`publication-status pill ${status === 'published' ? 'pill--green' : 'pill--amber'}`}>
    <Icon aria-hidden="true" />{localeName && `${localeName} · `}{status === 'published' ? 'Published' : status === 'changed' ? 'Awaiting publish' : 'Draft'}
  </span>
}
