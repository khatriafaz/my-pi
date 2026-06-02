import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function registerExitCommand(pi: ExtensionAPI) {
	pi.registerCommand("exit", {
		description: "Exit/close pi",
		handler: async (_args, ctx) => {
			ctx.shutdown();
		},
	});
}
