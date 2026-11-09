import { bridgeAgentEventsToDragon } from "@/agent/runtime/events";
import { registerWorkspaceTools } from "@/agent/tools";
import { bridgeAgentEventsToActivity, bridgeIntegrationEventsToActivity } from "@/state/agentActivityBridge";
import { getServices } from "@/services";
import { useConnectionStore } from "@/state/connectionStore";
import { useConversationStore } from "@/state/conversationStore";
import { useProjectStore } from "@/state/projectStore";
import { getMcpManager } from "@/state/mcpStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useSkillStore } from "@/state/skillStore";
import { bridgeToolUsage, useToolSettingsStore } from "@/state/toolSettingsStore";

/** Load persisted state, then connect to Ollama. Safe to call once per launch. */
export async function bootstrap(): Promise<void> {
  registerWorkspaceTools(getServices().tools);
  bridgeAgentEventsToDragon();
  bridgeAgentEventsToActivity();
  bridgeIntegrationEventsToActivity();
  bridgeToolUsage();
  // Tool switches first, so disabled tools are off before any server connects.
  await useToolSettingsStore.getState().load();
  void useSkillStore.getState().load();
  void getMcpManager()
    .load()
    .catch(() => {});
  const settings = await useSettingsStore.getState().load();
  void useProjectStore.getState().load();

  const conversations = useConversationStore.getState();
  await conversations.loadList();
  if (settings.startupBehavior === "restoreLast") {
    const lastId = await getServices()
      .conversations.getLastActive()
      .catch(() => null);
    if (lastId) void useConversationStore.getState().open(lastId);
  }

  await useConnectionStore.getState().refresh();
}
