import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";

type ResourceKind = "link" | "pr" | "site" | "doc" | "note" | "other";

interface Resource {
	id: string;
	title: string;
	kind: ResourceKind;
	url?: string;
	note?: string;
	createdAt: string;
	updatedAt?: string;
}

type ResourceEvent =
	| { action: "add"; resource: Resource }
	| { action: "update"; id: string; patch: Partial<Omit<Resource, "id" | "createdAt">> }
	| { action: "remove"; id: string }
	| { action: "clear" };

const CUSTOM_TYPE = "conversation-resources";
let resources: Resource[] = [];

function makeId(): string {
	return Math.random().toString(36).slice(2, 8);
}

function normalizeKind(kind?: string): ResourceKind {
	if (kind === "link" || kind === "pr" || kind === "site" || kind === "doc" || kind === "note" || kind === "other") {
		return kind;
	}
	return "other";
}

function inferKind(url?: string): ResourceKind {
	if (!url) return "other";
	if (/github\.com\/[^/]+\/[^/]+\/pull\//i.test(url)) return "pr";
	if (/docs?|developer|reference/i.test(url)) return "doc";
	return "link";
}

function titleFromUrl(url: string): string {
	try {
		const parsed = new URL(url);
		const prMatch = parsed.hostname === "github.com" && parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
		if (prMatch) return `${prMatch[1]}/${prMatch[2]}#${prMatch[3]}`;

		const cleanPath = parsed.pathname.replace(/\/$/, "");
		return cleanPath ? `${parsed.hostname.replace(/^www\./, "")}${cleanPath}` : parsed.hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

function normalizeResource(resource: Resource): Resource {
	let title = resource.title;
	let note = resource.note;

	if (resource.url && note === "Auto-added from user message") {
		title = titleFromUrl(resource.url);
		note = undefined;
	}

	return { ...resource, title, note };
}

function reconstructResources(ctx: ExtensionContext) {
	resources = [];

	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== CUSTOM_TYPE) continue;

		const event = entry.data as ResourceEvent | undefined;
		if (!event) continue;

		if (event.action === "add") {
			const resource = normalizeResource(event.resource);
			resources = [...resources.filter((r) => r.id !== resource.id), resource];
		} else if (event.action === "update") {
			resources = resources.map((r) => (r.id === event.id ? { ...r, ...event.patch } : r));
		} else if (event.action === "remove") {
			resources = resources.filter((r) => r.id !== event.id);
		} else if (event.action === "clear") {
			resources = [];
		}
	}
}

function addResource(pi: ExtensionAPI, resource: Omit<Resource, "id" | "createdAt"> & { id?: string; createdAt?: string }): Resource {
	const saved = normalizeResource({
		id: resource.id ?? makeId(),
		title: resource.title,
		kind: resource.kind,
		url: resource.url,
		note: resource.note,
		createdAt: resource.createdAt ?? new Date().toISOString(),
		updatedAt: resource.updatedAt,
	});
	resources = [...resources.filter((r) => r.id !== saved.id), saved];
	pi.appendEntry(CUSTOM_TYPE, { action: "add", resource: saved } satisfies ResourceEvent);
	return saved;
}

function updateResource(pi: ExtensionAPI, id: string, patch: Partial<Omit<Resource, "id" | "createdAt">>): Resource | undefined {
	const existing = resources.find((r) => r.id === id);
	if (!existing) return undefined;
	const cleanPatch = { ...patch, updatedAt: new Date().toISOString() };
	resources = resources.map((r) => (r.id === id ? { ...r, ...cleanPatch } : r));
	pi.appendEntry(CUSTOM_TYPE, { action: "update", id, patch: cleanPatch } satisfies ResourceEvent);
	return resources.find((r) => r.id === id);
}

function removeResource(pi: ExtensionAPI, id: string): boolean {
	const existed = resources.some((r) => r.id === id);
	resources = resources.filter((r) => r.id !== id);
	pi.appendEntry(CUSTOM_TYPE, { action: "remove", id } satisfies ResourceEvent);
	return existed;
}

function formatResource(resource: Resource): string {
	const parts = [`[${resource.id}]`, `${resource.kind}:`, resource.title];
	if (resource.url) parts.push(`— ${resource.url}`);
	if (resource.note) parts.push(`(${resource.note})`);
	return parts.join(" ");
}

function formatResourcesList(): string {
	if (resources.length === 0) return "No resources saved for this conversation yet.";
	return resources.map(formatResource).join("\n");
}

function setResourceStatus(ctx: ExtensionContext) {
	// Keep resources visible in the persistent widget only; don't add footer/status bloat.
	ctx.ui.setStatus(CUSTOM_TYPE, undefined);
}

function refreshResourceUi(ctx: ExtensionContext) {
	setResourceStatus(ctx);
	setResourceSidebarWidget(ctx);
}

function setResourceWidget(ctx: ExtensionContext) {
	const lines = resources.length === 0
		? [ctx.ui.theme.fg("dim", "No resources saved for this conversation yet.")]
		: [
			ctx.ui.theme.fg("accent", "Resources"),
			...resources.map((r) => `• ${formatResource(r)}`),
			ctx.ui.theme.fg("dim", "Use /resources edit or /resources remove <id> to change this list."),
		];
	ctx.ui.setWidget(CUSTOM_TYPE, lines);
}

function extractUrls(text: string): string[] {
	return Array.from(new Set(text.match(/https?:\/\/[^\s)\]}>'"]+/g) ?? [])).map((url) => url.replace(/[.,;:!?]+$/, ""));
}

function compactResourceLine(resource: Resource): string {
	const icon = resource.kind === "pr" ? "PR" : resource.kind === "doc" ? "DOC" : resource.kind === "site" ? "WEB" : resource.kind === "note" ? "NOTE" : "LINK";
	const parts = [`${icon} ${resource.title}`];
	if (resource.url && resource.url !== resource.title && !resource.url.includes(resource.title)) parts.push(resource.url);
	return parts.join(" · ");
}

function padVisible(text: string, width: number): string {
	return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

class ResourceSidebar {
	constructor(private theme: Theme) {}

	render(width: number): string[] {
		if (width < 40 || resources.length === 0) return [];

		const th = this.theme;
		const panelWidth = Math.min(56, width);
		const padLeft = " ".repeat(Math.max(0, width - panelWidth));
		const lines: string[] = [];
		const inner = Math.max(10, panelWidth - 2);
		const contentWidth = inner - 1;
		const title = " Resources ";
		const left = Math.floor(Math.max(0, inner - visibleWidth(title)) / 2);
		const right = Math.max(0, inner - visibleWidth(title) - left);

		lines.push(padLeft + th.fg("borderMuted", `┌${"─".repeat(left)}`) + th.fg("accent", title) + th.fg("borderMuted", `${"─".repeat(right)}┐`));

		resources.forEach((resource, index) => {
			const wrapped = wrapTextWithAnsi(compactResourceLine(resource), contentWidth);
			for (const wrappedLine of wrapped) {
				lines.push(padLeft + th.fg("borderMuted", "│ ") + padVisible(wrappedLine, contentWidth) + th.fg("borderMuted", "│"));
			}
			if (index < resources.length - 1) {
				lines.push(padLeft + th.fg("borderMuted", "│ ") + padVisible(th.fg("borderMuted", "─".repeat(Math.min(12, contentWidth))), contentWidth) + th.fg("borderMuted", "│"));
			}
		});

		const hint = wrapTextWithAnsi(th.fg("dim", "/resources edit/delete"), contentWidth);
		lines.push(padLeft + th.fg("borderMuted", "├") + th.fg("borderMuted", "─".repeat(inner)) + th.fg("borderMuted", "┤"));
		for (const hintLine of hint) {
			lines.push(padLeft + th.fg("borderMuted", "│ ") + padVisible(hintLine, contentWidth) + th.fg("borderMuted", "│"));
		}
		lines.push(padLeft + th.fg("borderMuted", `└${"─".repeat(inner)}┘`));
		return lines.map((line) => truncateToWidth(line, width));
	}

	invalidate(): void {}
}

function setResourceSidebarWidget(ctx: ExtensionContext) {
	if (!ctx.hasUI || resources.length === 0) {
		ctx.ui.setWidget(CUSTOM_TYPE, undefined);
		return;
	}

	ctx.ui.setWidget(CUSTOM_TYPE, (_tui, theme) => new ResourceSidebar(theme));
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		reconstructResources(ctx);
		refreshResourceUi(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		reconstructResources(ctx);
		refreshResourceUi(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setWidget(CUSTOM_TYPE, undefined);
	});

	// Automatically save explicit URLs the user mentions. The agent can still add
	// non-URL resources with the tool when it judges something to be meaningful.
	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return { action: "continue" };
		const urls = extractUrls(event.text);
		let added = 0;
		for (const url of urls) {
			if (resources.some((r) => r.url === url)) continue;
			addResource(pi, {
				title: titleFromUrl(url),
				kind: inferKind(url),
				url,
			});
			added++;
		}
		if (added > 0) {
			refreshResourceUi(ctx);
			ctx.ui.notify(`Auto-saved ${added} resource${added === 1 ? "" : "s"}. Use /resources edit or /resources remove to change them.`, "info");
		}
		return { action: "continue" };
	});

	pi.on("before_agent_start", async (event) => {
		const resourceContext = resources.length > 0 ? `\nCurrent saved resources:\n${formatResourcesList()}` : "";
		return {
			systemPrompt: `${event.systemPrompt}\n\nConversation Resources behavior:\n- Proactively call conversation_resources add when a PR, reference site, doc, link, or important note becomes meaningful to this conversation.\n- Do not ask before saving obvious resources; the user can edit/delete them with /resources.\n- Call conversation_resources update/remove if the user asks to edit or delete a saved resource.${resourceContext}`,
		};
	});

	pi.registerTool({
		name: "conversation_resources",
		label: "Conversation Resources",
		description: "Store, list, update, remove, or clear important resources for the current pi conversation/session.",
		promptSnippet: "Manage this conversation's saved resources, such as PR links, reference sites, docs, notes, and other useful links.",
		promptGuidelines: [
			"Use conversation_resources when the user asks to save, remember, list, edit, remove, or clear important resources for the current conversation.",
			"Use conversation_resources add proactively for meaningful links, PRs, docs, reference sites, or notes that should remain attached to this conversation.",
			"Use conversation_resources update when the user wants to edit a saved resource's title, type, URL, or note.",
		],
		parameters: Type.Object({
			action: StringEnum(["add", "list", "update", "remove", "clear"] as const),
			title: Type.Optional(Type.String({ description: "Resource title. Required for add; optional for update." })),
			kind: Type.Optional(StringEnum(["link", "pr", "site", "doc", "note", "other"] as const)),
			url: Type.Optional(Type.String({ description: "URL for link-like resources." })),
			note: Type.Optional(Type.String({ description: "Optional note about why this resource matters." })),
			id: Type.Optional(Type.String({ description: "Resource id. Required for update/remove." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const action = params.action as "add" | "list" | "update" | "remove" | "clear";

			if (action === "list") {
				return { content: [{ type: "text", text: formatResourcesList() }], details: { resources } };
			}

			if (action === "add") {
				const title = typeof params.title === "string" ? params.title.trim() : "";
				if (!title) return { content: [{ type: "text", text: "Error: title is required when adding a resource." }], isError: true };

				const resource = addResource(pi, {
					title,
					kind: normalizeKind((params.kind as string | undefined) ?? inferKind(params.url as string | undefined)),
					url: typeof params.url === "string" && params.url.trim() ? params.url.trim() : undefined,
					note: typeof params.note === "string" && params.note.trim() ? params.note.trim() : undefined,
				});
				refreshResourceUi(ctx);
				return { content: [{ type: "text", text: `Saved resource ${resource.id}: ${formatResource(resource)}` }], details: { resource, resources } };
			}

			if (action === "update") {
				const id = typeof params.id === "string" ? params.id.trim() : "";
				if (!id) return { content: [{ type: "text", text: "Error: id is required when updating a resource." }], isError: true };
				const patch: Partial<Omit<Resource, "id" | "createdAt">> = {};
				if (typeof params.title === "string" && params.title.trim()) patch.title = params.title.trim();
				if (typeof params.kind === "string") patch.kind = normalizeKind(params.kind);
				if (typeof params.url === "string") patch.url = params.url.trim() || undefined;
				if (typeof params.note === "string") patch.note = params.note.trim() || undefined;
				const updated = updateResource(pi, id, patch);
				refreshResourceUi(ctx);
				return { content: [{ type: "text", text: updated ? `Updated resource ${id}: ${formatResource(updated)}` : `No resource found with id ${id}.` }], details: { resource: updated, resources } };
			}

			if (action === "remove") {
				const id = typeof params.id === "string" ? params.id.trim() : "";
				if (!id) return { content: [{ type: "text", text: "Error: id is required when removing a resource." }], isError: true };
				const existed = removeResource(pi, id);
				refreshResourceUi(ctx);
				return { content: [{ type: "text", text: existed ? `Removed resource ${id}.` : `No resource found with id ${id}.` }], details: { resources } };
			}

			resources = [];
			pi.appendEntry(CUSTOM_TYPE, { action: "clear" } satisfies ResourceEvent);
			refreshResourceUi(ctx);
			return { content: [{ type: "text", text: "Cleared all conversation resources." }], details: { resources } };
		},
	});

	pi.registerCommand("resources", {
		description: "List/manage resources saved for this conversation. Usage: /resources [list|add|edit|remove <id>|clear]",
		handler: async (args, ctx) => {
			reconstructResources(ctx);
			const [action = "list", maybeId] = args.trim().split(/\s+/, 2);

			if (action === "list" || action === "") {
				if (!ctx.hasUI) console.log(formatResourcesList());
				else setResourceWidget(ctx);
				refreshResourceUi(ctx);
				return;
			}

			if (action === "add") {
				const title = await ctx.ui.input("Resource title:", "e.g. Auth PR");
				if (!title) return;
				const kind = await ctx.ui.select("Resource type:", ["link", "pr", "site", "doc", "note", "other"]);
				const url = await ctx.ui.input("URL (optional):", "https://...");
				const note = await ctx.ui.input("Note (optional):", "Why this matters");
				const resource = addResource(pi, {
					title: title.trim(),
					kind: normalizeKind(kind),
					url: url?.trim() || undefined,
					note: note?.trim() || undefined,
				});
				refreshResourceUi(ctx);
				ctx.ui.notify(`Saved resource ${resource.id}`, "info");
				return;
			}

			if (action === "edit" || action === "update") {
				if (resources.length === 0) {
					ctx.ui.notify("No resources to edit.", "warning");
					return;
				}
				const id = maybeId || (await ctx.ui.select("Resource to edit:", resources.map((r) => `${r.id} — ${r.title}`)))?.split(" — ")[0];
				if (!id) return;
				const current = resources.find((r) => r.id === id);
				if (!current) {
					ctx.ui.notify(`No resource found with id ${id}.`, "warning");
					return;
				}
				const title = await ctx.ui.input("Title:", current.title);
				if (!title) return;
				const kind = await ctx.ui.select("Resource type:", ["link", "pr", "site", "doc", "note", "other"]);
				const url = await ctx.ui.input("URL (blank to remove):", current.url ?? "");
				const note = await ctx.ui.input("Note (blank to remove):", current.note ?? "");
				updateResource(pi, id, {
					title: title.trim(),
					kind: normalizeKind(kind ?? current.kind),
					url: url?.trim() || undefined,
					note: note?.trim() || undefined,
				});
				refreshResourceUi(ctx);
				ctx.ui.notify(`Updated resource ${id}`, "info");
				return;
			}

			if (action === "remove" || action === "delete") {
				const id = maybeId || (await ctx.ui.select("Resource to delete:", resources.map((r) => `${r.id} — ${r.title}`)))?.split(" — ")[0];
				if (!id) return;
				removeResource(pi, id);
				refreshResourceUi(ctx);
				ctx.ui.notify(`Removed resource ${id}`, "info");
				return;
			}

			if (action === "clear") {
				const ok = await ctx.ui.confirm("Clear resources?", "Remove all saved resources from this conversation?");
				if (!ok) return;
				resources = [];
				pi.appendEntry(CUSTOM_TYPE, { action: "clear" } satisfies ResourceEvent);
				refreshResourceUi(ctx);
				ctx.ui.notify("Cleared conversation resources", "info");
				return;
			}

			ctx.ui.notify("Usage: /resources [list|add|edit|remove <id>|clear]", "warning");
		},
	});
}
