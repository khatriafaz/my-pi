import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerConversationResources from "./conversation-resources";
import registerExitCommand from "./exit-command";
import registerUpdatePlan from "./update-plan";

export default function (pi: ExtensionAPI) {
	registerConversationResources(pi);
	registerExitCommand(pi);
	registerUpdatePlan(pi);
}
