import { getPrefs } from "@/lib/data";
import { SettingsForm } from "@/components/SettingsForm";

export default async function SettingsPage() {
  const prefs = await getPrefs();
  return <SettingsForm initial={prefs} />;
}
