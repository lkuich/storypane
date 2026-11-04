'use client';
import { useEffect,useState } from 'react';
import { AlertTriangle,ArrowRight,CheckCircle2,ChevronRight,ExternalLink,RefreshCw,Trash2 } from 'lucide-react';
import type { MigrationReview } from '@storypane/core';
import { Button,ErrorNotice,Modal } from '@storypane/ui';
import { storyUrl } from '../../lib/space-url';
import { MigrationDiff } from './migration-diff';

export function MigrationReviewDialog({review,busy,error,canDeploy,onClose,onInspect,onDeploy}:{
  review:MigrationReview|null;busy:boolean;error:string;canDeploy:boolean;onClose:()=>void;
  onInspect:(destructive:boolean)=>void;onDeploy:(confirmation:string)=>void;
}) {
  const [confirming,setConfirming]=useState(false),[confirmation,setConfirmation]=useState('');
  useEffect(()=>{setConfirming(false);setConfirmation('')},[review?.token]);
  const totals=review?.impacts.reduce((sum,item)=>({deletedValues:sum.deletedValues+item.deletedValues,resetValues:sum.resetValues+item.resetValues,deletedBlocks:sum.deletedBlocks+item.deletedBlocks}),{deletedValues:0,resetValues:0,deletedBlocks:0});
  const pageCount=new Set(review?.impacts.map(item=>item.storyId)).size;
  const blocked=!!review?.blockers.length;
  return <Modal open={!!review} wide className="migration-dialog" title={review?`Review migration ${review.migration.version}`:'Review migration'} description="Review the schema and its effect on saved content before deployment." onClose={onClose}>
    {review && totals && <>
      <div className="migration-review">
        <ErrorNotice message={error} />
        <div className="migration-overview">
          <div className="migration-version"><span>Schema release</span><div><span>v{review.migration.baseVersion}</span><ArrowRight size={18} aria-hidden="true" /><strong>v{review.migration.version}</strong></div><p>{review.migration.name}</p></div>
          <div className={`migration-readiness ${blocked?'is-blocked':'is-ready'}`}>
            {blocked?<AlertTriangle size={20} aria-hidden="true" />:<CheckCircle2 size={20} aria-hidden="true" />}
            <div><strong>{blocked?`${review.blockers.length} ${review.blockers.length===1?'issue needs':'issues need'} attention`:review.destructive?'Ready with content removal':'Ready to deploy'}</strong><p>{blocked?(review.destructive?'Fix the remaining content or schema requirements below.':'Open the affected content below, or preview a destructive deployment.'):`${pageCount} ${pageCount===1?'page':'pages'} across ${review.impacts.filter(item=>item.target==='draft').length} page locales will use this schema.`}</p></div>
          </div>
        </div>

        <section className="migration-loss" aria-label="Content impact">
          <div className="migration-section-heading"><h3>Content impact</h3><span>{review.destructive?'Destructive deployment':'Standard deployment'}</span></div>
          <dl><div><dt>Values deleted</dt><dd>{totals.deletedValues}</dd></div><div><dt>Values reset</dt><dd>{totals.resetValues}</dd></div><div><dt>Blocks deleted</dt><dd>{totals.deletedBlocks}</dd></div></dl>
          <p>Drafts and publications are counted separately. Deleted blocks include all their fields and descendants. Earlier content remains in history; restoring it applies the current schema.</p>
        </section>

        {blocked && <section aria-label="Migration issues" className="migration-issues">
          <div className="migration-section-heading"><h3>{review.destructive?'Still needs attention':'Content that needs attention'}</h3><span className="pill pill--red">{review.blockers.length}</span></div>
          <p className="field-hint">{review.destructive?'Deletion cannot resolve these requirements. Fix the content or schema before deploying.':'These saved blocks do not meet the proposed schema.'} Published issues require fixing and publishing the draft, or changing the schema.</p>
          <ul>{review.blockers.map((issue,index)=><li key={index}>
            <AlertTriangle size={16} aria-hidden="true" />
            <div><div className="migration-issue-title"><strong>{issue.storyName ?? issue.path}</strong>{issue.target && <span className="pill pill--outline">{issue.target==='draft'?'Draft':'Published'}</span>}</div>
              {issue.storyId && <p className="migration-location">{issue.localeName} {issue.blockName && <> / {issue.blockName}</>}{issue.field && <> / <code>{issue.field}</code></>}</p>}
              <p>{issue.message}</p>
            </div>
            {issue.storyId && <a href={storyUrl({spaceId:review.migration.spaceId,storyId:issue.storyId,localeSlug:issue.localeSlug,blockId:issue.blockId})} target="_blank" rel="noreferrer" aria-label={`Open ${issue.blockName ?? 'page'} on ${issue.storyName}, ${issue.localeName}, ${issue.target} issue (new tab)`}>{issue.blockId?'Open block':'Open page'}<ExternalLink size={13} aria-hidden="true" /></a>}
          </li>)}</ul>
        </section>}

        {canDeploy && (blocked || review.destructive) && <section className={`migration-destructive ${review.destructive?'is-active':''}`} aria-label="Destructive deployment">
          <Trash2 size={20} aria-hidden="true" /><div><h3>{review.destructive?'Destructive preview is active':'Apply with content removal'}</h3><p>Remove blocks that are no longer allowed, trim blocks over the new limit, and reset invalid field values. Missing required content and invalid schema rules still need to be fixed.</p><Button variant={review.destructive?'secondary':'danger'} disabled={busy} onClick={()=>onInspect(!review.destructive)}>{review.destructive?'Back to standard review':'Preview destructive deployment'}</Button></div>
        </section>}

        <MigrationDiff changes={review.changes} emptyMessage={review.migration.baseVersion===0?'Existing blocks will move to the current schema definitions.':'No schema differences remain. Deployment records this workspace as the next migration version.'} />

        <details className="migration-affected"><summary><ChevronRight size={15} aria-hidden="true" />Affected pages and locales<span>{pageCount} pages</span></summary>
          <div className="migration-table-scroll"><table><caption className="sr-only">Content loss in each draft and publication</caption><thead><tr><th>Page / locale</th><th>Version</th><th>Values deleted</th><th>Values reset</th><th>Blocks deleted</th></tr></thead><tbody>{review.impacts.map(item=><tr key={`${item.localeId}:${item.target}`}><td><a href={storyUrl({spaceId:review.migration.spaceId,storyId:item.storyId,localeSlug:item.localeSlug})} target="_blank" rel="noreferrer">{item.name}<ExternalLink size={12} aria-label="Opens in a new tab" /></a><span>{item.locale}</span></td><td>{item.target==='draft'?'Draft':'Published'}</td><td>{item.deletedValues}</td><td>{item.resetValues}</td><td>{item.deletedBlocks}</td></tr>)}</tbody></table></div>
        </details>
      </div>
      <footer className="migration-review-footer">
        {confirming ? <form className="migration-confirmation" onSubmit={event=>{event.preventDefault();if(confirmation===review.confirmation)onDeploy(confirmation)}}>
          <h3><AlertTriangle size={18} aria-hidden="true" />Confirm data loss</h3>
          <p>This deploys migration {review.migration.version} to everyone and deletes {totals.deletedValues} values and {totals.deletedBlocks} blocks, and resets {totals.resetValues} values in drafts and publications. Unsaved drafts are not published.</p>
          <label className="field" htmlFor="migration-confirmation">Type <strong>{review.confirmation}</strong> to confirm<input id="migration-confirmation" autoFocus autoComplete="off" spellCheck={false} value={confirmation} onChange={event=>setConfirmation(event.target.value)} disabled={busy} /></label>
          <div className="button-group"><Button disabled={busy} onClick={()=>{setConfirming(false);setConfirmation('')}}>Cancel</Button><Button type="submit" variant="danger" disabled={busy || confirmation!==review.confirmation}>{busy?'Deploying…':'Confirm and deploy'}</Button></div>
        </form> : <><p>{!canDeploy?'An administrator can deploy this migration.':blocked?'Resolve the remaining issues to deploy.':'Deployment updates saved drafts and live content.'}</p><div className="button-group"><Button disabled={busy} onClick={()=>onInspect(review.destructive)}><RefreshCw size={14} aria-hidden="true" />Refresh review</Button>{canDeploy && <Button variant={review.destructive?'danger':'primary'} disabled={busy || blocked} onClick={()=>review.confirmation?setConfirming(true):onDeploy('')}>{busy?'Working…':review.confirmation?'Continue to confirmation':'Deploy migration'}</Button>}</div></>}
      </footer>
    </>}
  </Modal>;
}
