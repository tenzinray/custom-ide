/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { match } from '../../../../../base/common/glob.js';
import { relativePath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { renderMarkdown } from '../../../../../base/browser/markdownRenderer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ITextResourceEditorInput } from '../../../../../platform/editor/common/editor.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { TestPathService } from '../../../../test/browser/workbenchTestServices.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IPathService } from '../../../../../platform/path/common/pathService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IFileQuery, ISearchComplete, ISearchService } from '../../../../services/search/common/search.js';
import { PiChatFileLinkService } from '../../browser/PiChatFileLinkService.js';
import { decoratePiChatFileLinks, renderPiChatFileMarkdown } from '../../browser/body/PiChatFileLinks.js';
import { renderPiChatTool } from '../../browser/body/PiChatToolMessage.js';

suite('PiChatFileLinks', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let links: PiChatFileLinkService;
	let files: FileService;
	let resources: URI[];
	let queries: IFileQuery[];
	let opened: ITextResourceEditorInput[];
	let limitHit: boolean;

	setup(async () => {
		const instantiation = store.add(new TestInstantiationService());
		files = store.add(new FileService(new NullLogService()));
		const provider = store.add(new InMemoryFileSystemProvider());
		store.add(files.registerProvider('file', provider));
		resources = ['/repo-a/src/only.ts', '/repo-a/src/shared.ts', '/repo-a/test/shared.ts', '/repo-a/README.md', '/repo-a/LICENSE', '/repo-a/src/a b.ts', '/repo-b/src/only.ts', '/home/test/settings.json'].map(path => URI.file(path));
		for (const resource of resources) { await files.writeFile(resource, VSBuffer.fromString('test')); }
		queries = [];
		opened = [];
		limitHit = false;
		instantiation.stub(IFileService, files);
		instantiation.stub(ISearchService, new class extends mock<ISearchService>() {
			override async fileSearch(query: IFileQuery): Promise<ISearchComplete> {
				queries.push(query);
				const folder = query.folderQueries[0].folder;
				return { results: resources.filter(resource => {
					const relative = relativePath(folder, resource);
					return relative && !relative.startsWith('../') && match(query.includePattern!, relative);
				}).map(resource => ({ resource })), limitHit, messages: [] };
			}
		}());
		instantiation.stub(IEditorService, { openEditor: async input => { opened.push(input as ITextResourceEditorInput); return undefined; } });
		instantiation.stub(IPathService, new TestPathService(URI.file('/home/test')));
		instantiation.stub(INotificationService, new class extends mock<INotificationService>() {}());
		links = instantiation.createInstance(PiChatFileLinkService);
	});

	test('resolves relative paths and unique filenames using each chat repo, not another open project', async () => {
		const a = await links.resolve('src/only.ts', '/repo-a');
		const b = await links.resolve('only.ts', '/repo-b');
		const unique = await links.resolve('only.ts', '/repo-a');
		assert.deepStrictEqual([a?.resource.path, b?.resource.path, unique?.resource.path, ...queries.map(query => query.folderQueries[0].folder.path)], [
			'/repo-a/src/only.ts', '/repo-b/src/only.ts', '/repo-a/src/only.ts', '/repo-b', '/repo-a',
		]);
	});

	test('leaves duplicate, missing, and search-truncated filenames unresolved', async () => {
		const duplicate = await links.resolve('shared.ts', '/repo-a');
		const missing = await links.resolve('missing.ts', '/repo-a');
		limitHit = true;
		const truncated = await links.resolve('only.ts', '/repo-a');
		assert.deepStrictEqual([duplicate, missing, truncated], [undefined, undefined, undefined]);
	});

	test('does not favor a root filename over a duplicate in a nested folder', async () => {
		const rootFile = URI.file('/repo-a/only.ts');
		await files.writeFile(rootFile, VSBuffer.fromString('test'));
		resources.push(rootFile);
		assert.strictEqual(await links.resolve('only.ts', '/repo-a'), undefined);
		assert.strictEqual((await links.resolve('./only.ts', '/repo-a'))?.resource.path, '/repo-a/only.ts');
	});

	test('does not fall back from an explicit missing path to a similarly named file', async () => {
		assert.strictEqual(await links.resolve('wrong/only.ts', '/repo-a'), undefined);
		assert.strictEqual(queries.length, 0);
	});

	test('supports absolute paths, home paths, encoded paths and canonical line selections', async () => {
		const absolute = await links.resolve('/repo-b/src/only.ts:12:3', '/repo-a');
		const home = await links.resolve('~/settings.json', '/repo-a');
		const encoded = await links.resolve('src/a%20b.ts#L4-L9', '/repo-a');
		const uri = await links.resolve('file:///repo-b/src/only.ts#L7', '/repo-a');
		const basename = await links.resolve('only.ts:8', '/repo-a');
		assert.deepStrictEqual([absolute?.resource.path, absolute?.options?.selection, home?.resource.path, encoded?.resource.path, encoded?.options?.selection, uri?.resource.path, uri?.options?.selection, basename?.options?.selection], [
			'/repo-b/src/only.ts', { startLineNumber: 12, startColumn: 3 }, '/home/test/settings.json', '/repo-a/src/a b.ts',
			{ startLineNumber: 4, startColumn: 1, endLineNumber: 9, endColumn: 1 }, '/repo-b/src/only.ts', { startLineNumber: 7, startColumn: 1, endLineNumber: undefined, endColumn: undefined }, { startLineNumber: 8, startColumn: 1 },
		]);
	});

	test('does not treat external URLs, commands or fragment-only anchors as file references', async () => {
		assert.deepStrictEqual(await Promise.all(['https://example.test/file.ts', 'command:workbench.action.files.openFile', 'data:text/plain,file.ts', '#section', '123'].map(reference => links.resolve(reference, '/repo-a'))), [undefined, undefined, undefined, undefined, undefined]);
		assert.strictEqual(queries.length, 0);
	});

	test('shares repeated streaming lookups without mixing repos', async () => {
		await Promise.all([links.resolve('only.ts', '/repo-a'), links.resolve('only.ts', '/repo-a'), links.resolve('only.ts', '/repo-b')]);
		assert.deepStrictEqual(queries.map(query => query.folderQueries[0].folder.path), ['/repo-a', '/repo-b']);
	});

	test('decorates prose and inline code, preserves full text, and opens through the editor service', async () => {
		const rendered = store.add(renderPiChatFileMarkdown({ render: renderMarkdown }, 'See `only.ts`, shared.ts, README.md, and `LICENSE`. Also [source](src/only.ts#L3) and [web](https://example.test/only.ts).\n\n```ts\nonly.ts\n```', '/repo-a'));
		rendered.element.classList.add('pi-chat-assistant-text');
		const original = rendered.element.textContent;
		decoratePiChatFileLinks(rendered.element, '/repo-a', links, NullHoverService, store.add(new DisposableStore()));
		await timeout(0);
		const anchors = Array.from(rendered.element.querySelectorAll<HTMLAnchorElement>('a.pi-chat-file-link'));
		assert.deepStrictEqual({ text: rendered.element.textContent, links: anchors.map(anchor => anchor.textContent), codeBlockLinks: rendered.element.querySelectorAll('pre a').length, web: rendered.element.querySelector('a[data-href^="https:"]')?.textContent }, {
			text: original, links: ['only.ts', 'README.md', 'LICENSE', 'source'], codeBlockLinks: 0, web: 'web',
		});
		anchors.find(anchor => anchor.textContent === 'source')!.click();
		assert.deepStrictEqual({ path: opened[0]?.resource.path, selection: opened[0]?.options?.selection, pinned: opened[0]?.options?.pinned }, {
			path: '/repo-a/src/only.ts', selection: { startLineNumber: 3, startColumn: 1, endLineNumber: undefined, endColumn: undefined }, pinned: true,
		});
	});

	test('removes ambiguous explicit links rather than opening a guessed file', async () => {
		const rendered = store.add(renderPiChatFileMarkdown({ render: renderMarkdown }, '[shared.ts](shared.ts)', '/repo-a'));
		rendered.element.classList.add('pi-chat-assistant-text');
		decoratePiChatFileLinks(rendered.element, '/repo-a', links, NullHoverService, store.add(new DisposableStore()));
		await timeout(0);
		assert.deepStrictEqual({ text: rendered.element.textContent, links: rendered.element.querySelectorAll('a').length }, { text: 'shared.ts', links: 0 });
	});

	test('keeps bare and explicit Markdown targets distinct even when their normalized URLs match', async () => {
		const rootFile = URI.file('/repo-a/only.ts');
		await files.writeFile(rootFile, VSBuffer.fromString('test'));
		resources.push(rootFile);
		const rendered = store.add(renderPiChatFileMarkdown({ render: renderMarkdown }, '[bare](only.ts) and [explicit](./only.ts)', '/repo-a'));
		rendered.element.classList.add('pi-chat-assistant-text');
		decoratePiChatFileLinks(rendered.element, '/repo-a', links, NullHoverService, store.add(new DisposableStore()));
		await timeout(0);
		assert.deepStrictEqual(Array.from(rendered.element.querySelectorAll('a'), anchor => anchor.textContent), ['explicit']);
	});

	test('links file tool targets with spaces without toggling their disclosure when clicked', async () => {
		const root = mainWindow.document.createElement('div');
		renderPiChatTool(root, { id: 'tool', role: 'assistant', kind: 'tool', toolName: 'read', input: 'src/a b.ts', output: 'file content', state: 'completed' });
		decoratePiChatFileLinks(root, '/repo-a', links, NullHoverService, store.add(new DisposableStore()));
		await timeout(0);
		const anchor = root.querySelector<HTMLAnchorElement>('a.pi-chat-file-link')!;
		anchor.click();
		assert.deepStrictEqual({ text: anchor.textContent, opened: opened[0]?.resource.path, expanded: root.querySelector('details')?.open }, {
			text: 'src/a b.ts', opened: '/repo-a/src/a b.ts', expanded: false,
		});
	});

	test('does not mutate a disposed render after asynchronous resolution', async () => {
		const rendered = store.add(renderPiChatFileMarkdown({ render: renderMarkdown }, '`only.ts`', '/repo-a'));
		rendered.element.classList.add('pi-chat-assistant-text');
		const rendering = store.add(new DisposableStore());
		decoratePiChatFileLinks(rendered.element, '/repo-a', links, NullHoverService, rendering);
		rendering.dispose();
		await timeout(0);
		assert.strictEqual(rendered.element.querySelectorAll('a').length, 0);
	});
});
