/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, append } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { PiChatConversationView } from '../../browser/PiChatConversationView.js';
import { PiChatInputCacheService } from '../../browser/PiChatInputCacheService.js';
import { PiChatRepoPickerContainer } from '../../browser/PiChatRepoPickerContainer.js';
import { PiChatSessionListService } from '../../browser/PiChatSessionListService.js';
import { IPiChatSelectionService } from '../../browser/PiChatSelectionService.js';
import { PiChatRepoPickerBody } from '../../browser/body/PiChatRepoPickerBody.js';
import { PiChatSessionSummary } from '../../common/pi-chat-types.js';

suite('Pi chat resume sessions', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const sessions: PiChatSessionSummary[] = Array.from({ length: 10 }, (_, index) => ({
		id: `session-${index}`, repoName: `repo-${index}`, repoPath: `/repos/repo-${index}`,
		lastMessageAt: new Date(Date.UTC(2026, 0, 10 - index)).toISOString(), sessionFile: URI.file(`/sessions/session-${index}.jsonl`),
	}));
	const repo = { name: 'workspace', folderUri: URI.file('/repos/workspace') };

	function parent(): HTMLElement {
		const element = append(mainWindow.document.body, $('div'));
		store.add(toDisposable(() => element.remove()));
		return element;
	}

	function setupPicker(listSessions: PiChatSessionListService['listSessions']) {
		const instantiation = workbenchInstantiationService(undefined, store);
		instantiation.stubInstance(PiChatSessionListService, { listSessions });
		const selected: PiChatSessionSummary[] = [];
		instantiation.set(IPiChatSelectionService, upcastPartial<IPiChatSelectionService>({ selectSession: session => { if (session) { selected.push(session); } } }));
		const views: string[] = [];
		instantiation.stub(IViewsService, {});
		instantiation.stub(IViewsService, 'openView', async (id: string) => { views.push(id); });
		const commands: string[] = [];
		instantiation.stub(ICommandService, {});
		instantiation.stub(ICommandService, 'executeCommand', async (id: string) => { commands.push(id); });
		const element = parent();
		let closed = 0;
		const picker = store.add(instantiation.createInstance(PiChatRepoPickerContainer, element, () => { closed++; }));
		return { picker, element, selected, views, commands, instantiation, getClosed: () => closed };
	}

	test('resume is below search, above workspace repositories, with the shared session details', () => {
		const element = parent();
		const body = store.add(new PiChatRepoPickerBody(element, () => {}, () => {}));
		body.setRepos([repo], [repo], undefined);
		body.setSessions(sessions.slice(0, 3), true);
		const results = element.querySelector('.pi-chat-repo-results')!;
		assert.deepStrictEqual({
			searchBeforeResults: results.previousElementSibling?.className,
			sections: [...results.children].map(child => child.className),
			heading: results.querySelector('.pi-chat-resume-heading')?.textContent,
			names: [...results.querySelectorAll('.pi-chat-session-name')].map(row => row.textContent),
			timestamps: results.querySelectorAll('time.pi-chat-session-date').length,
			more: results.querySelector('.pi-chat-load-more')?.textContent,
		}, {
			searchBeforeResults: 'pi-chat-repo-search',
			sections: ['pi-chat-resume-sessions pi-chat-repo-section', 'pi-chat-repo-suggestions', 'pi-chat-repo-list', 'pi-chat-repo-open-folder'],
			heading: 'Resume Session', names: ['repo-0', 'repo-1', 'repo-2'], timestamps: 3, more: 'Load 5 More',
		});
	});

	test('arrow navigation crosses resume rows, Load More, and repositories in display order', () => {
		const element = parent();
		const body = store.add(new PiChatRepoPickerBody(element, () => {}, () => {}));
		body.setSessions(sessions.slice(0, 2), true);
		body.setRepos([repo, { name: 'zebra', folderUri: URI.file('/repos/zebra') }], [repo], undefined);
		const buttons = [...element.querySelectorAll('.pi-chat-session-button, .pi-chat-load-more, .pi-chat-repo-item')];
		const focused: number[] = [];
		element.querySelector('input')!.focus();
		for (const key of [...Array<string>(7).fill('ArrowDown'), ...Array<string>(7).fill('ArrowUp')]) {
			const event = new mainWindow.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
			mainWindow.document.activeElement!.dispatchEvent(event);
			assert.strictEqual(event.defaultPrevented, true);
			focused.push(buttons.indexOf(mainWindow.document.activeElement!));
		}
		assert.deepStrictEqual(focused, [0, 1, 2, 3, 4, 5, 5, 4, 3, 2, 1, 0, -1, 5]);
	});

	test('search filters resume choices by repository name or full path and Enter resumes the match', () => {
		const selected: string[] = [];
		const element = parent();
		const body = store.add(new PiChatRepoPickerBody(element, () => {}, () => {}, session => selected.push(session.id)));
		body.setSessions(sessions.slice(0, 3), false);
		const search = element.querySelector('input')!;
		search.value = ' /REPOS/REPO-1 ';
		search.dispatchEvent(new mainWindow.Event('input'));
		search.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		assert.deepStrictEqual({ names: [...element.querySelectorAll('.pi-chat-session-name')].map(row => row.textContent), selected }, { names: ['repo-1'], selected: ['session-1'] });
	});

	test('busy state disables session choices and paging across search rerenders', () => {
		const element = parent();
		const body = store.add(new PiChatRepoPickerBody(element, () => {}, () => {}));
		body.setSessions(sessions.slice(0, 3), true);
		body.setBusy(true);
		element.querySelector('input')!.dispatchEvent(new mainWindow.Event('input'));
		assert.deepStrictEqual([...element.querySelectorAll('button')].map(button => button.disabled), [true, true, true, true, true]);
	});

	test('empty history and filtered-empty history retain the resume heading', () => {
		const element = parent();
		const body = store.add(new PiChatRepoPickerBody(element, () => {}, () => {}));
		body.setSessions([], false);
		const empty = element.querySelector('.pi-chat-resume-sessions p')?.textContent;
		body.setSessions(sessions.slice(0, 3), false);
		const search = element.querySelector('input')!;
		search.value = 'missing';
		search.dispatchEvent(new mainWindow.Event('input'));
		assert.deepStrictEqual({ empty, filtered: element.querySelector('.pi-chat-resume-sessions p')?.textContent, heading: element.querySelector('.pi-chat-resume-heading')?.textContent }, {
			empty: 'No recent sessions.', filtered: 'No matching recent sessions.', heading: 'Resume Session',
		});
	});

	test('loads three initially, adds five once per click, and preserves keyboard focus at the new rows', async () => {
		const limits: number[] = [];
		const pending = new DeferredPromise<Awaited<ReturnType<PiChatSessionListService['listSessions']>>>();
		const { element } = setupPicker(async limit => {
			limits.push(limit);
			return limit === 8 ? pending.p : { sessions: sessions.slice(0, limit), hasMore: limit < sessions.length };
		});
		await timeout(0);
		const initial = element.querySelectorAll('.pi-chat-session-button').length;
		const more = element.querySelector<HTMLButtonElement>('.pi-chat-load-more')!;
		more.focus();
		more.click();
		more.click();
		assert.strictEqual(more.disabled, true);
		await pending.complete({ sessions: sessions.slice(0, 8), hasMore: true });
		await timeout(0);
		const afterPage = element.querySelectorAll('.pi-chat-session-button').length;
		const focused = [...element.querySelectorAll('.pi-chat-session-button')].indexOf(mainWindow.document.activeElement!);
		element.querySelector<HTMLButtonElement>('.pi-chat-load-more')!.click();
		await timeout(0);
		assert.deepStrictEqual({ initial, afterPage, focused, limits, total: element.querySelectorAll('.pi-chat-session-button').length, more: !!element.querySelector('.pi-chat-load-more') }, {
			initial: 3, afterPage: 8, focused: 3, limits: [3, 8, 13], total: 10, more: false,
		});
	});

	test('resuming opens the existing session without creating or replacing a draft', async () => {
		const { element, selected, views, commands, instantiation, getClosed } = setupPicker(async () => ({ sessions: sessions.slice(0, 3), hasMore: false }));
		await timeout(0);
		const cache = instantiation.createInstance(PiChatInputCacheService);
		cache.setDraftSession({ ...sessions[5], isDraft: true });
		element.querySelector<HTMLButtonElement>('.pi-chat-session-button')!.click();
		assert.deepStrictEqual({ selected: selected.map(session => session.id), views, commands, closed: getClosed(), draft: cache.getDraftSession()?.id }, {
			selected: ['session-0'], views: [PiChatConversationView.ID], commands: [], closed: 1, draft: 'session-5',
		});
	});

	test('late session loads cannot overwrite a newer refresh', async () => {
		const pending = new DeferredPromise<Awaited<ReturnType<PiChatSessionListService['listSessions']>>>();
		let requests = 0;
		const { picker, element } = setupPicker(async () => ++requests === 1 ? pending.p : { sessions: [sessions[1]], hasMore: false });
		await picker.refresh();
		await pending.complete({ sessions: [sessions[0]], hasMore: false });
		await timeout(0);
		assert.deepStrictEqual([...element.querySelectorAll('.pi-chat-session-name')].map(row => row.textContent), ['repo-1']);
	});
});
