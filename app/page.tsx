import { I18nProvider } from "./I18nProvider";
import VaultApp from "./VaultApp";

export default function Home() {
  return (
    <I18nProvider>
      <VaultApp />
    </I18nProvider>
  );
}
