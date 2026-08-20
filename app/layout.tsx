import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const PRODUCT_TITLE = "Coffer - Your codes. Yours alone.";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = cleanHost(
    requestHeaders.get("x-forwarded-host")?.split(",", 1)[0] ??
    requestHeaders.get("host"),
  );
  const forwardedProtocol = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
  const hostname = new URL(`http://${host}`).hostname.toLowerCase();
  const localHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : localHost ? "http" : "https";
  const socialImage = `${protocol}://${host}/og.png`;

  return {
    title: PRODUCT_TITLE,
    description: "A calm, modern, self-hosted authenticator vault built around privacy and speed.",
    icons: { icon: [{ url: "/favicon-v2.svg", type: "image/svg+xml", sizes: "any" }] },
    openGraph: {
      title: PRODUCT_TITLE,
      description: "A calm, modern, self-hosted authenticator vault built around privacy and speed.",
      type: "website",
      images: [{ url: socialImage, width: 1536, height: 1024, alt: "Coffer authenticator vault" }],
    },
    twitter: {
      card: "summary_large_image",
      title: PRODUCT_TITLE,
      description: "A calm, modern, self-hosted authenticator vault built around privacy and speed.",
      images: [socialImage],
    },
  };
}

function cleanHost(value: string | null | undefined): string {
  const candidate = value?.trim().toLowerCase() ?? "";
  if (!candidate || !/^[a-z0-9.:[\]-]+(?::\d{1,5})?$/u.test(candidate)) {
    return "localhost:3000";
  }
  try {
    const parsed = new URL(`http://${candidate}`);
    return parsed.username || parsed.password || parsed.pathname !== "/"
      ? "localhost:3000"
      : parsed.host;
  } catch {
    return "localhost:3000";
  }
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
