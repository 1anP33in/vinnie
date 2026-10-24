import { getServices } from "@/services";

export async function copyText(text: string): Promise<boolean> {
  try {
    await getServices().system.copyText(text);
    return true;
  } catch {
    return false;
  }
}
