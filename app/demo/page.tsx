import type { Metadata } from "next";
import DemoVaultApp from "./DemoVaultApp";

export const metadata: Metadata = {
  title: "Coffer Demo - Sample authenticator vault",
  description: "Explore Coffer with temporary sample authenticator accounts in an isolated, browser-only demo workspace.",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function DemoPage() {
  return <DemoVaultApp />;
}
