import { MarkdownView, Notice, Plugin } from 'obsidian';
import { registerCommands } from './commands';
import {
	renderCustomContainers,
	restoreCustomContainers,
} from './render/custom-container';
import {
	DEFAULT_SETTINGS,
	DgsToolkitSettingTab,
	type DgsToolkitSettings,
} from './settings';

export default class DgsToolkitPlugin extends Plugin {
	settings!: DgsToolkitSettings;
	private poemObserver: MutationObserver | null = null;
	private readonly disabledReadingViews = new WeakSet<HTMLElement>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.applyTypographySettings();

		this.registerMarkdownPostProcessor((element) => {
			if (!this.shouldRenderCustomContainers(element)) return;
			renderCustomContainers(element, this.settings.defaultType);
		});

		registerCommands(this);
		this.addSettingTab(new DgsToolkitSettingTab(this.app, this));
		this.observePoems();
		this.renderMountedPoems();
	}

	onunload(): void {
		this.poemObserver?.disconnect();
		this.poemObserver = null;
		this.clearTypographySettings();
	}

	private clearTypographySettings(): void {
		const workspace = this.app.workspace.containerEl;
		workspace.removeClasses(['dgs-page-typography', 'dgs-editor-typography']);
		for (const property of [
			'--dgs-font-size',
			'--dgs-letter-spacing',
			'--dgs-word-spacing',
			'--dgs-line-height',
			'--dgs-paragraph-spacing',
			'--dgs-editing-font-size',
			'--dgs-editing-letter-spacing',
			'--dgs-editing-word-spacing',
			'--dgs-editing-line-height',
			'--dgs-editing-paragraph-spacing',
		]) {
			workspace.style.removeProperty(property);
		}
	}

	private observePoems(): void {
		this.poemObserver = new MutationObserver((mutations) => {
			if (!this.settings.enableCustomContainers) return;
			const previews = new Set<HTMLElement>();
			for (const mutation of mutations) {
				const mutationElement = mutation.target.instanceOf(HTMLElement)
					? mutation.target
					: mutation.target.parentElement;
				const mutationPreview = mutationElement?.closest<HTMLElement>(
					'.markdown-preview-sizer',
				);
				if (mutationPreview?.textContent?.includes(':::poem')) {
					previews.add(mutationPreview);
				}
				if (mutation.type === 'characterData') {
					const preview = mutation.target.parentElement?.closest<HTMLElement>(
						'.markdown-preview-sizer',
					);
					if (preview?.textContent?.includes(':::poem')) previews.add(preview);
				}
				for (const node of Array.from(mutation.addedNodes)) {
					if (!node.instanceOf(HTMLElement)) continue;
					const preview = node.closest<HTMLElement>('.markdown-preview-sizer');
					if (preview?.textContent?.includes(':::poem')) previews.add(preview);
				}
			}

			for (const preview of previews) {
				if (!this.shouldRenderCustomContainers(preview)) continue;
				renderCustomContainers(preview, this.settings.defaultType);
			}
		});
		this.poemObserver.observe(this.app.workspace.containerEl, {
			childList: true,
			characterData: true,
			subtree: true,
		});
	}

	private shouldRenderCustomContainers(element: HTMLElement): boolean {
		if (!this.settings.enableCustomContainers) return false;
		const readingView = element.closest<HTMLElement>('.markdown-preview-view');
		return readingView === null || !this.disabledReadingViews.has(readingView);
	}

	private renderPreviewContainers(preview: HTMLElement): void {
		for (const block of Array.from(
			preview.querySelectorAll<HTMLElement>('.el-p'),
		)) {
			renderCustomContainers(block, this.settings.defaultType);
		}
		renderCustomContainers(preview, this.settings.defaultType);
	}

	toggleColonBlocksInActiveReadingView(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view === null || view.getMode() !== 'preview') {
			new Notice('Open a Markdown note in reading view first.');
			return;
		}
		if (!this.settings.enableCustomContainers) {
			new Notice('Enable colon blocks in the plugin settings first.');
			return;
		}

		const readingView = view.previewMode.containerEl;
		const preview = readingView.querySelector<HTMLElement>('.markdown-preview-sizer');
		if (this.disabledReadingViews.has(readingView)) {
			this.disabledReadingViews.delete(readingView);
			if (preview !== null) this.renderPreviewContainers(preview);
			new Notice('Colon blocks enabled in this reading view.');
			return;
		}

		this.disabledReadingViews.add(readingView);
		if (preview !== null) restoreCustomContainers(preview);
		new Notice('Colon blocks disabled in this reading view.');
	}

	private renderMountedPoems(): void {
		if (!this.settings.enableCustomContainers) return;
		for (const preview of Array.from(
			this.app.workspace.containerEl.querySelectorAll<HTMLElement>(
				'.markdown-preview-sizer',
			),
		)) {
			if (
				this.shouldRenderCustomContainers(preview) &&
				preview.textContent?.includes(':::poem')
			) {
				renderCustomContainers(preview, this.settings.defaultType);
			}
		}
	}

	refreshCustomContainers(): void {
		for (const preview of Array.from(
			this.app.workspace.containerEl.querySelectorAll<HTMLElement>(
				'.markdown-preview-sizer',
			),
		)) {
			const readingView = preview.closest<HTMLElement>('.markdown-preview-view');
			if (
				this.settings.enableCustomContainers &&
				(readingView === null || !this.disabledReadingViews.has(readingView))
			) {
				this.renderPreviewContainers(preview);
			} else {
				restoreCustomContainers(preview);
			}
		}
	}

	applyTypographySettings(): void {
		const workspace = this.app.workspace.containerEl;
		workspace.toggleClass('dgs-page-typography', this.settings.enableTypography);
		workspace.toggleClass('dgs-editor-typography', this.settings.enableEditingTypography);

		const values: Record<string, string | null> = {
			'--dgs-font-size': this.settings.enableTypography ? `${this.settings.fontSize}px` : null,
			'--dgs-letter-spacing': this.settings.enableTypography ? `${this.settings.letterSpacing}em` : null,
			'--dgs-word-spacing': this.settings.enableTypography ? `${this.settings.wordSpacing}em` : null,
			'--dgs-line-height': this.settings.enableTypography ? String(this.settings.lineHeight) : null,
			'--dgs-paragraph-spacing': this.settings.enableTypography ? `${this.settings.paragraphSpacing}em` : null,
			'--dgs-editing-font-size': this.settings.enableEditingTypography ? `${this.settings.editingFontSize}px` : null,
			'--dgs-editing-letter-spacing': this.settings.enableEditingTypography ? `${this.settings.editingLetterSpacing}em` : null,
			'--dgs-editing-word-spacing': this.settings.enableEditingTypography ? `${this.settings.editingWordSpacing}em` : null,
			'--dgs-editing-line-height': this.settings.enableEditingTypography ? String(this.settings.editingLineHeight) : null,
			'--dgs-editing-paragraph-spacing': this.settings.enableEditingTypography ? `${this.settings.editingParagraphSpacing}em` : null,
		};
		for (const [property, value] of Object.entries(values)) {
			if (value === null) workspace.style.removeProperty(property);
			else workspace.style.setProperty(property, value);
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<DgsToolkitSettings>,
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
