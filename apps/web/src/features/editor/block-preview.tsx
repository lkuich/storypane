'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import { createPortal } from 'react-dom';
import { defaultFields, type BlockDefinition } from '@storypane/core';
import { blockTitle } from './block-navigation';
import { PreviewPanel, type ComponentPreview } from './preview-panel';

export function BlockPreview({
  definitions,
  ...preview
}: Omit<ComponentProps<typeof PreviewPanel>, 'component' | 'selectedId' | 'onSelect'> & {
  definitions: BlockDefinition[];
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let target: HTMLElement | null = null;
    function close() {
      clearTimeout(timer);
      target = null;
      setAnchor(null);
    }
    function enter(event: PointerEvent | FocusEvent) {
      if (event instanceof PointerEvent && event.pointerType === 'touch') return;
      const element = event.target instanceof Element ? event.target : null;
      if (element && popup.current?.contains(element)) {
        clearTimeout(timer);
        return;
      }
      const next = element?.closest<HTMLElement>('[data-preview-block], [data-preview-definition]');
      if (!next || next === target || next.matches(':disabled')) return;
      clearTimeout(timer);
      target = next;
      timer = setTimeout(() => setAnchor(next), 350);
    }
    function leave(event: PointerEvent | FocusEvent) {
      const next = event.relatedTarget;
      if (next instanceof Node && (target?.contains(next) || popup.current?.contains(next))) return;
      clearTimeout(timer);
      target = null;
      timer = setTimeout(close, 150);
    }
    function key(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (popup.current) {
        event.preventDefault();
        event.stopPropagation();
      }
      close();
    }
    document.addEventListener('pointerover', enter);
    document.addEventListener('pointerout', leave);
    document.addEventListener('focusin', enter);
    document.addEventListener('focusout', leave);
    document.addEventListener('pointerdown', close);
    document.addEventListener('click', close);
    document.addEventListener('keydown', key, true);
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', enter);
      document.removeEventListener('pointerout', leave);
      document.removeEventListener('focusin', enter);
      document.removeEventListener('focusout', leave);
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, []);
  const definition = definitions.find((item) => item.id === anchor?.dataset.previewDefinition);
  const block = preview.snapshot.blocks.find((item) => item.id === anchor?.dataset.previewBlock);
  const component = useMemo<ComponentPreview | undefined>(() => {
    if (definition?.previewData)
      return {
        block: {
          ...defaultFields(definition),
          ...Object.fromEntries(
            definition.fields
              .filter((field) => field.type === 'blocks')
              .map((field) => [field.name, []]),
          ),
          ...definition.previewData,
          _uid: definition.id,
          component: definition.name,
        },
      };
    if (block) return { blockId: block.id };
  }, [definition, block]);
  const visible = !!(anchor?.isConnected && component);
  useLayoutEffect(() => {
    if (!visible || !anchor) return;
    popup.current?.showPopover();
    const trigger = anchor.contains(document.activeElement)
      ? document.activeElement!
      : (anchor.querySelector('.entity-title, .tree-item') ?? anchor);
    const describedBy = trigger.getAttribute('aria-describedby');
    trigger.setAttribute('aria-describedby', [describedBy, id].filter(Boolean).join(' '));
    return () => {
      if (describedBy) trigger.setAttribute('aria-describedby', describedBy);
      else trigger.removeAttribute('aria-describedby');
    };
  }, [visible, anchor, id]);
  if (!visible) return null;
  const bounds = anchor!.getBoundingClientRect();
  const width = Math.min(420, window.innerWidth - 24);
  const beside = bounds.left >= width + 20 || bounds.right + width + 20 <= window.innerWidth;
  const left =
    bounds.left >= width + 20
      ? bounds.left - width - 8
      : Math.min(bounds.right + 8, window.innerWidth - width - 12);
  const top = Math.max(
    12,
    Math.min(
      beside ? bounds.top : bounds.top >= 340 ? bounds.top - 328 : bounds.bottom + 8,
      window.innerHeight - 328,
    ),
  );
  return createPortal(
    <div
      ref={popup}
      id={id}
      role="tooltip"
      popover="manual"
      className="block-hover-preview"
      style={{ left, top, width }}
      aria-label="Block preview"
    >
      <div className="block-hover-preview-heading">
        <strong>{definition?.displayName ?? blockTitle(preview.snapshot, block!)}</strong>
        <span>{definition ? 'Sample content' : 'Saved content'}</span>
      </div>
      <PreviewPanel
        {...preview}
        component={component}
        selectedId={null}
        onSelect={async () => {}}
      />
    </div>,
    anchor!.closest('dialog') ?? document.body,
  );
}
