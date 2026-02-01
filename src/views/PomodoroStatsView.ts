import { ItemView, WorkspaceLeaf, Setting } from "obsidian";
import {
	format,
	startOfWeek,
	endOfWeek,
	startOfMonth,
	endOfMonth,
	startOfDay,
	subDays,
} from "date-fns";
import TaskNotesPlugin from "../main";
import { POMODORO_STATS_VIEW_TYPE, PomodoroHistoryStats, PomodoroSessionHistory } from "../types";
import {
	parseTimestamp,
	getTodayLocal,
} from "../utils/dateUtils";
import { getSessionDuration } from "../utils/pomodoroUtils";

export class PomodoroStatsView extends ItemView {
	plugin: TaskNotesPlugin;

	// UI elements
	private overviewStatsEl: HTMLElement | null = null;
	private statsTableEl: HTMLElement | null = null;
	private recentSessionsEl: HTMLElement | null = null;
	private tabContainerEl: HTMLElement | null = null;

	// State
	private selectedTab: "today" | "yesterday" | "week" | "month" | "all" = "today";

	constructor(leaf: WorkspaceLeaf, plugin: TaskNotesPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return POMODORO_STATS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.plugin.i18n.translate("views.pomodoroStats.title");
	}

	getIcon(): string {
		return "bar-chart";
	}

	private t(key: string, params?: Record<string, string | number>): string {
		return this.plugin.i18n.translate(key, params);
	}

	/**
	 * Calculate actual duration in minutes with backward compatibility
	 */
	private calculateActualDuration(
		activePeriods: Array<{ startTime: string; endTime?: string }>
	): number {
		return activePeriods
			.filter((period) => period.endTime) // Only completed periods
			.reduce((total, period) => {
				const start = new Date(period.startTime);
				const end = period.endTime ? new Date(period.endTime) : new Date();
				const durationMs = end.getTime() - start.getTime();
				return total + Math.round(durationMs / (1000 * 60)); // Convert to minutes
			}, 0);
	}

	async onOpen() {
		await this.plugin.onReady();
		await this.render();
	}

	async onClose() {
		this.contentEl.empty();
	}

	async render() {
		this.contentEl.empty();
		this.contentEl.addClass("pomodoro-stats-view-content");
		const container = this.contentEl.createDiv({
			cls: "tasknotes-plugin tasknotes-container pomodoro-stats-container pomodoro-stats-view",
		});

		// Header
		const header = container.createDiv({
			cls: "pomodoro-stats-view__header",
		});
		header.createDiv({
			cls: "pomodoro-stats-view__heading",
			text: this.t("views.pomodoroStats.heading"),
		});

		// Refresh button
		const refreshButton = header.createEl("button", {
			cls: "pomodoro-stats-view__refresh-button",
		});
		refreshButton.createSpan({ text: this.t("views.pomodoroStats.refresh") });
		refreshButton.createSpan({ cls: "refresh-icon", text: " ↻" });

		this.registerDomEvent(refreshButton, "click", () => {
			this.refreshStats();
		});

		// Overview section (Always shows lifetime/today basics)
		const overviewSection = container.createDiv({
			cls: "pomodoro-stats-view__section pomodoro-stats-view__section--overview",
		});
		this.overviewStatsEl = overviewSection.createDiv({
			cls: "pomodoro-stats-view__overview-grid",
		});

		// Tab Bar
		this.tabContainerEl = container.createDiv({
			cls: "pomodoro-stats-view__tabs",
		});
		this.renderTabs();

		// Stats Table Section
		const statsTableSection = container.createDiv({
			cls: "pomodoro-stats-view__section pomodoro-stats-view__section--table",
		});
		this.statsTableEl = statsTableSection.createDiv({
			cls: "pomodoro-stats-view__table-container",
		});

		// Recent sessions
		const recentSection = container.createDiv({
			cls: "pomodoro-stats-view__section pomodoro-stats-view__section--recent",
		});
		recentSection.createDiv({
			cls: "pomodoro-stats-section-title",
			text: this.t("views.pomodoroStats.sections.recent"),
		});
		this.recentSessionsEl = recentSection.createDiv({
			cls: "pomodoro-stats-view__recent-sessions",
		});

		// Initial load
		await this.refreshStats();
	}

	private renderTabs() {
		if (!this.tabContainerEl) return;
		this.tabContainerEl.empty();

		const tabs: Array<{ id: typeof PomodoroStatsView.prototype.selectedTab; label: string }> = [
			{ id: "today", label: this.t("views.pomodoroStats.sections.today") },
			{ id: "yesterday", label: this.t("views.pomodoroStats.sections.yesterday") },
			{ id: "week", label: this.t("views.pomodoroStats.sections.week") },
			{ id: "month", label: this.t("views.pomodoroStats.sections.month") },
			{ id: "all", label: this.t("views.pomodoroStats.sections.allTime") },
		];

		for (const tab of tabs) {
			const tabEl = this.tabContainerEl.createDiv({
				cls: `pomodoro-stats-tab pomodoro-stats-view__tab ${this.selectedTab === tab.id ? "is-active" : ""
					}`,
				text: tab.label,
			});
			this.registerDomEvent(tabEl, "click", async () => {
				this.selectedTab = tab.id;
				this.renderTabs(); // Refresh active state
				await this.refreshStatsByType();
			});
		}
	}

	private async refreshStats() {
		try {
			await Promise.all([
				this.updateOverviewStats(),
				this.refreshStatsByType(),
			]);
		} catch (error) {
			console.error("Failed to refresh stats:", error);
		}
	}

	private async refreshStatsByType() {
		if (!this.statsTableEl || !this.recentSessionsEl) return;

		const range = this.getRangeForTab(this.selectedTab);
		const stats = await this.calculateStatsForRange(range.start, range.end);

		// Get sessions for this range
		const history = await this.plugin.pomodoroService.getSessionHistory();
		const filteredHistory = this.filterSessionsByRange(history, range.start, range.end);

		this.renderStatsTable(stats);
		this.renderRecentSessionsList(filteredHistory);
	}

	private getRangeForTab(tab: typeof PomodoroStatsView.prototype.selectedTab): { start: Date; end: Date } {
		const today = getTodayLocal();

		switch (tab) {
			case "today":
				return { start: today, end: today };
			case "yesterday": {
				const yesterday = subDays(today, 1);
				return { start: yesterday, end: yesterday };
			}
			case "week": {
				const firstDaySetting = this.plugin.settings.calendarViewSettings.firstDay || 0;
				const options = { weekStartsOn: firstDaySetting as 0 | 1 | 2 | 3 | 4 | 5 | 6 };
				return { start: startOfWeek(today, options), end: endOfWeek(today, options) };
			}
			case "month":
				return { start: startOfMonth(today), end: endOfMonth(today) };
			case "all":
			default:
				return { start: new Date(0), end: new Date(8640000000000000) }; // Far future
		}
	}

	private filterSessionsByRange(history: PomodoroSessionHistory[], start: Date, end: Date): PomodoroSessionHistory[] {
		const normalizedStart = startOfDay(start).getTime();
		const normalizedEnd = startOfDay(end).getTime();

		return history.filter((session) => {
			try {
				const sessionDate = startOfDay(parseTimestamp(session.startTime)).getTime();
				return sessionDate >= normalizedStart && sessionDate <= normalizedEnd;
			} catch (e) {
				return false;
			}
		});
	}

	private async updateOverviewStats() {
		if (!this.overviewStatsEl) return;

		const todayStats = await this.plugin.pomodoroService.getTodayStats();
		const overallStats = await this.calculateOverallStatsFromHistory();

		const todayLocal = getTodayLocal();
		const yesterday = subDays(todayLocal, 1);
		const yesterdayStats = await this.calculateStatsForRange(yesterday, yesterday);

		this.renderOverviewGrid(this.overviewStatsEl, todayStats, overallStats, yesterdayStats);
	}

	private async calculateOverallStatsFromHistory(): Promise<PomodoroHistoryStats> {
		const history = await this.plugin.pomodoroService.getSessionHistory();
		return this.calculateOverallStats(history);
	}

	private renderRecentSessionsList(history: PomodoroSessionHistory[]) {
		if (!this.recentSessionsEl) return;
		this.recentSessionsEl.empty();

		const recentSessions = history.slice(-15).reverse();

		if (recentSessions.length === 0) {
			this.recentSessionsEl.createDiv({
				cls: "pomodoro-no-sessions pomodoro-stats-view__no-sessions",
				text: this.t("views.pomodoroStats.recents.empty"),
			});
			return;
		}

		for (const session of recentSessions) {
			const sessionEl = this.recentSessionsEl.createDiv({
				cls: `pomodoro-session-card session-type-${session.type}`,
			});

			// Left Column: Icon & Date
			const leftCol = sessionEl.createDiv({ cls: "session-card-left" });
			const nameRow = leftCol.createDiv({ cls: "session-name-row" });
			const iconEl = nameRow.createDiv({ cls: "session-icon" });
			// Use emojis from Ref 1: Hammer for work, Sleep/Coffee for breaks
			if (session.type === "work") iconEl.textContent = "🍅";
			else if (session.type === "long-break") iconEl.textContent = "💤";
			else iconEl.textContent = "☕";

			let typeLabel = this.t("views.pomodoroStats.recents.types.work");
			if (session.type === "short-break")
				typeLabel = this.t("views.pomodoroStats.recents.types.shortBreak");
			if (session.type === "long-break")
				typeLabel = this.t("views.pomodoroStats.recents.types.longBreak");

			nameRow.createDiv({
				cls: "session-name",
				text: typeLabel,
			});

			try {
				const startTime = parseTimestamp(session.startTime);
				const endTime = session.endTime ? parseTimestamp(session.endTime) : new Date();
				leftCol.createDiv({
					cls: "session-time-range",
					text: `${format(startTime, "MMM d, HH:mm")} > ${format(endTime, "MMM d, HH:mm")}`,
				});

				// Middle-Left: Progress Ratio & Badge
				const ratioCol = sessionEl.createDiv({ cls: "session-card-ratio" });
				const actualDuration = getSessionDuration(session);
				ratioCol.createDiv({
					cls: "session-ratio-text",
					text: `${actualDuration}/${session.plannedDuration}min`,
				});

				// FIX: Check interrupted flag explicitly
				const isInterrupted = session.interrupted === true;
				const statusBadge = ratioCol.createDiv({
					cls: `session-status-badge ${isInterrupted ? "is-interrupted" : "is-completed"}`,
					text: isInterrupted
						? this.t("views.pomodoroStats.recents.status.interrupted")
						: this.t("views.pomodoroStats.recents.status.completed"),
				});

				// Right: Timeline Progress Track with Task Name inside
				const contentCol = sessionEl.createDiv({ cls: "session-card-content" });

				const timelineContainer = contentCol.createDiv({
					cls: "session-timeline-container",
				});
				const progressPercent = Math.min(
					100,
					(actualDuration / session.plannedDuration) * 100
				);

				timelineContainer.createDiv({
					cls: "session-timeline-bar",
					attr: { style: `width: ${progressPercent}%` },
				});

				const taskName = session.taskPath
					? session.taskPath.split("/").pop()?.replace(".md", "")
					: session.type === "work"
						? "Unfocused Session"
						: "Chill Time";

				timelineContainer.createDiv({
					cls: "session-task-name-overlay",
					text: taskName || "",
					attr: { title: taskName || "" },
				});

				const overtMin = Math.max(0, actualDuration - session.plannedDuration);
				const psCount = Math.max(0, (session.activePeriods?.length || 1) - 1);
				contentCol.createDiv({
					cls: "session-sub-info",
					text: this.t("views.pomodoroStats.recents.subInfo", {
						overtime: overtMin > 0 ? `+${overtMin}m` : "0m",
						paused: `${psCount}m`,
					}),
				});
			} catch (e) {
				console.error("Failed to render session details:", session, e);
				// Fallback for failed details
				sessionEl.createDiv({
					cls: "session-card-error",
					text: "Error loading session details",
				});
			}
		}
	}

	private renderOverviewGrid(
		container: HTMLElement,
		todayStats: PomodoroHistoryStats,
		overallStats: PomodoroHistoryStats,
		yesterdayStats: PomodoroHistoryStats
	) {
		container.empty();

		const formatTime = (minutes: number): string => {
			if (minutes < 60) return `${minutes}m`;
			const hours = Math.floor(minutes / 60);
			const mins = minutes % 60;
			return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
		};

		const getDiffLabel = (current: number, prev: number, type: "count" | "duration") => {
			const diff = current - prev;
			if (diff === 0) return this.t(`views.pomodoroStats.overviewCards.${type === "count" ? "todayPomos" : "todayFocus"}.change.less`, { count: 0, duration: "0m" }); // Fallback

			const key = diff > 0 ? "more" : "less";
			const value = Math.abs(diff);
			const durationStr = type === "duration" ? formatTime(value) : "";

			return this.t(`views.pomodoroStats.overviewCards.${type === "count" ? "todayPomos" : "todayFocus"}.change.${key}`, {
				count: value,
				duration: durationStr
			});
		};

		const cards = [
			{
				value: todayStats.pomodorosCompleted.toString(),
				label: this.t("views.pomodoroStats.overviewCards.todayPomos.label"),
				sub: getDiffLabel(todayStats.pomodorosCompleted, yesterdayStats.pomodorosCompleted, "count"),
			},
			{
				value: overallStats.pomodorosCompleted.toString(),
				label: this.t("views.pomodoroStats.overviewCards.totalPomos.label"),
				sub: this.t("views.pomodoroStats.overviewCards.totalPomos.sub"),
			},
			{
				value: formatTime(todayStats.totalMinutes),
				label: this.t("views.pomodoroStats.overviewCards.todayFocus.label"),
				sub: getDiffLabel(todayStats.totalMinutes, yesterdayStats.totalMinutes, "duration"),
			},
			{
				value: formatTime(overallStats.totalMinutes),
				label: this.t("views.pomodoroStats.overviewCards.totalFocus.label"),
				sub: this.t("views.pomodoroStats.overviewCards.totalFocus.sub"),
			},
		];

		for (const card of cards) {
			const cardEl = container.createDiv({ cls: "pomodoro-overview-card" });
			cardEl.createDiv({ cls: "overview-value", text: card.value });
			cardEl.createDiv({ cls: "overview-label", text: card.label });
			cardEl.createDiv({ cls: "overview-sub", text: card.sub });
		}
	}

	private renderStatsTable(stats: PomodoroHistoryStats) {
		if (!this.statsTableEl) return;
		this.statsTableEl.empty();

		const table = this.statsTableEl.createDiv({ cls: "pomodoro-stats-table" });

		// Pomodoros Row
		const pomoRow = table.createDiv({ cls: "stats-table-row" });
		pomoRow.createDiv({ cls: "row-header", text: this.t("views.pomodoroStats.stats.pomodoros") });
		this.renderStatCell(pomoRow, stats.pomodorosCompleted, this.t("views.pomodoroStats.stats.table.headers.count"));
		this.renderStatCell(pomoRow, `${stats.totalMinutes}m`, this.t("views.pomodoroStats.stats.table.headers.duration"));
		this.renderStatCell(pomoRow, `${stats.overtimeMinutes || 0}m`, this.t("views.pomodoroStats.stats.table.headers.overtime"));
		this.renderStatCell(pomoRow, stats.averageSessionLength, this.t("views.pomodoroStats.stats.table.headers.avgLen"));
		this.renderStatCell(pomoRow, `${stats.completionRate}%`, this.t("views.pomodoroStats.stats.table.headers.done"));

		// Breaks Row
		const breakRow = table.createDiv({ cls: "stats-table-row" });
		breakRow.createDiv({ cls: "row-header", text: this.t("views.pomodoroStats.stats.breaks") });
		const totalBreaks = (stats.shortBreaksCompleted || 0) + (stats.longBreaksCompleted || 0);
		this.renderStatCell(breakRow, totalBreaks, this.t("views.pomodoroStats.stats.table.headers.count"));
		this.renderStatCell(breakRow, `${stats.totalBreakMinutes || 0}m`, this.t("views.pomodoroStats.stats.table.headers.duration"));
		this.renderStatCell(breakRow, `${stats.breakOvertimeMinutes || 0}m`, this.t("views.pomodoroStats.stats.table.headers.overtime"));
		this.renderStatCell(breakRow, `${stats.averageBreakLength || 0}m`, this.t("views.pomodoroStats.stats.table.headers.avgLen"));
		this.renderStatCell(breakRow, `${stats.breakCompletionRate || 0}%`, this.t("views.pomodoroStats.stats.table.headers.done"));

		// Interrupts Row
		const intRow = table.createDiv({ cls: "stats-table-row interrupts-row" });
		intRow.createDiv({ cls: "row-header", text: this.t("views.pomodoroStats.stats.interrupts") });
		this.renderStatCell(intRow, stats.totalInterrupted || 0, this.t("views.pomodoroStats.stats.table.headers.total"), "full-width");
		this.renderStatCell(intRow, `${stats.interruptionRate || 0}%`, this.t("views.pomodoroStats.stats.table.headers.rate"), "full-width");
		this.renderStatCell(intRow, `${stats.timeSpentInInterrupted || 0}m`, this.t("views.pomodoroStats.stats.table.headers.reserved"), "full-width");
	}

	private renderStatCell(row: HTMLElement, value: string | number, label: string, cls = "") {
		const cell = row.createDiv({ cls: `stats-table-cell ${cls}` });
		cell.createDiv({ cls: "cell-value", text: value.toString() });
		cell.createDiv({ cls: "cell-label", text: label });
	}

	private async calculateStatsForRange(
		startDate: Date,
		endDate: Date
	): Promise<PomodoroHistoryStats> {
		const history = await this.plugin.pomodoroService.getSessionHistory();

		// Normalize range boundaries to start of day for safe comparison
		const normalizedStartDate = startOfDay(startDate).getTime();
		const normalizedEndDate = startOfDay(endDate).getTime();

		// Filter sessions within date range
		const rangeSessions = history.filter((session) => {
			try {
				// Parse the session timestamp safely and normalize to start of day
				const sessionTimestamp = parseTimestamp(session.startTime);
				const sessionDate = startOfDay(sessionTimestamp).getTime();

				// Safe date comparison using normalized dates
				return sessionDate >= normalizedStartDate && sessionDate <= normalizedEndDate;
			} catch (error) {
				console.error("Error parsing session timestamp for filtering:", {
					sessionStartTime: session.startTime,
					error,
				});
				return false; // Exclude sessions with invalid timestamps
			}
		});

		return this.calculateStatsFromSessions(rangeSessions);
	}

	private calculateOverallStats(history: PomodoroSessionHistory[]): PomodoroHistoryStats {
		return this.calculateStatsFromSessions(history);
	}

	private calculateStatsFromSessions(sessions: PomodoroSessionHistory[]): PomodoroHistoryStats {
		// Filter work sessions only
		const workSessions = sessions.filter((session) => session.type === "work");
		const completedWork = workSessions.filter((session) => session.completed);
		const interruptedWork = workSessions.filter((session) => session.interrupted);

		// Calculate streak from most recent sessions
		let currentStreak = 0;
		for (let i = workSessions.length - 1; i >= 0; i--) {
			if (workSessions[i].completed) {
				currentStreak++;
			} else {
				break;
			}
		}

		const totalMinutes = completedWork.reduce(
			(sum, session) => sum + getSessionDuration(session),
			0
		);
		const averageSessionLength =
			completedWork.length > 0 ? totalMinutes / completedWork.length : 0;
		const completionRate =
			workSessions.length > 0 ? (completedWork.length / workSessions.length) * 100 : 0;

		// Calculate break statistics
		const shortBreaks = sessions.filter((session) => session.type === "short-break");
		const longBreaks = sessions.filter((session) => session.type === "long-break");
		const completedShortBreaks = shortBreaks.filter((session) => session.completed);
		const completedLongBreaks = longBreaks.filter((session) => session.completed);

		const totalBreakMinutes =
			completedShortBreaks.reduce((sum, session) => sum + getSessionDuration(session), 0) +
			completedLongBreaks.reduce((sum, session) => sum + getSessionDuration(session), 0);

		const allBreaks = [...shortBreaks, ...longBreaks];
		const completedBreaks = allBreaks.filter((session) => session.completed);
		const averageBreakLength =
			completedBreaks.length > 0 ? totalBreakMinutes / completedBreaks.length : 0;
		const breakCompletionRate =
			allBreaks.length > 0
				? (completedBreaks.length / allBreaks.length) * 100
				: 0;

		const breakOvertimeMinutes = allBreaks.reduce((sum, session) => {
			const actual = getSessionDuration(session);
			return sum + Math.max(0, actual - session.plannedDuration);
		}, 0);

		// Calculate interruption statistics
		const totalInterrupted = sessions.filter((session) => session.interrupted).length;
		const interruptionRate =
			sessions.length > 0 ? (totalInterrupted / sessions.length) * 100 : 0;

		// Time spent in interrupted sessions (not discarded!)
		const timeSpentInInterrupted = interruptedWork.reduce(
			(sum, session) => sum + getSessionDuration(session),
			0
		);

		// Calculate total overtime minutes (Work only)
		const overtimeMinutes = workSessions.reduce((sum, session) => {
			const actual = getSessionDuration(session);
			return sum + Math.max(0, actual - session.plannedDuration);
		}, 0);

		return {
			pomodorosCompleted: completedWork.length,
			currentStreak,
			totalMinutes,
			averageSessionLength: Math.round(averageSessionLength),
			completionRate: Math.round(completionRate),
			// Break statistics
			totalBreakMinutes,
			shortBreaksCompleted: completedShortBreaks.length,
			longBreaksCompleted: completedLongBreaks.length,
			breakCompletionRate: Math.round(breakCompletionRate),
			averageBreakLength: Math.round(averageBreakLength),
			breakOvertimeMinutes,
			// Interruption statistics
			totalInterrupted,
			interruptionRate: Math.round(interruptionRate),
			timeSpentInInterrupted,
			overtimeMinutes,
		};
	}

}
