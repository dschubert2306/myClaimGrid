import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { MAX_DOCUMENTS_PER_ENTRY } from '@myclaimgrid/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { formatFileSize, validateDocument } from '../core/file-validation';
import { LanguageService } from '../core/language.service';
import { ButtonComponent } from './button.component';
import { IconComponent } from './icon.component';

/**
 * Several insurer documents (PDF, JPG, PNG) for one history entry: the Dropzone markup with a
 * file list above it. Only valid files reach `files`, problems are named below the drop area.
 */
@Component({
  selector: 'mcg-document-picker',
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
      @for (chosen of files(); track $index) {
        <div class="mcg-file">
          <mcg-icon name="file" />
          <span class="mcg-file__name">{{ chosen.name }}</span>
          <span class="mcg-muted mcg-num" style="font-size: 13px">{{ size(chosen) }}</span>
          <button
            mcg-button
            variant="ghost"
            [iconOnly]="true"
            [disabled]="disabled()"
            [attr.aria-label]="'entry.removeFile' | transloco: { name: chosen.name }"
            (click)="remove($index)"
          >
            <mcg-icon name="close" />
          </button>
        </div>
      }
      @if (files().length < max) {
        <div
          class="mcg-drop app-drop--compact"
          [class.mcg-drop--over]="over()"
          [class.mcg-drop--error]="problems().length > 0"
          role="button"
          tabindex="0"
          [attr.aria-label]="'entry.dropTitle' | transloco"
          [attr.aria-describedby]="problems().length > 0 ? 'documents-error' : null"
          (click)="picker.click()"
          (keydown.enter)="picker.click()"
          (keydown.space)="$event.preventDefault(); picker.click()"
        >
          <mcg-icon name="upload" />
          <div class="mcg-drop__title">
            {{ (over() ? 'dialog.dropOver' : 'entry.dropTitle') | transloco }}
          </div>
          <div class="mcg-drop__meta">{{ 'entry.dropMeta' | transloco }}</div>
          <input
            #picker
            type="file"
            multiple
            accept="application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png"
            hidden
            data-testid="document-input"
            (click)="$event.stopPropagation()"
            (change)="onPick($event)"
          />
        </div>
      }
      @if (problems().length > 0) {
        <span id="documents-error" class="mcg-field__error" role="alert">{{ problemText() }}</span>
      }
    </div>
  `,
})
export class DocumentPickerComponent {
  private readonly i18n = inject(TranslocoService);
  private readonly language = inject(LanguageService);

  readonly files = model<File[]>([]);
  readonly disabled = input(false);
  protected readonly max = MAX_DOCUMENTS_PER_ENTRY;
  protected readonly over = signal(false);
  protected readonly problems = signal<('type' | 'size' | 'count')[]>([]);

  protected readonly problemText = computed(() => {
    this.language.lang();
    const keys = {
      type: 'errors.documentType',
      size: 'errors.fileSize',
      count: 'entry.tooManyFiles',
    };
    return [...new Set(this.problems())].map((p) => this.i18n.translate(keys[p])).join(' ');
  });

  protected size(file: File): string {
    return formatFileSize(file.size, this.language.locale());
  }

  protected onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.accept([...(input.files ?? [])]);
    input.value = '';
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.over.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.over.set(false);
    if (!this.disabled()) this.accept([...(event.dataTransfer?.files ?? [])]);
  }

  protected remove(index: number): void {
    this.files.update((list) => list.filter((_, i) => i !== index));
    this.problems.set([]);
  }

  private accept(candidates: File[]): void {
    const problems: ('type' | 'size' | 'count')[] = [];
    const next = [...this.files()];
    for (const file of candidates) {
      const problem = validateDocument(file);
      if (problem) problems.push(problem);
      else if (next.length >= this.max) problems.push('count');
      else next.push(file);
    }
    this.problems.set(problems);
    this.files.set(next);
  }
}
