import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { formatFileSize, validatePdf } from '../core/file-validation';
import { LanguageService } from '../core/language.service';
import { ButtonComponent } from './button.component';
import { IconComponent } from './icon.component';

/** Drop target and file picker for the PDF. Only valid files reach `file`. */
@Component({
  selector: 'mcg-dropzone',
  imports: [TranslocoPipe, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="mcg-stack"
      style="gap: var(--space-2)"
      (dragover)="onDragOver($event)"
      (dragleave)="over.set(false)"
      (drop)="onDrop($event)"
    >
      @if (file(); as chosen) {
        <div class="mcg-file">
          <mcg-icon name="file" />
          <span class="mcg-file__name">{{ chosen.name }}</span>
          <span class="mcg-muted mcg-num" style="font-size: 13px">{{ size() }}</span>
          <button
            mcg-button
            variant="ghost"
            [iconOnly]="true"
            [attr.aria-label]="'dialog.removeFile' | transloco"
            (click)="remove()"
          >
            <mcg-icon name="close" />
          </button>
        </div>
      } @else {
        <div
          class="mcg-drop"
          [class.mcg-drop--over]="over()"
          [class.mcg-drop--error]="!!errorText()"
          role="button"
          tabindex="0"
          [attr.aria-describedby]="errorText() ? 'dropzone-error' : null"
          (click)="picker.click()"
          (keydown.enter)="picker.click()"
          (keydown.space)="$event.preventDefault(); picker.click()"
        >
          <mcg-icon name="upload" />
          <div class="mcg-drop__title">
            {{ (over() ? 'dialog.dropOver' : 'dialog.dropTitle') | transloco }}
          </div>
          @if (!over()) {
            <div class="mcg-drop__meta">{{ 'dialog.dropMeta' | transloco }}</div>
          }
          <input
            #picker
            type="file"
            accept="application/pdf,.pdf"
            hidden
            data-testid="pdf-input"
            (click)="$event.stopPropagation()"
            (change)="onPick($event)"
          />
        </div>
        @if (errorText()) {
          <span id="dropzone-error" class="mcg-field__error">{{ errorText() }}</span>
        }
      }
    </div>
  `,
})
export class DropzoneComponent {
  private readonly i18n = inject(TranslocoService);
  private readonly language = inject(LanguageService);

  readonly file = model<File | null>(null);
  /** Message from the parent, for example "choose a file" after a submit without one. */
  readonly error = input<string | null>(null);

  protected readonly over = signal(false);
  private readonly problem = signal<'type' | 'size' | null>(null);
  protected readonly errorText = computed(() => {
    this.language.lang();
    const problem = this.problem();
    if (problem)
      return this.i18n.translate(problem === 'type' ? 'errors.fileType' : 'errors.fileSize');
    return this.error();
  });
  protected readonly size = computed(() => {
    const chosen = this.file();
    return chosen ? formatFileSize(chosen.size, this.language.locale()) : '';
  });

  protected onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.accept(input.files?.[0] ?? null);
    input.value = ''; // the same file can be chosen again
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.over.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.over.set(false);
    this.accept(event.dataTransfer?.files?.[0] ?? null); // one file, a second drop replaces the first
  }

  protected remove(): void {
    this.file.set(null);
    this.problem.set(null);
  }

  private accept(candidate: File | null): void {
    if (!candidate) return;
    const problem = validatePdf(candidate);
    this.problem.set(problem);
    if (!problem) this.file.set(candidate);
  }
}
