import { getPrefs, getProfile } from "@/lib/data";
import { SettingsForm } from "@/components/SettingsForm";
import { TelegramConnect } from "@/components/TelegramConnect";

export default async function SettingsPage() {
  const [prefs, profile] = await Promise.all([getPrefs(), getProfile()]);
  return (
    <>
      <SettingsForm initial={prefs} />
      {prefs.onboarded && (
        <div className="settings">
          <TelegramConnect linked={profile.telegramLinked} />
        </div>
      )}
    </>
  );
}
