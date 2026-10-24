import { registerWorkspaceTools } from "@/agent/tools";
import { getServices } from "@/services";
import { useConnectionStore } from "@/state/connectionStore";
import { useConversationStore } from "@/state/conversationStore";
import { useProjectStore } from "@/state/projectStore";
import { useSettingsStore } from "@/state/settingsStore";

/** Load persisted state, then connect to Ollama. Safe to call once per launch. */
export async function bootstrap(): Promise<void> {
  registerWorkspaceTools(getServices().tools);
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
