import type { ReactNode } from 'react';
import { DismissibleSheet } from '../../../packages/portable/react/DismissibleSheet';
import { Icon } from './Icon';
const classes = { portal: 'today-page person-picker-portal', dialog: 'person-picker-sheet', drag: 'person-picker-drag', handle: 'person-picker-handle', head: 'person-picker-head', close: 'icon-btn' };
export function PersonPickerSheet({ children, onClose }: { children: ReactNode; onClose(): void }) {
  return <DismissibleSheet classes={classes} label="사람 선택" closeLabel="사람 선택 닫기" closeIcon={<Icon name="close" />} onClose={onClose}>{children}</DismissibleSheet>;
}
