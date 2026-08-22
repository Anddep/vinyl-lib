import { createSetupItem, deleteSetupItem, getSetup, updateSetupItem } from '../api/client';
import type { SetupItem } from '../types/collection';
import { ResourceScreen, type FieldDef } from './components/ResourceScreen';
import type { Column } from './components/DataTable';

/** Must match SETUP_ICONS on the server and the icons in ui/icons.tsx. */
const ICONS = ['turntable', 'cartridge', 'amplifier', 'speakers', 'cable'] as const;

const fields: FieldDef[] = [
  { key: 'icon', label: 'Icon', kind: 'select', options: ICONS, required: true },
  { key: 'label', label: 'Label', kind: 'text', required: true, placeholder: 'Turntable' },
  {
    key: 'value',
    label: 'Value',
    kind: 'text',
    required: true,
    placeholder: 'Technics SL-1200 MK2 · 1984',
  },
  { key: 'position', label: 'Sort order', kind: 'number' },
];

const columns: Column<SetupItem>[] = [
  { key: 'icon', header: 'Icon', render: (row) => row.icon },
  { key: 'label', header: 'Label', render: (row) => row.label },
  { key: 'value', header: 'Value', render: (row) => row.value },
  { key: 'position', header: 'Order', render: (row) => row.position ?? 0 },
];

export default function SetupPage(): JSX.Element {
  return (
    <ResourceScreen<SetupItem>
      title="Setup"
      description="The equipment rows in the What it all plays on section."
      noun="setup row"
      fields={fields}
      columns={columns}
      load={getSetup}
      create={createSetupItem}
      update={updateSetupItem}
      remove={deleteSetupItem}
      toForm={(row) => ({
        icon: row.icon,
        label: row.label,
        value: row.value,
        position: String(row.position ?? 0),
      })}
      describe={(row) => row.label}
    />
  );
}
