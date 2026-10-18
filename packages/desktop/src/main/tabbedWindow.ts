import { BrowserWindow, WebContentsView, type Rectangle, type WebContents } from 'electron';
import { TAB_STRIP_H, type TabsState, type ThemeKind } from '../ipc.js';
import type { WelcomeState } from '../welcome/api.js';
import { backgroundFor, type RepoTab } from './repoTab.js';

export interface TabbedWindowOptions {
	bounds?: Rectangle;
	theme: ThemeKind;
	/** The tab strip's and the Welcome page's preloads, next to this file in `dist/`. */
	tabsPreload: string;
	welcomePreload: string;
	/** The recent repositories the Welcome page lists, as they stand now. */
	recent: () => string[];
	/** Something about the tabs changed that is worth remembering: order, the active one, a title. */
	onChanged: (window: TabbedWindow) => void;
	onClosed: (window: TabbedWindow) => void;
}

/**
 * The window: a strip of tabs across the top — its own small page, which doubles as the title bar
 * the window is dragged by — and below it the active tab's view. Inactive views stay alive, hidden.
 */
export class TabbedWindow {
	public readonly win: BrowserWindow;
	private listTabs: RepoTab[] = [];
	private active: RepoTab | null = null;
	private theme: ThemeKind;
	/** The Welcome page, there only while the window has no tab. */
	private welcome: WebContentsView | null = null;

	public constructor(private readonly options: TabbedWindowOptions) {
		this.theme = options.theme;
		this.win = new BrowserWindow({
			...(options.bounds ?? { width: 1400, height: 900 }),
			minWidth: 720,
			minHeight: 480,
			title: 'Git Octopus',
			// The close / minimise / zoom buttons sit on the tab strip, as in Safari or Finder.
			titleBarStyle: 'hiddenInset',
			trafficLightPosition: { x: 14, y: 13 },
			backgroundColor: backgroundFor(options.theme),
			show: false,
			webPreferences: {
				preload: options.tabsPreload,
				contextIsolation: true,
				sandbox: true,
				nodeIntegration: false,
			},
		});
		this.win.once('ready-to-show', () => this.win.show());
		this.win.webContents.on('will-navigate', (event) => event.preventDefault());
		this.win.on('resize', () => this.layout());
		this.win.on('focus', () => {
			this.active?.setFocused(true);
			// Keyboard focus belongs in the repository's view, not on the strip above it.
			this.active?.view.webContents.focus();
		});
		this.win.on('blur', () => this.active?.setFocused(false));
		this.win.on('closed', () => {
			for (const tab of this.listTabs) tab.dispose();
			this.listTabs = [];
			this.welcome?.webContents.close();
			this.welcome = null;
			options.onClosed(this);
		});
		void this.win.loadURL('app://git-octopus/tabs.html');
	}

	public get tabs(): readonly RepoTab[] {
		return this.listTabs;
	}

	public get activeTab(): RepoTab | null {
		return this.active;
	}

	public tabByFolder(folder: string): RepoTab | undefined {
		return this.listTabs.find((tab) => tab.folder === folder);
	}

	public tabByContents(contents: WebContents): RepoTab | undefined {
		return this.listTabs.find((tab) => tab.view.webContents === contents);
	}

	public tabById(id: number): RepoTab | undefined {
		return this.listTabs.find((tab) => tab.id === id);
	}

	public isWelcome(contents: WebContents): boolean {
		return this.welcome?.webContents === contents;
	}

	/** The page a window with no tab shows: Open Repository…, the recent ones, a folder to drop. */
	public showWelcome(): void {
		if (this.welcome || this.listTabs.length > 0) return;
		const view = new WebContentsView({
			webPreferences: {
				preload: this.options.welcomePreload,
				contextIsolation: true,
				sandbox: true,
				nodeIntegration: false,
			},
		});
		view.setBackgroundColor(backgroundFor(this.theme));
		view.webContents.on('will-navigate', (event) => event.preventDefault());
		view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
		this.welcome = view;
		this.win.contentView.addChildView(view);
		this.layout();
		void view.webContents.loadURL('app://git-octopus/welcome.html');
		this.win.setTitle('Git Octopus');
	}

	private hideWelcome(): void {
		if (!this.welcome) return;
		const view = this.welcome;
		this.welcome = null;
		this.win.contentView.removeChildView(view);
		view.webContents.close();
	}

	/** Sent again whenever the Welcome page (re)loads and asks, and when the list changes. */
	public pushWelcome(): void {
		if (!this.welcome) return;
		const state: WelcomeState = { listRecent: this.options.recent(), theme: this.theme };
		this.welcome.webContents.send('welcome:state', state);
	}

	public add(tab: RepoTab): void {
		this.hideWelcome();
		this.listTabs.push(tab);
		this.win.contentView.addChildView(tab.view);
		this.layout();
		this.select(tab);
	}

	public select(tab: RepoTab): void {
		if (!this.listTabs.includes(tab)) return;
		const focused = this.win.isFocused();
		for (const each of this.listTabs) each.setShown(each === tab, focused);
		this.active = tab;
		tab.view.webContents.focus();
		this.refresh();
	}

	/** The one `step` places along, wrapping around: ⌃Tab, ⌃⇧Tab. */
	public cycle(step: number): void {
		if (!this.active || this.listTabs.length < 2) return;
		const at = this.listTabs.indexOf(this.active);
		const next = (at + step + this.listTabs.length) % this.listTabs.length;
		this.select(this.listTabs[next]);
	}

	/** ⌘1 … ⌘8 pick that tab; ⌘9 the last, as in every browser. */
	public selectNumber(number: number): void {
		const tab = number === 9 ? this.listTabs.at(-1) : this.listTabs[number - 1];
		if (tab) this.select(tab);
	}

	public close(tab: RepoTab): void {
		const at = this.listTabs.indexOf(tab);
		if (at === -1) return;
		this.listTabs.splice(at, 1);
		this.win.contentView.removeChildView(tab.view);
		tab.dispose();
		if (this.listTabs.length === 0) {
			// The last tab going is the user closing everything: remembered as nothing open, and the
			// window falls back to the Welcome page rather than closing.
			this.active = null;
			this.showWelcome();
			this.refresh();
			return;
		}
		if (this.active === tab) this.select(this.listTabs[Math.min(at, this.listTabs.length - 1)]);
		else this.refresh();
	}

	public move(tab: RepoTab, toIndex: number): void {
		const from = this.listTabs.indexOf(tab);
		if (from === -1) return;
		this.listTabs.splice(from, 1);
		this.listTabs.splice(Math.max(0, Math.min(toIndex, this.listTabs.length)), 0, tab);
		this.refresh();
	}

	public setTheme(theme: ThemeKind): void {
		this.theme = theme;
		this.win.setBackgroundColor(backgroundFor(theme));
		for (const tab of this.listTabs) tab.setTheme(theme);
		this.welcome?.setBackgroundColor(backgroundFor(theme));
		this.pushState();
		this.pushWelcome();
	}

	/** A tab's title, branch or count moved: the strip and the window title follow. */
	public refresh(): void {
		const info = this.active?.info;
		this.win.setTitle(
			info ? (info.branch ? `${info.title} — ${info.branch}` : info.title) : 'Git Octopus'
		);
		this.pushState();
		this.options.onChanged(this);
	}

	/** Sent again whenever the strip page (re)loads and asks. */
	public pushState(): void {
		const state: TabsState = {
			listTabs: this.listTabs.map((tab) => tab.info),
			activeId: this.active?.id ?? null,
			theme: this.theme,
		};
		this.win.webContents.send('tabs:state', state);
	}

	private layout(): void {
		const [width, height] = this.win.getContentSize();
		const bounds = { x: 0, y: TAB_STRIP_H, width, height: Math.max(0, height - TAB_STRIP_H) };
		for (const tab of this.listTabs) tab.view.setBounds(bounds);
		this.welcome?.setBounds(bounds);
	}
}
