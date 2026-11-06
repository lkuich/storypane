import { FlaskConical, ShieldCheck } from 'lucide-react';
import type { Space } from '@storypane/core';
import './space-environment.css';

export function EnvironmentBadge({ environment }: { environment: Space['environment'] }) {
  const dev = environment === 'dev';
  const Icon = dev ? FlaskConical : ShieldCheck;
  return (
    <span className="environment-badge" data-environment={dev ? 'dev' : 'prod'}>
      <Icon aria-hidden="true" />
      {dev ? 'Development' : 'Production'}
    </span>
  );
}
