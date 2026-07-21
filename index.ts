import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerExitCommand from "./exit-command";
import registerUpdatePlan from "./update-plan";

export default function (pi: ExtensionAPI) {
	registerExitCommand(pi);
	registerUpdatePlan(pi);
}
