'use client';

import type { BlockDefinition } from '@storypane/core';
import { Field } from '@storypane/ui';
import { OptionInput } from '../editor/option-input';
import { definitionDescendants, definitionTreeRows } from './definition-tree';

export function ParentBlockPicker({
  definitions,
  definitionId,
  value,
  onChange,
  disabled,
}: {
  definitions: BlockDefinition[];
  definitionId?: string;
  value?: string | null;
  onChange: (id: string | null) => void;
  disabled: boolean;
}) {
  const excluded = definitionId
    ? definitionDescendants(definitions, definitionId)
    : new Set<string>();
  const rows = definitionTreeRows(definitions);
  return (
    <Field
      label="Parent block"
      htmlFor="definition-parent"
      description="Parent changes save immediately for existing blocks. Allowed blocks fields still control where this block can be used."
    >
      <OptionInput
        id="definition-parent"
        label="Parent block"
        source={{
          type: 'inline',
          items: [
            { value: 'root', label: 'No parent' },
            ...rows
              .filter(({ definition }) => !excluded.has(definition.id))
              .map(({ definition, depth }) => ({
                value: definition.id,
                label: `${'— '.repeat(depth)}${definition.displayName} (${definition.name})`,
              })),
          ],
        }}
        value={value ?? 'root'}
        disabled={disabled}
        onChange={(next) => onChange(typeof next === 'string' && next !== 'root' ? next : null)}
      />
    </Field>
  );
}
