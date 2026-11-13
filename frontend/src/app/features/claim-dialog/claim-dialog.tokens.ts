import { InjectionToken } from '@angular/core';

export interface ClaimDialogData {
  /** Set to edit an existing claim, empty for a new one. */
  claimId?: string;
}
export type ClaimDialogResult = 'saved' | 'deleted' | 'cancelled';

export const CLAIM_DIALOG_DATA = new InjectionToken<ClaimDialogData>('CLAIM_DIALOG_DATA');

export class ClaimDialogRef {
  constructor(readonly close: (result: ClaimDialogResult) => void) {}
}
