import { ChevronRight,GitCompareArrows } from 'lucide-react';
import type { MigrationChange } from '@storypane/core';

export function MigrationChangeCount({changes}:{changes:MigrationChange[]}) {
  const added=changes.filter(change=>change.kind==='added').length;
  const removed=changes.filter(change=>change.kind==='removed').length;
  const changed=changes.length-added-removed;
  return <span className="migration-change-count" role="img" aria-label={`${added} added, ${changed} changed, ${removed} removed`}>
    {added>0 && <span data-kind="added" title={`${added} added`}>+{added}</span>}
    {changed>0 && <span data-kind="changed" title={`${changed} changed`}>~{changed}</span>}
    {removed>0 && <span data-kind="removed" title={`${removed} removed`}>−{removed}</span>}
    {!changes.length && <span>No schema changes</span>}
  </span>;
}

export function MigrationDiff({changes,emptyMessage,expandFirst=false}:{changes:MigrationChange[];emptyMessage:string;expandFirst?:boolean}) {
  return <section aria-label="Schema changes">
    <div className="migration-section-heading"><h3><GitCompareArrows size={17} aria-hidden="true" />Schema changes</h3><span>{changes.length} {changes.length===1?'change':'changes'}</span></div>
    <div className="migration-changes">{changes.map((change,index)=><details key={index} open={expandFirst && index===0}>
      <summary><ChevronRight size={15} aria-hidden="true" /><span><strong>{change.definition}</strong>{change.field && <><span className="muted"> / </span><code>{change.field}</code></>}</span><span className="migration-change-kind" data-kind={change.kind}>{change.kind}</span></summary>
      <div className="migration-diff"><div><h4>− Before</h4><pre>{change.before===undefined?'Not present':JSON.stringify(change.before,null,2)}</pre></div><div><h4>+ After</h4><pre>{change.after===undefined?'Removed':JSON.stringify(change.after,null,2)}</pre></div></div>
    </details>)}</div>
    {!changes.length && <p className="field-hint">{emptyMessage}</p>}
  </section>;
}
