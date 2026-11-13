import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { Injectable, Injector, inject } from '@angular/core';
import { ClaimDialogComponent } from './claim-dialog.component';
import {
  CLAIM_DIALOG_DATA,
  ClaimDialogRef,
  type ClaimDialogData,
  type ClaimDialogResult,
} from './claim-dialog.tokens';

export type { ClaimDialogData, ClaimDialogResult };

/** Opens the claim dialog in a CDK overlay (scroll lock, focus trap and focus restore live in the component). */
@Injectable({ providedIn: 'root' })
export class ClaimDialogService {
  private readonly overlay = inject(Overlay);
  private readonly injector = inject(Injector);

  open(data: ClaimDialogData): Promise<ClaimDialogResult> {
    return new Promise((resolve) => {
      const overlayRef = this.overlay.create({
        hasBackdrop: false, // the dialog draws its own scrim (.mcg-scrim)
        scrollStrategy: this.overlay.scrollStrategies.block(),
        positionStrategy: this.overlay.position().global(),
        panelClass: 'app-dialog-pane',
      });
      const ref = new ClaimDialogRef((result) => {
        overlayRef.dispose();
        resolve(result);
      });
      const injector = Injector.create({
        parent: this.injector,
        providers: [
          { provide: CLAIM_DIALOG_DATA, useValue: data },
          { provide: ClaimDialogRef, useValue: ref },
        ],
      });
      overlayRef.attach(new ComponentPortal(ClaimDialogComponent, null, injector));
    });
  }
}
