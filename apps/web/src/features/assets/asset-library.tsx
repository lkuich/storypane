'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, ChevronRight, FileText, Folder, FolderPlus, Grid2X2, ImageIcon, List, MoreHorizontal, Play, Search, Upload, UploadCloud } from 'lucide-react';
import type { AssetFolder, AssetRecord } from '@blok/assets';
import { assetApi, assetContentUrl, assetThumbnailUrl, formatBytes } from './api';
import { useAssetUploads } from './upload';
import './assets.css';

export interface AssetLibraryProps { onSelect?: (asset: AssetRecord)=>void }

export function AssetLibrary({onSelect}:AssetLibraryProps={}) {
  const [items,setItems]=useState<AssetRecord[]>([]),[folders,setFolders]=useState<AssetFolder[]>([]);
  const [folderId,setFolderId]=useState<string|null>(null),[search,setSearch]=useState(''),[cursor,setCursor]=useState<string|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[list,setList]=useState(false);
  const [selected,setSelected]=useState<AssetRecord|null>(null),[folderName,setFolderName]=useState(''),[creatingFolder,setCreatingFolder]=useState(false);
  const requestId=useRef(0), current=folders.find(f=>f.id===folderId), parent=folders.find(f=>f.id===current?.parentId);
  const searchId=useId();
  const uploads=useAssetUploads(), zone=useRef<HTMLDivElement>(null), fileInput=useRef<HTMLInputElement>(null), dragDepth=useRef(0);
  const [dragActive,setDragActive]=useState(false);
  useEffect(()=>{uploads.setHost(zone.current);return()=>uploads.setHost(null);},[uploads.setHost]);
  const load=useCallback(async(next?:string)=>{
    const request=++requestId.current; setLoading(true);setError('');
    try {
      const query=new URLSearchParams();if(search)query.set('search',search);if(folderId)query.set('folder',folderId);if(next)query.set('cursor',next);
      const [result,folderResult]=await Promise.all([assetApi<{items:AssetRecord[];nextCursor:string|null}>(`?${query}`),assetApi<{items:AssetFolder[]}>('/folders')]);
      if(request!==requestId.current)return;
      setItems(old=>next?[...old,...result.items]:result.items);setCursor(result.nextCursor);setFolders(folderResult.items);
    }catch(cause){if(request===requestId.current)setError(cause instanceof Error?cause.message:'Could not load assets');}
    finally{if(request===requestId.current)setLoading(false);}
  },[search,folderId]);
  useEffect(()=>{const timer=setTimeout(()=>void load(),180);return()=>{clearTimeout(timer);requestId.current++;};},[load,uploads.revision]);
  async function createFolder(event:React.FormEvent) {
    event.preventDefault();try{await assetApi('/folders',{method:'POST',body:JSON.stringify({name:folderName,parentId:folderId})});setFolderName('');setCreatingFolder(false);await load();}catch(cause){setError(cause instanceof Error?cause.message:'Could not create folder');}
  }
  async function renameFolder() {
    if(!current)return;const name=window.prompt('Folder name',current.name);if(!name)return;
    try{await assetApi(`/folders/${current.id}`,{method:'PATCH',body:JSON.stringify({name})});await load();}catch(cause){setError(cause instanceof Error?cause.message:'Could not rename folder');}
  }
  async function removeFolder() {
    if(!current||!window.confirm('Remove this folder and its subfolders? Assets will be kept.'))return;
    try{await assetApi(`/folders/${current.id}`,{method:'DELETE'});setFolderId(current.parentId);await load();}catch(cause){setError(cause instanceof Error?cause.message:'Could not remove folder');}
  }
  const shownFolders=folders.filter(f=>f.parentId===folderId);
  return <div className="asset-library" ref={zone}
    onDragEnter={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();dragDepth.current++;setDragActive(true);}}}
    onDragOver={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';}}}
    onDragLeave={event=>{if(event.dataTransfer.types.includes('Files')){dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragActive(false);}}}
    onDrop={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();dragDepth.current=0;setDragActive(false);uploads.enqueue(Array.from(event.dataTransfer.files),folderId);}}}>
    <input ref={fileInput} type="file" tabIndex={-1} multiple className="asset-file-input" aria-label="Choose files to upload" onChange={event=>{uploads.enqueue(Array.from(event.target.files??[]),folderId);event.target.value='';}} />
    {dragActive&&<div className="asset-drop-overlay" role="status"><UploadCloud aria-hidden="true"/><strong>Drop files to upload</strong><span>{current?`Add to ${current.name}`:'Add to your asset library'}</span></div>}
    <header className="asset-heading"><div>{onSelect?<h2>Asset library</h2>:<h1>Assets</h1>}<p>Upload, organize, and find the right asset for your story.</p></div><div className="asset-actions">{!current?.parentId&&<button className="button secondary" onClick={()=>setCreatingFolder(!creatingFolder)}><FolderPlus aria-hidden="true" />New folder</button>}<button className="button button--primary" onClick={()=>fileInput.current?.click()}><Upload aria-hidden="true" />Upload files</button></div></header>
    <nav className="asset-breadcrumbs" aria-label="Asset folders"><button onClick={()=>setFolderId(null)} aria-current={!folderId?'page':undefined}><ImageIcon aria-hidden="true" />All assets</button>{parent&&<><ChevronRight aria-hidden="true" /><button onClick={()=>setFolderId(parent.id)}>{parent.name}</button></>}{current&&<><ChevronRight aria-hidden="true" /><span aria-current="page">{current.name}</span></>}{current&&<span className="asset-folder-tools"><button onClick={()=>void renameFolder()}>Rename</button><button onClick={()=>void removeFolder()}>Remove folder</button></span>}</nav>
    {creatingFolder&&<form onSubmit={createFolder} className="asset-folder-form"><label className="field">Folder name<input autoFocus maxLength={100} value={folderName} onChange={e=>setFolderName(e.target.value)} required /></label><button className="button" type="submit">Create folder</button><button className="button secondary" type="button" onClick={()=>setCreatingFolder(false)}>Cancel</button></form>}
    {shownFolders.length>0&&<section className="asset-folder-section"><div className="asset-section-heading"><h2>Folders</h2><span>{shownFolders.length}</span></div><div className="asset-folders">{shownFolders.map(f=><button key={f.id} onClick={()=>setFolderId(f.id)}><span className="asset-folder-icon"><Folder aria-hidden="true" /></span><span>{f.name}</span><ArrowUpRight aria-hidden="true" /></button>)}</div></section>}
    <div className="asset-toolbar"><label htmlFor={searchId} className="asset-search"><span className="sr-only">Search assets</span><Search aria-hidden="true" /><input id={searchId} type="search" placeholder="Search assets…" value={search} onChange={e=>setSearch(e.target.value)} /></label><span className="asset-drop-hint">Drag files here to upload</span>{uploads.count>0&&<button type="button" className="button button--ghost button--small" onClick={uploads.show}><Upload aria-hidden="true"/>Uploads ({uploads.count})</button>}<span className="asset-count">{items.length}{cursor?'+':''} assets</span><div className="asset-view-toggle" aria-label="Library view"><button aria-label="Grid" title="Grid view" aria-pressed={!list} onClick={()=>setList(false)}><Grid2X2 aria-hidden="true" /></button><button aria-label="List" title="List view" aria-pressed={list} onClick={()=>setList(true)}><List aria-hidden="true" /></button></div></div>
    {error&&<div role="alert" className="asset-error">{error} <button onClick={()=>void load()}>Retry</button></div>}
    {loading&&items.length===0&&<p role="status" className="asset-empty">Loading your library…</p>}
    {!loading&&items.length===0&&!error&&<div className="asset-empty"><span className="asset-empty-icon"><UploadCloud aria-hidden="true" /></span><h3>{search?'No matching assets':'Your library starts here'}</h3><p>{search?'Try a different search.':'Drag and drop images, videos, or documents anywhere here to upload.'}</p><button className="button button--primary" onClick={()=>fileInput.current?.click()}><Upload aria-hidden="true" />Browse files</button><small>Images, videos, and documents · Up to 1 GiB per file</small></div>}
    <div className={`asset-grid ${list?'asset-list':''}`} aria-busy={loading}>{items.map(item=><article className="asset-card" key={item.id}>
      <button className="asset-card-open" onClick={()=>onSelect?onSelect(item):setSelected(item)} aria-label={onSelect?`Select ${item.title}`:`Edit ${item.title}`}>
        <AssetPreview asset={item} size={list?160:320}/><div className="asset-card-copy"><strong>{item.title}</strong><span><span className="asset-file-type">{item.filename.split('.').pop()?.toUpperCase()||'FILE'}</span><span aria-hidden>·</span> {formatBytes(item.byteSize)}</span>{item.tags.length>0&&<div className="asset-tags">{item.tags.slice(0,3).map(tag=><span key={tag}>{tag}</span>)}</div>}</div>
      </button>{onSelect&&<button className="asset-info" aria-label={`Details for ${item.title}`} onClick={()=>setSelected(item)}><MoreHorizontal aria-hidden="true" /></button>}
    </article>)}</div>
    {cursor&&<div className="asset-load-more"><button className="button secondary" disabled={loading} onClick={()=>void load(cursor)}>{loading?'Loading…':'Load more'}</button></div>}
    {selected&&<AssetDetails asset={selected} folders={folders} onClose={()=>{setSelected(null);void load();}} onChanged={()=>{setSelected(null);void load();}} />}
  </div>;
}

export function AssetPreview({asset,large=false,size=320}:{asset:AssetRecord;large?:boolean;size?:160|320}) {
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[asset.id]);
  if(asset.mimeType.startsWith('image/'))return <div className="asset-preview">{failed?<span className="asset-preview-unavailable"><ImageIcon aria-hidden="true"/>Preview unavailable</span>:<img src={assetThumbnailUrl(asset.id,large?1280:size)} srcSet={large?undefined:`${assetThumbnailUrl(asset.id,size)} 1x, ${assetThumbnailUrl(asset.id,size===160?320:640)} 2x`} alt={asset.alt||asset.title} loading="lazy" decoding="async" onError={()=>setFailed(true)} />}</div>;
  if(asset.mimeType.startsWith('video/'))return <div className="asset-preview asset-video">{large?<video src={assetContentUrl(asset.id)} controls preload="metadata" aria-label={asset.title}/>:<><span className="asset-preview-icon"><Play aria-hidden="true" /></span><small>VIDEO</small></>}</div>;
  return <div className="asset-preview asset-document"><span className="asset-preview-icon"><FileText aria-hidden="true" /></span><small>{asset.filename.split('.').pop()?.toUpperCase()||'FILE'}</small></div>;
}

function AssetDetails({asset,folders,onClose,onChanged}:{asset:AssetRecord;folders:AssetFolder[];onClose:()=>void;onChanged:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),id=useId();
  const [title,setTitle]=useState(asset.title),[alt,setAlt]=useState(asset.alt),[notes,setNotes]=useState(asset.notes),[tags,setTags]=useState(asset.tags.join(', '));
  const [placements,setPlacements]=useState(asset.folderIds),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  async function save(event:React.FormEvent) {
    event.preventDefault();setBusy(true);setError('');
    try{await assetApi(`/${asset.id}`,{method:'PATCH',body:JSON.stringify({title,alt,notes,tags:tags.split(',').map(t=>t.trim()).filter(Boolean)})});onChanged();}
    catch(cause){setError(cause instanceof Error?cause.message:'Could not save metadata');}finally{setBusy(false);}
  }
  async function placement(folderId:string,checked:boolean) {
    setBusy(true);try{await assetApi(`/${asset.id}/folders${checked?'':`/${folderId}`}`,{method:checked?'POST':'DELETE',...(checked?{body:JSON.stringify({folderId})}:{})});setPlacements(old=>checked?[...old,folderId]:old.filter(f=>f!==folderId));}catch(cause){setError(cause instanceof Error?cause.message:'Could not update folders');}finally{setBusy(false);}
  }
  async function archive(){if(!window.confirm('Archive this asset? Existing story references will continue to work.'))return;setBusy(true);try{await assetApi(`/${asset.id}`,{method:'DELETE'});onChanged();}catch(cause){setError(cause instanceof Error?cause.message:'Could not archive');setBusy(false);}}
  return <dialog ref={dialog} className="asset-dialog" aria-labelledby={id} onCancel={onClose}>
    <header><div><span className="asset-eyebrow">ASSET DETAILS</span><h2 id={id}>{asset.title}</h2></div><button className="button secondary" onClick={onClose} aria-label="Close asset details">Close</button></header>
    <div className="asset-detail-layout"><div><AssetPreview asset={asset} large/><p>{asset.filename} · {formatBytes(asset.byteSize)}</p><a className="button secondary" href={assetContentUrl(asset.id)} download={asset.filename}>Download original</a></div>
      <form onSubmit={save}><label className="field">Title<input value={title} maxLength={200} onChange={e=>setTitle(e.target.value)} required /></label>{asset.mimeType.startsWith('image/')&&<label className="field">Default alt text<input value={alt} maxLength={1000} onChange={e=>setAlt(e.target.value)} /><small>Describe the image for people using screen readers.</small></label>}<label className="field">Notes<textarea value={notes} maxLength={5000} onChange={e=>setNotes(e.target.value)} rows={3}/></label><label className="field">Tags<input value={tags} onChange={e=>setTags(e.target.value)} placeholder="campaign, summer, product" /><small>Separate tags with commas.</small></label>
      {folders.length>0&&<fieldset><legend>Folders</legend>{folders.map(f=><label key={f.id} className="asset-folder-check"><input type="checkbox" checked={placements.includes(f.id)} disabled={busy} onChange={e=>void placement(f.id,e.target.checked)}/>{f.name}</label>)}</fieldset>}
      {error&&<p className="asset-error" role="alert">{error}</p>}<div className="asset-actions"><button type="submit" className="button" disabled={busy}>Save details</button><button type="button" className="button subtle" disabled={busy} onClick={()=>void archive()}>Archive</button></div></form></div>
  </dialog>;
}
