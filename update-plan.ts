import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

interface PlanItem {
	step: string;
	status: "pending" | "in_progress" | "completed";
}

interface UpdatePlanArgs {
	explanation?: string;
	plan: PlanItem[];
}

interface PlanState {
	explanation?: string;
	plan: PlanItem[];
}

let currentPlan: PlanState | null = null;

function reconstructState(ctx: ExtensionContext) {
	currentPlan = null;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role !== "toolResult" || msg.toolName !== "update_plan") continue;
		const details = msg.details as PlanState | undefined;
		if (details) {
			currentPlan = { explanation: details.explanation, plan: [...details.plan] };
		}
	}
}

function countCompleted(plan: PlanItem[]): number {
	return plan.filter((item) => item.status === "completed").length;
}

function validatePlan(plan: PlanItem[]): string | null {
	const inProgress = plan.filter((item) => item.status === "in_progress");
	if (inProgress.length > 1) {
		return "At most one step can be in_progress at a time.";
	}
	return null;
}

function formatPlanStatus(plan: PlanItem[]): string {
	const total = plan.length;
	const completed = plan.filter((item) => item.status === "completed").length;
	return `${completed}/${total}`;
}

class PlanViewComponent {
	private plan: PlanState | null;
	private theme: Theme;
	private onClose: () => void;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(plan: PlanState | null, theme: Theme, onClose: () => void) {
		this.plan = plan;
		this.theme = theme;
		this.onClose = onClose;
	}

	handleInput(data: string): void {
		if (data === "\x1b" || data === "\x03") {
			this.onClose();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const lines: string[] = [];
		const th = this.theme;

		lines.push("");
		const title = th.fg("accent", " Plan ");
		const headerLine =
			th.fg("borderMuted", "─".repeat(3)) +
			title +
			th.fg("borderMuted", "─".repeat(Math.max(0, width - 8)));
		lines.push(truncateToWidth(headerLine, width));
		lines.push("");

		if (!this.plan || this.plan.plan.length === 0) {
			lines.push(truncateToWidth(`  ${th.fg("dim", "No plan items yet.")}`, width));
		} else {
			const done = countCompleted(this.plan.plan);
			const total = this.plan.plan.length;
			lines.push(truncateToWidth(`  ${th.fg("muted", `${done}/${total} completed`)}`, width));
			lines.push("");

			if (this.plan.explanation) {
				const note = th.fg("dim", this.plan.explanation);
				lines.push(truncateToWidth(`  ${note}`, width));
				lines.push("");
			}

			for (const item of this.plan.plan) {
				let check: string;
				let style: string;
				if (item.status === "completed") {
					check = th.fg("success", "✔");
					style = th.fg("dim", item.step);
				} else if (item.status === "in_progress") {
					check = th.fg("accent", "□");
					style = th.fg("accent", item.step);
				} else {
					check = th.fg("dim", "□");
					style = th.fg("text", item.step);
				}
				lines.push(truncateToWidth(`  ${check} ${style}`, width));
			}
		}

		lines.push("");
		lines.push(truncateToWidth(`  ${th.fg("dim", "Press Escape to close")}`, width));
		lines.push("");

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}
}

export default function registerUpdatePlan(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));

	pi.on("turn_end", async (_event, ctx) => {
		if (currentPlan && currentPlan.plan.length > 0) {
			const status = formatPlanStatus(currentPlan.plan);
			const theme = ctx.ui.theme;
			ctx.ui.setStatus("afaz-plan", theme.fg("dim", `Plan: ${status}`));
		} else {
			ctx.ui.setStatus("afaz-plan", "");
		}
	});

	const UpdatePlanSchema = Type.Object({
		explanation: Type.Optional(Type.String({ description: "Optional explanation for the plan update" })),
		plan: Type.Array(
			Type.Object({
				step: Type.String({ description: "The step description" }),
				status: StringEnum(["pending", "in_progress", "completed"] as const),
			}),
			{ description: "The list of steps" },
		),
	});

	pi.registerTool({
		name: "update_plan",
		label: "Update Plan",
		description:
			"Updates the task plan. Provide an optional explanation and a list of plan items, each with a step and status. At most one step can be in_progress at a time.",
		parameters: UpdatePlanSchema,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const args = params as UpdatePlanArgs;

			const validationError = validatePlan(args.plan);
			if (validationError) {
				return {
					content: [{ type: "text", text: `Error: ${validationError}` }],
					isError: true,
					details: { ...(currentPlan ?? { plan: [] }), error: validationError } as PlanState & { error?: string },
				};
			}

			currentPlan = {
				explanation: args.explanation,
				plan: args.plan.map((item) => ({ step: item.step, status: item.status })),
			};

			return {
				content: [{ type: "text", text: "Plan updated" }],
				details: currentPlan,
			};
		},

		renderCall(args, theme, _context) {
			const plan = (args as UpdatePlanArgs).plan;
			let text = theme.fg("toolTitle", theme.bold("update_plan "));
			text += theme.fg("muted", `${plan.length} step(s)`);
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as (PlanState & { error?: string }) | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			if (details.error) {
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}

			if (details.plan.length === 0) {
				return new Text(theme.fg("dim", "(no steps provided)"), 0, 0);
			}

			let text = theme.fg("accent", theme.bold("Updated Plan"));

			if (details.explanation) {
				text += `\n${theme.fg("dim", details.explanation)}`;
			}

			const displayPlan = expanded ? details.plan : details.plan.slice(0, 10);
			for (const item of displayPlan) {
				let check: string;
				let stepText: string;
				if (item.status === "completed") {
					check = theme.fg("success", "✔ ");
					stepText = theme.fg("dim", item.step);
				} else if (item.status === "in_progress") {
					check = theme.fg("accent", "□ ");
					stepText = theme.fg("accent", item.step);
				} else {
					check = theme.fg("dim", "□ ");
					stepText = theme.fg("text", item.step);
				}
				text += `\n${check}${stepText}`;
			}

			if (!expanded && details.plan.length > 10) {
				text += `\n${theme.fg("dim", `... ${details.plan.length - 10} more`)}`;
			}

			return new Text(text, 0, 0);
		},
	});

	pi.registerCommand("plan", {
		description: "Show the current plan",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				if (!currentPlan || currentPlan.plan.length === 0) {
					console.log("No plan items yet.");
					return;
				}
				console.log("Updated Plan\n");
				if (currentPlan.explanation) {
					console.log(currentPlan.explanation);
					console.log();
				}
				for (const item of currentPlan.plan) {
					const check = item.status === "completed" ? "✔" : "□";
					console.log(`${check} ${item.step}`);
				}
				return;
			}

			await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
				return new PlanViewComponent(currentPlan, theme, () => done());
			});
		},
	});
}
