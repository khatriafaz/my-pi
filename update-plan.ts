import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";

interface PlanItem {
	step: string;
	status: "pending" | "in_progress" | "completed";
}

interface UpdatePlanArgs {
	explanation?: string;
	plan: PlanItem[];
}

interface PlanDetails {
	explanation?: string;
	plan: PlanItem[];
}

function validatePlan(plan: PlanItem[]): string | null {
	const inProgress = plan.filter((item) => item.status === "in_progress");
	if (inProgress.length > 1) {
		return "At most one step can be in_progress at a time.";
	}
	return null;
}

export default function registerUpdatePlan(pi: ExtensionAPI) {
	const UpdatePlanSchema = Type.Object(
		{
			explanation: Type.Optional(Type.String({ description: "Optional explanation for the plan update" })),
			plan: Type.Array(
				Type.Object(
					{
						step: Type.String({ description: "The step description" }),
						status: StringEnum(["pending", "in_progress", "completed"] as const),
					},
					{ additionalProperties: false },
				),
				{ description: "The list of steps" },
			),
		},
		{ additionalProperties: false },
	);

	pi.registerTool({
		name: "update_plan",
		label: "Update Plan",
		description:
			"Updates the task plan. Provide an optional explanation and a list of plan items, each with a step and status. At most one step can be in_progress at a time.",
		promptSnippet: "Track steps and progress for non-trivial tasks",
		promptGuidelines: [
			"Use update_plan for non-trivial, multi-step work, when the user explicitly asks for a plan or TODOs, or when new work must be completed before yielding; do not pad simple tasks with a plan.",
			"Keep update_plan steps meaningful, logically ordered, concise, and easy to verify; mark completed work before moving to the next step and keep at most one step in_progress.",
			"When an update_plan changes during the task, provide an explanation of the rationale.",
			"Do not repeat the full plan after calling update_plan because the harness already displays it; briefly summarize the change and the next step instead.",
		],
		parameters: UpdatePlanSchema,
		renderShell: "self",

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const args = params as UpdatePlanArgs;

			const validationError = validatePlan(args.plan);
			if (validationError) {
				throw new Error(validationError);
			}

			const details: PlanDetails = {
				explanation: args.explanation,
				plan: args.plan.map((item) => ({ step: item.step, status: item.status })),
			};

			return {
				content: [{ type: "text", text: "Plan updated" }],
				details,
			};
		},

		renderCall(_args, _theme, _context) {
			return { render: () => [], invalidate: () => {} };
		},

		renderResult(result, _options, theme, _context) {
			const details = result.details as PlanDetails | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(theme.fg("error", text?.type === "text" ? text.text : ""), 0, 0);
			}

			return {
				render(width: number) {
					const lines = [truncateToWidth(`${theme.fg("dim", "• ")}${theme.bold("Updated Plan")}`, width)];
					let hasIndentedContent = false;

					const appendWrapped = (prefix: string, text: string) => {
						const wrapWidth = Math.max(1, width - visibleWidth(prefix));
						const wrapped = wrapTextWithAnsi(text, wrapWidth);
						const continuation = " ".repeat(visibleWidth(prefix));
						lines.push(truncateToWidth(`${prefix}${wrapped[0] ?? ""}`, width));
						for (const line of wrapped.slice(1)) {
							lines.push(truncateToWidth(`${continuation}${line}`, width));
						}
					};

					const branchPrefix = () => {
						const prefix = hasIndentedContent ? "    " : "  └ ";
						hasIndentedContent = true;
						return theme.fg("dim", prefix);
					};

					const explanation = details.explanation?.trim();
					if (explanation) {
						appendWrapped(branchPrefix(), theme.fg("dim", theme.italic(explanation)));
					}

					if (details.plan.length === 0) {
						appendWrapped(branchPrefix(), theme.fg("dim", theme.italic("(no steps provided)")));
					}

					for (const item of details.plan) {
						let icon: string;
						let step: string;
						if (item.status === "completed") {
							icon = "✔ ";
							step = theme.fg("dim", theme.strikethrough(item.step));
						} else if (item.status === "in_progress") {
							icon = theme.fg("accent", theme.bold("□ "));
							step = theme.fg("accent", theme.bold(item.step));
						} else {
							icon = theme.fg("dim", "□ ");
							step = theme.fg("dim", item.step);
						}
						appendWrapped(`${branchPrefix()}${icon}`, step);
					}

					return lines;
				},
				invalidate() {},
			};
		},
	});
}
