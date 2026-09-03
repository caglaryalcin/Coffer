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
      <head>
        {/* Keep favicon links in the initial head so Firefox can persist them for bookmarks. */}
        <link rel="icon" href="/favicon.ico?v=3" type="image/x-icon" sizes="16x16 32x32 48x48" />
        <link rel="icon" href="/favicon-48x48.png?v=3" type="image/png" sizes="48x48" />
        <link rel="icon" href="/favicon-32x32.png?v=3" type="image/png" sizes="32x32" />
        <link rel="icon" href="/favicon-16x16.png?v=3" type="image/png" sizes="16x16" />
        <link rel="shortcut icon" href="/favicon.ico?v=3" type="image/x-icon" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=3" sizes="180x180" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
